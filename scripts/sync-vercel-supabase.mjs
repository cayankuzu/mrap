import { spawnSync } from "node:child_process";
import process from "node:process";
import { MRAP_SUPABASE_PROJECT_REF, readSupabaseCliEnvironment } from "./supabase-cli-environment.mjs";

const environment = readSupabaseCliEnvironment();
const isWindows = process.platform === "win32";

function runVercel(argumentsList, input) {
  const command = isWindows ? (process.env.ComSpec || "cmd.exe") : "npx";
  const commandArguments = isWindows
    ? ["/d", "/s", "/c", `npx vercel ${argumentsList.join(" ")}`]
    : ["vercel", ...argumentsList];
  const result = spawnSync(command, commandArguments, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Vercel ortam değişkeni güncellenemedi.");
}

const publicVariables = {
  MRAP_DATA_PROVIDER: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: environment.SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_PROJECT_REF: MRAP_SUPABASE_PROJECT_REF,
};

for (const [name, value] of Object.entries(publicVariables)) {
  runVercel(["env", "add", name, "production", "--force", "--no-sensitive", "--yes", "--value", value]);
}
runVercel(["env", "add", "SUPABASE_SECRET_KEY", "production", "--force", "--sensitive", "--yes"], `${environment.SUPABASE_SECRET_KEY}\n`);
console.log("[vercel-supabase] PASS · production Supabase değişkenleri mrap projesiyle eşitlendi");
