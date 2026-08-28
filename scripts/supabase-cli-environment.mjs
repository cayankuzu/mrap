import { spawnSync } from "node:child_process";
import process from "node:process";

export const MRAP_SUPABASE_PROJECT_REF = "kpsiqurdxumsouimjmvc";

export function readSupabaseCliEnvironment() {
  const argumentsList = ["supabase", "projects", "api-keys", "--project-ref", MRAP_SUPABASE_PROJECT_REF, "--output", "json"];
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const commandArguments = process.platform === "win32"
    ? ["/d", "/s", "/c", `npx ${argumentsList.join(" ")}`]
    : argumentsList;
  const keyResult = spawnSync(command, commandArguments, { encoding: "utf8", windowsHide: true });
  if (keyResult.status !== 0) throw new Error("Supabase geliştirme anahtarları güvenli CLI oturumundan alınamadı. Önce `npx supabase login` çalıştır.");

  let keys;
  try { keys = JSON.parse(keyResult.stdout); }
  catch { throw new Error("Supabase CLI beklenen anahtar sözleşmesini döndürmedi."); }

  const publishableKey = keys.find((item) => item.type === "publishable")?.api_key
    || keys.find((item) => item.name === "anon")?.api_key;
  // PostgREST RPC and Auth Admin both need a JWT bearer today. Keep the
  // legacy service-role key server-only until every runtime supports sb_secret.
  const secretKey = keys.find((item) => item.name === "service_role")?.api_key;
  if (!publishableKey || !secretKey) throw new Error("Supabase publishable/service-role anahtar çifti bulunamadı.");

  return {
    ...process.env,
    MRAP_DATA_PROVIDER: "supabase",
    NEXT_PUBLIC_SUPABASE_URL: `https://${MRAP_SUPABASE_PROJECT_REF}.supabase.co`,
    SUPABASE_URL: `https://${MRAP_SUPABASE_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    SUPABASE_PROJECT_REF: MRAP_SUPABASE_PROJECT_REF,
  };
}
