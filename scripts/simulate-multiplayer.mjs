import { randomUUID } from "node:crypto";
import legalPolicy from "../src/config/legal-policy.json" with { type: "json" };

const baseUrl = (process.env.MRAP_SIMULATOR_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const latencyMs = Math.max(0, Number(process.env.MRAP_SIMULATOR_LATENCY_MS || 0));
const packetLoss = Math.min(0.9, Math.max(0, Number(process.env.MRAP_SIMULATOR_PACKET_LOSS || 0)));
const password = "Guvenli12345";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function call(client, path, init = {}, allowSimulatedLoss = false) {
  if (latencyMs) await wait(latencyMs);
  if (allowSimulatedLoss && Math.random() < packetLoss) {
    await wait(Math.max(50, latencyMs));
    throw new Error("SIMULATED_PACKET_LOSS");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(client.cookie ? { Cookie: client.cookie } : {}),
      ...init.headers,
    },
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie) client.cookie = cookie;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${path}: ${payload?.error || "Bilinmeyen hata"}`);
  return payload;
}

async function createPlayer(label, color) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const client = { cookie: "", label, user: null };
  const payload = await call(client, "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: `Simülatör ${label}`,
      email: `mrap-${label.toLowerCase()}-${suffix}@example.test`,
      username: `sim_${label.toLowerCase()}_${suffix}`,
      password,
      color,
      birthDate: "1995-05-15",
      countryCode: "TR",
      cityId: "tr-istanbul",
      termsAccepted: true,
      termsVersion: legalPolicy.termsVersion,
      privacyVersion: legalPolicy.privacyVersion,
    }),
  });
  client.user = payload.user;
  return client;
}

async function deletePlayer(client) {
  if (!client?.user || !client.cookie) return;
  await call(client, "/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acknowledged: true,
      confirmation: client.user.username,
      password,
    }),
  });
  client.cookie = "";
}

const route = [
  [29.0270, 40.9870],
  [29.0274, 40.9870],
  [29.0274, 40.9874],
  [29.0272, 40.9874],
  [29.0272, 40.9870],
];

async function prepareClaim(client, color) {
  const { session } = await call(client, "/api/game/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "development_simulation" }),
  });
  const startedAt = Date.now();
  const points = route.map(([longitude, latitude], index) => ({
    sequence: index + 1,
    longitude,
    latitude,
    accuracyM: 1,
    clientObservedAt: new Date(startedAt + index * 1_000).toISOString(),
  }));
  const batch = { idempotencyKey: `batch-${session.id}-0001`, points };
  let uploaded;
  try {
    uploaded = await call(client, `/api/game/sessions/${session.id}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
      body: JSON.stringify(batch),
    }, true);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "SIMULATED_PACKET_LOSS") throw error;
    uploaded = await call(client, `/api/game/sessions/${session.id}/points`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
      body: JSON.stringify(batch),
    });
  }
  const duplicate = await call(client, `/api/game/sessions/${session.id}/points`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
    body: JSON.stringify({ ...batch, idempotencyKey: `replay-${session.id}-0001` }),
  });
  if (duplicate.acceptedCount !== 0 || duplicate.ignoredCount !== points.length) throw new Error("Duplicate konum paketi güvenli no-op olmadı.");
  const minimumWait = 3_200 - (Date.now() - startedAt);
  if (minimumWait > 0) await wait(minimumWait);
  const { candidate } = await call(client, "/api/game/candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": session.serverNonce },
    body: JSON.stringify({ sessionId: session.id, lastAcceptedPointSequence: uploaded.lastAcceptedSequence }),
  });
  return {
    session,
    command: {
      sessionId: session.id,
      candidateId: candidate.id,
      lastAcceptedPointSequence: uploaded.lastAcceptedSequence,
      selectedColorId: color,
      idempotencyKey: randomUUID(),
    },
  };
}

async function submitClaim(client, prepared) {
  return call(client, "/api/game/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": prepared.session.serverNonce },
    body: JSON.stringify(prepared.command),
  });
}

async function finish(client, prepared) {
  const request = () => call(client, `/api/game/sessions/${prepared.session.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": prepared.session.serverNonce },
    body: JSON.stringify({ action: "finish" }),
  });
  const first = await request();
  const retry = await request();
  if (JSON.stringify(first.route) !== JSON.stringify(retry.route)) throw new Error("Oturum bitirme retry sonucu değişti.");
}

async function main() {
  let playerX;
  let playerY;
  let report;
  try {
    playerX = await createPlayer("X", "#0D8BFF");
    playerY = await createPlayer("Y", "#FF7A21");
    const [preparedX, preparedY] = await Promise.all([
      prepareClaim(playerX, "#0D8BFF"),
      prepareClaim(playerY, "#FF7A21"),
    ]);
    const [claimX, claimY] = await Promise.all([
      submitClaim(playerX, preparedX),
      submitClaim(playerY, preparedY),
    ]);
    const versionX = Math.max(...Object.values(claimX.result.affectedRegionVersions));
    const versionY = Math.max(...Object.values(claimY.result.affectedRegionVersions));
    const last = versionX > versionY ? { client: playerX, claim: claimX } : { client: playerY, claim: claimY };
    const regions = Object.keys(last.claim.result.affectedRegionVersions).join(",");
    const { snapshot } = await call(last.client, `/api/game/regions?worldId=development-sandbox&regions=${encodeURIComponent(regions)}`);
    const changedCellIds = new Set(last.claim.result.affectedRegionVersions ? snapshot.cells.map((cell) => cell.cellId) : []);
    const wrongOwner = snapshot.cells.find((cell) => changedCellIds.has(cell.cellId) && cell.ownerId !== last.client.user.id);
    if (wrongOwner) throw new Error("Final canonical cell sahibi son authoritative commit ile eşleşmiyor.");
    await Promise.all([finish(playerX, preparedX), finish(playerY, preparedY)]);
    report = {
      ok: true,
      worldId: "development-sandbox",
      players: [playerX.user.username, playerY.user.username],
      latestWinner: last.client.user.username,
      versions: { X: versionX, Y: versionY },
      canonicalCells: snapshot.cells.length,
      duplicateBatch: "ignored",
      finishRetry: "idempotent",
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
    if (cleanupErrors.length) throw new Error(`Simülatör hesap temizliği başarısız: ${cleanupErrors.join(" | ")}`);
  }
  process.stdout.write(`${JSON.stringify({ ...report, cleanup: "verified" }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
