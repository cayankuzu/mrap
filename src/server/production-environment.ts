import { resolveTurnstileServerConfig } from "@/features/security/turnstile/server-config";
import { resolveSupabaseServerConfig, type SupabaseServerEnvironment } from "@/lib/supabase/server-config";

export type ProductionEnvironment = SupabaseServerEnvironment & Readonly<{
  VERCEL?: string;
  MRAP_ENFORCE_PRODUCTION_CONFIG?: string;
  MRAP_CANONICAL_ORIGIN?: string;
  MRAP_TRUST_PROXY_HEADERS?: string;
  MRAP_PRODUCTION_WORLD_ID?: string;
  MRAP_DEVELOPMENT_WORLD_ID?: string;
  NEXT_PUBLIC_MRAP_PRODUCTION_WORLD_ID?: string;
  NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS?: string;
  CRON_SECRET?: string;
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY?: string;
  CLOUDFLARE_TURNSTILE_SECRET_KEY?: string;
  MRAP_TURNSTILE_EXPECTED_HOSTNAMES?: string;
}>;

export class ProductionEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionEnvironmentError";
  }
}

export function productionValidationRequired(environment: ProductionEnvironment = process.env) {
  return environment.NODE_ENV === "production"
    && (environment.VERCEL === "1" || environment.MRAP_ENFORCE_PRODUCTION_CONFIG === "1");
}

function canonicalOrigin(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new ProductionEnvironmentError("Üretim canonical origin değeri geçersiz."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ProductionEnvironmentError("Üretim canonical origin değeri yalnız HTTPS origin içermeli.");
  }
  return parsed;
}

export function assertProductionEnvironment(environment: ProductionEnvironment = process.env) {
  if (!productionValidationRequired(environment)) return { enforced: false as const };

  const supabase = resolveSupabaseServerConfig(environment);
  if (!supabase.enabled) throw new ProductionEnvironmentError("Üretim dağıtımı Supabase veri sağlayıcısını kullanmalı.");
  const origin = canonicalOrigin(environment.MRAP_CANONICAL_ORIGIN?.trim() ?? "");
  if (environment.MRAP_TRUST_PROXY_HEADERS !== "1") {
    throw new ProductionEnvironmentError("Üretim dağıtımında doğrulanmış proxy başlıkları etkin olmalı.");
  }
  if ((environment.NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS ?? "false").trim().toLocaleLowerCase("en-US") !== "false") {
    throw new ProductionEnvironmentError("Üretim dağıtımında geliştirici konum kontrolleri kapalı olmalı.");
  }
  const productionWorld = environment.MRAP_PRODUCTION_WORLD_ID?.trim() ?? "";
  const developmentWorld = environment.MRAP_DEVELOPMENT_WORLD_ID?.trim() ?? "";
  if (!productionWorld || !developmentWorld || productionWorld === developmentWorld) {
    throw new ProductionEnvironmentError("Üretim ve geliştirme oyun dünyaları farklı ve tanımlı olmalı.");
  }
  if (environment.NEXT_PUBLIC_MRAP_PRODUCTION_WORLD_ID?.trim() !== productionWorld) {
    throw new ProductionEnvironmentError("İstemci ve sunucu üretim dünyası kimlikleri eşleşmeli.");
  }
  if ((environment.CRON_SECRET?.trim().length ?? 0) < 16) {
    throw new ProductionEnvironmentError("Üretim bakım görevi için en az 16 karakterlik CRON_SECRET gerekli.");
  }
  const turnstile = resolveTurnstileServerConfig(environment);
  if (!turnstile.enabled || !turnstile.expectedHostnames.has(origin.hostname.toLocaleLowerCase("en-US"))) {
    throw new ProductionEnvironmentError("Turnstile hostname listesi canonical üretim hostunu içermeli.");
  }
  return { enforced: true as const, origin: origin.origin, projectRef: supabase.projectRef };
}
