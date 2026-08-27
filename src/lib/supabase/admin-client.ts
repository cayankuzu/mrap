import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseServerConfig } from "@/lib/supabase/server-config";

const globalClients = globalThis as typeof globalThis & { mrapSupabaseAdmin?: SupabaseClient };

export function createMrapSupabaseAdminClient() {
  const config = resolveSupabaseServerConfig();
  if (!config.enabled) throw new Error("Supabase admin istemcisi yalnız supabase provider ile kullanılabilir.");
  const existing = globalClients.mrapSupabaseAdmin;
  if (existing) return existing;
  const client = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { headers: { "X-Client-Info": "mrap-server" } },
  });
  if (process.env.NODE_ENV !== "production") globalClients.mrapSupabaseAdmin = client;
  return client;
}
