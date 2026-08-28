import { spawn } from "node:child_process";
import process from "node:process";
import { readSupabaseCliEnvironment } from "./supabase-cli-environment.mjs";

let supabaseEnvironment;
try {
  supabaseEnvironment = readSupabaseCliEnvironment();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Supabase ortamı hazırlanamadı."}\n`);
  process.exit(1);
}

const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const child = spawn(process.execPath, [nextBin, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3100", ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...supabaseEnvironment,
    MRAP_CANONICAL_ORIGIN: "http://127.0.0.1:3100",
    NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "",
    CLOUDFLARE_TURNSTILE_SECRET_KEY: "",
    MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
