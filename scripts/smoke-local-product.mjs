import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import legalPolicy from "../src/config/legal-policy.json" with { type: "json" };

const baseUrl = (process.env.MRAP_SMOKE_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const password = "Guvenli12345";
const provider = (process.env.MRAP_DATA_PROVIDER || "sqlite").trim().toLocaleLowerCase("en-US");
const remoteSmoke = provider === "supabase";
const locationMode = (process.env.MRAP_SMOKE_LOCATION_MODE || (remoteSmoke ? "development_simulation" : "real_gps")).trim();
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const supabaseSecret = (process.env.SUPABASE_SECRET_KEY || "").trim();
const configuredProjectRef = (process.env.SUPABASE_PROJECT_REF || "").trim();
const hostedProjectRef = hostedSupabaseProjectRef(supabaseUrl);
const remoteConfigurationValid = Boolean(hostedProjectRef && configuredProjectRef === hostedProjectRef);
const remoteAdmin = remoteSmoke && remoteConfigurationValid && supabaseSecret
  ? createClient(supabaseUrl, supabaseSecret, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function hostedSupabaseProjectRef(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || "";
  } catch {
    return "";
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function call(client, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(client.cookies?.size ? { Cookie: [...client.cookies].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
      ...init.headers,
    },
  });
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value) client.cookies.set(name, value);
    else client.cookies.delete(name);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${path}: ${payload?.error || "Bilinmeyen hata"}`);
  return payload;
}

async function createPlayer(label, color) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const username = `qa_${label.toLowerCase()}_${suffix}`;
  const email = `mrap-qa-${label.toLowerCase()}-${suffix}@example.test`;
  const client = { cookies: new Map(), username, email, user: null };
  const input = {
    displayName: `Kalite ${label}`,
    email,
    username,
    password,
    color,
    birthDate: "1995-05-15",
    countryCode: "TR",
    cityId: "tr-istanbul",
    termsAccepted: true,
    termsVersion: legalPolicy.termsVersion,
    privacyVersion: legalPolicy.privacyVersion,
  };
  if (!remoteSmoke) {
    const result = await call(client, "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    client.user = result.user;
    return client;
  }

  invariant(remoteAdmin, "Uzak smoke testi için Supabase sunucu yapılandırması eksik.");
  const created = await remoteAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: input.displayName,
      birth_date: input.birthDate,
      country_code: input.countryCode,
      city_id: input.cityId,
      color,
    },
  });
  if (created.error || !created.data.user) throw new Error("Uzak QA hesabı oluşturulamadı.");
  client.user = { id: created.data.user.id };
  try {
    const consent = await remoteAdmin.from("legal_consents").insert({
      user_id: created.data.user.id,
      terms_version: legalPolicy.termsVersion,
      privacy_version: legalPolicy.privacyVersion,
    });
    if (consent.error) throw new Error("Uzak QA hesabının yasal onayı kaydedilemedi.");
    const login = await call(client, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember: false }),
    });
    client.user = login.user;
  } catch (error) {
    const cleanup = await remoteAdmin.auth.admin.deleteUser(created.data.user.id, false);
    if (cleanup.error) throw new Error("Uzak QA hesabı kurulamadı ve zorunlu temizlik de başarısız oldu.", { cause: error });
    throw error;
  }
  return client;
}

async function deletePlayer(client) {
  if (!client?.user) return;
  try {
    await call(client, "/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged: true, confirmation: client.username, password }),
    });
    if (remoteAdmin) {
      const lookup = await remoteAdmin.auth.admin.getUserById(client.user.id);
      if (lookup.error && lookup.error.status !== 404) throw new Error("Silinen uzak QA hesabı doğrulanamadı.");
      invariant(!lookup.data.user, "Silinen uzak QA hesabı Supabase Auth içinde kaldı.");
      const profile = await remoteAdmin.from("profiles").select("id").eq("id", client.user.id).maybeSingle();
      if (profile.error) throw new Error("Silinen uzak QA profilinin temizliği doğrulanamadı.");
      invariant(!profile.data, "Silinen uzak QA profili veritabanında kaldı.");
      const ownership = await remoteAdmin.from("territory_cells")
        .select("cell_id", { count: "exact", head: true })
        .eq("owner_id", client.user.id);
      if (ownership.error) throw new Error("Silinen uzak QA sahipliğinin temizliği doğrulanamadı.");
      invariant(ownership.count === 0, "Silinen uzak QA hesabına bağlı territory hücresi kaldı.");
    }
  } catch (error) {
    if (remoteAdmin) {
      const domainFallback = await remoteAdmin.rpc("mrap_delete_account", { p_user_id: client.user.id });
      if (domainFallback.error || domainFallback.data !== true) {
        const lookup = await remoteAdmin.auth.admin.getUserById(client.user.id);
        if (lookup.error && lookup.error.status !== 404) {
          throw new Error("QA hesap silme testi başarısız oldu ve zorunlu temizlik doğrulanamadı.", { cause: error });
        }
        if (lookup.data.user) {
          const authFallback = await remoteAdmin.auth.admin.deleteUser(client.user.id, false);
          if (authFallback.error && authFallback.error.status !== 404) {
            throw new Error("QA hesap silme testi başarısız oldu ve zorunlu temizlik de tamamlanamadı.", { cause: error });
          }
        }
      }
    }
    throw error;
  } finally {
    client.cookies.clear();
  }
}

async function createTerritory(client, color) {
  const { session } = await call(client, "/api/game/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: locationMode }),
  });
  const route = [
    [29.5, 41.5],
    [29.500095, 41.5],
    [29.500095, 41.500072],
    [29.5, 41.500072],
    [29.5, 41.5],
  ];
  const startedAt = Date.now();
  let uploaded;
  for (const [index, [longitude, latitude]] of route.entries()) {
    if (index > 0) await wait(1_100);
    uploaded = await call(client, `/api/game/sessions/${session.id}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        points: [{
          sequence: index + 1,
          longitude,
          latitude,
          accuracyM: 1,
          clientObservedAt: new Date().toISOString(),
        }],
      }),
    });
    invariant(uploaded.acceptedCount === 1, `${locationMode === "real_gps" ? "Gerçek GPS" : "Simülasyon"} smoke noktasının ${index + 1}. örneği kabul edilmedi.`);
  }
  const remainingMinimumDuration = 3_200 - (Date.now() - startedAt);
  if (remainingMinimumDuration > 0) await wait(remainingMinimumDuration);
  const { candidate } = await call(client, "/api/game/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
    body: JSON.stringify({ sessionId: session.id, lastAcceptedPointSequence: uploaded.lastAcceptedSequence }),
  });
  const claim = await call(client, "/api/game/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
    body: JSON.stringify({
      sessionId: session.id,
      candidateId: candidate.id,
      lastAcceptedPointSequence: uploaded.lastAcceptedSequence,
      selectedColorId: color,
      idempotencyKey: randomUUID(),
    }),
  });
  await call(client, `/api/game/sessions/${session.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
    body: JSON.stringify({ action: "finish" }),
  });
  const owned = await call(client, "/api/territories/mine?limit=1");
  invariant(owned.territories?.length > 0, "Claim sosyal territory görünümüne yansımadı.");
  return { claim, territory: owned.territories[0] };
}

async function main() {
  if (remoteSmoke) {
    invariant(process.env.MRAP_ALLOW_REMOTE_SMOKE === "1", "Uzak Supabase smoke testi için MRAP_ALLOW_REMOTE_SMOKE=1 açıkça verilmelidir.");
    invariant(process.env.MRAP_SMOKE_ISOLATED_PROJECT === "1", "Uzak smoke testi yalnız canlı kullanıcı içermeyen izole bir QA projesinde çalıştırılabilir.");
    invariant(remoteConfigurationValid, "Uzak smoke testi yalnız doğrulanmış HTTPS Supabase proje URL'si ve eşleşen SUPABASE_PROJECT_REF ile çalışır.");
    invariant(remoteAdmin, "Uzak Supabase smoke testi için SUPABASE_SECRET_KEY gerekli.");
    if (locationMode === "development_simulation") {
      const smokeHost = new URL(baseUrl).hostname.toLocaleLowerCase("en-US");
      invariant(smokeHost === "localhost" || smokeHost === "127.0.0.1", "Sandbox simülasyon smoke testi yalnız yerel development runtime'a karşı çalıştırılabilir.");
    }
    if (locationMode === "real_gps") {
      const expectedRef = (process.env.MRAP_SMOKE_EXPECTED_PROJECT_REF || "").trim();
      invariant(process.env.MRAP_ALLOW_PRODUCTION_WORLD_SMOKE === "1", "Ortak üretim dünyasında QA claim'i varsayılan olarak yasaktır.");
      invariant(expectedRef && expectedRef === hostedProjectRef, "Üretim dünyası smoke testi açık proje kimliği eşleşmesi gerektirir.");
    }
  }
  invariant(locationMode === "real_gps" || locationMode === "development_simulation", "Smoke konum modu geçersiz.");
  let playerX;
  let playerY;
  let report;
  try {
    playerX = await createPlayer("X", "#0D8BFF");
    playerY = await createPlayer("Y", "#FF7A21");
    const { claim, territory } = await createTerritory(playerX, "#0D8BFF");
    const createdPost = await call(playerX, "/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        territoryId: territory.id,
        title: "Yerel kalite rotası",
        body: "Gerçek HTTP akışıyla oluşturulan geçici kalite paylaşımı.",
        images: [],
        mapSnapshot: null,
        mapView: null,
        idempotencyKey: randomUUID(),
      }),
    });
    const comment = await call(playerY, `/api/posts/${createdPost.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Yorum paneli gerçek veriyi gösteriyor.", idempotencyKey: randomUUID() }),
    });
    const commentPage = await call(playerY, `/api/posts/${createdPost.id}/comments?limit=1`);
    const like = await call(playerY, `/api/posts/${createdPost.id}/like`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desired: true }) });
    const likers = await call(playerY, `/api/posts/${createdPost.id}/likes`);
    const save = await call(playerY, `/api/posts/${createdPost.id}/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desired: true }) });
    const savedFeed = await call(playerY, "/api/posts?mode=saved");
    const follow = await call(playerY, `/api/follows/${playerX.user.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desired: true }) });
    const notifications = await call(playerX, "/api/notifications");

    invariant(comment.total === 1, "Yorum toplamı authoritative sonuçla eşleşmiyor.");
    invariant(commentPage.total === 1 && commentPage.comments?.[0]?.body === comment.comment.body, "Yorum GET/POST sözleşmesi yakınsamadı.");
    invariant(like.liked === true && like.count === 1, "Beğeni toggle sonucu geçersiz.");
    invariant(likers.total === 1 && likers.users?.some((user) => user.id === playerY.user.id), "Beğenenler listesi güncellenmedi.");
    invariant(save.saved === true && savedFeed.posts?.some((post) => post.id === createdPost.id), "Kaydedilen gönderi akışa yansımadı.");
    invariant(follow.status === "following", "Herkese açık hesap takip sonucu geçersiz.");
    invariant(notifications.notifications?.some((item) => item.body?.includes(`@${playerY.username}`)), "Sosyal bildirim oluşturulmadı.");

    report = {
      ok: true,
      claimEventId: claim.result.claimEventId,
      postId: createdPost.id,
      comments: commentPage.total,
      likes: likers.total,
      saved: save.saved,
      follow: follow.status,
      notifications: notifications.notifications.length,
    };
  } finally {
    const cleanupErrors = [];
    for (const client of [playerX, playerY]) {
      try {
        await deletePlayer(client);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (cleanupErrors.length) throw new Error(`Geçici hesap temizliği başarısız: ${cleanupErrors.join(" | ")}`);
  }
  process.stdout.write(`${JSON.stringify({ ...report, qaAccountCleanup: "verified" }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
