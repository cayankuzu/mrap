import { spawnSync } from "node:child_process";
import process from "node:process";
import { readSupabaseCliEnvironment } from "./supabase-cli-environment.mjs";

let environment;
try { environment = readSupabaseCliEnvironment(); }
catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Supabase ortamı hazırlanamadı."}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["./scripts/check-supabase-contract.mjs", "--require-remote"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});
process.exit(result.status ?? 1);
