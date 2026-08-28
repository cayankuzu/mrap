import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readSupabaseCliEnvironment } from "./supabase-cli-environment.mjs";

const environment = readSupabaseCliEnvironment();
const url = environment.SUPABASE_URL;
const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = environment.SUPABASE_SECRET_KEY;
const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
const email = `mrap-auth-smoke-${suffix}@example.com`;
const password = `Mrap-${suffix}-9`;
const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
const publicClient = createClient(url, publishableKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
const canonicalCityId = "csc:TR:34:153786";

let userId;
try {
  const countryCatalog = await admin.from("countries").upsert({ code: "TR", name_tr: "Türkiye", is_active: true }, { onConflict: "code" });
  if (countryCatalog.error) throw new Error("Canonical ülke kataloğu hazırlanamadı.");
  const cityCatalog = await admin.from("cities").upsert({ id: canonicalCityId, country_code: "TR", name_tr: "İstanbul", is_active: true }, { onConflict: "id" });
  if (cityCatalog.error) throw new Error("Canonical şehir kataloğu hazırlanamadı.");
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: {
      username: `smoke_${suffix}`,
      display_name: "mrap Auth Smoke",
      birth_date: "2000-01-01",
      country_code: "TR",
      city_id: canonicalCityId,
      color: "#0D8BFF",
    },
  });
  if (created.error || !created.data.user) throw new Error("Doğrulanmamış test hesabı oluşturulamadı.");
  userId = created.data.user.id;
  if (created.data.user.email_confirmed_at) throw new Error("Test hesabı beklenmedik biçimde otomatik doğrulandı.");

  const login = await publicClient.auth.signInWithPassword({ email, password });
  const providerBlocked = login.error?.code === "email_not_confirmed"
    || login.error?.message.toLocaleLowerCase("en-US").includes("email not confirmed");
  if (!providerBlocked || login.data.session) throw new Error("Doğrulanmamış e-posta Supabase giriş katmanında engellenmedi.");
  console.log("[supabase-auth-smoke] PASS · canonical dünya şehri profili oluştu · doğrulanmamış e-posta oturum açamadı · test hesabı temizlendi");
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId, false);
}
