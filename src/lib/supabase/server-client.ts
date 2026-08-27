import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveSupabaseServerConfig } from "@/lib/supabase/server-config";

export async function createMrapSupabaseServerClient() {
  const config = resolveSupabaseServerConfig();
  if (!config.enabled) throw new Error("Supabase server istemcisi yalnız supabase provider ile kullanılabilir.");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        try {
          for (const { name, value, options } of values) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot always write cookies. Middleware/Route
          // Handler refreshes the session on the writable request boundary.
        }
      },
    },
  });
}
