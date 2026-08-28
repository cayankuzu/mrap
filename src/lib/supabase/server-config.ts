import "server-only";

export type SupabaseServerEnvironment = Readonly<{
  NODE_ENV?: string;
  MRAP_DATA_PROVIDER?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_MEDIA_BUCKET?: string;
}>;

export type SupabaseServerConfig =
  | Readonly<{ enabled: false; provider: "sqlite" }>
  | Readonly<{
      enabled: true;
      provider: "supabase";
      url: string;
      publishableKey: string;
      secretKey: string;
      projectRef: string;
    }>;

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigurationError";
  }
}

export const DEFAULT_SUPABASE_MEDIA_BUCKET = "mrap-media";

export function resolveSupabaseMediaBucket(
  environment: SupabaseServerEnvironment = process.env as SupabaseServerEnvironment,
) {
  const candidate = environment.SUPABASE_MEDIA_BUCKET?.trim() ?? "";
  if (!candidate || candidate === DEFAULT_SUPABASE_MEDIA_BUCKET) return DEFAULT_SUPABASE_MEDIA_BUCKET;
  throw new SupabaseConfigurationError("SUPABASE_MEDIA_BUCKET migration sözleşmesiyle eşleşmiyor; değer mrap-media olmalı.");
}

function normalizedUrl(value: string, production: boolean) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SupabaseConfigurationError("Supabase URL değeri geçersiz.");
  }
  if (production && parsed.protocol !== "https:") {
    throw new SupabaseConfigurationError("Production Supabase bağlantısı HTTPS kullanmalı.");
  }
  if (!production && parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SupabaseConfigurationError("Supabase URL protokolü desteklenmiyor.");
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function inferredProjectRef(url: string) {
  const hostname = new URL(url).hostname.toLocaleLowerCase("en-US");
  const hosted = hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
  return hosted?.[1] ?? "local-or-custom";
}

export function resolveSupabaseServerConfig(
  environment: SupabaseServerEnvironment = process.env as SupabaseServerEnvironment,
): SupabaseServerConfig {
  const provider = environment.MRAP_DATA_PROVIDER?.trim().toLocaleLowerCase("en-US") || "sqlite";
  if (provider === "sqlite") return { enabled: false, provider: "sqlite" };
  if (provider !== "supabase") throw new SupabaseConfigurationError(`Desteklenmeyen veri sağlayıcısı: ${provider}`);

  const production = environment.NODE_ENV === "production";
  const publicUrlValue = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serverUrlValue = environment.SUPABASE_URL?.trim() || publicUrlValue;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!publicUrlValue || !serverUrlValue || !publishableKey || !secretKey) {
    throw new SupabaseConfigurationError("Supabase provider için URL, publishable key ve server secret birlikte tanımlanmalı.");
  }

  const publicUrl = normalizedUrl(publicUrlValue, production);
  const url = normalizedUrl(serverUrlValue, production);
  if (publicUrl !== url) throw new SupabaseConfigurationError("Public ve server Supabase URL değerleri aynı projeyi göstermeli.");
  if (publishableKey.length < 20 || secretKey.length < 20) {
    throw new SupabaseConfigurationError("Supabase anahtar biçimi geçersiz.");
  }

  const inferred = inferredProjectRef(url);
  const projectRef = environment.SUPABASE_PROJECT_REF?.trim() || inferred;
  if (!/^(?:[a-z0-9]{20}|local-or-custom)$/.test(projectRef)) {
    throw new SupabaseConfigurationError("Supabase project ref biçimi geçersiz.");
  }
  if (inferred !== "local-or-custom" && projectRef !== inferred) {
    throw new SupabaseConfigurationError("Supabase URL ve project ref farklı projeleri gösteriyor.");
  }

  return { enabled: true, provider: "supabase", url, publishableKey, secretKey, projectRef };
}

export function supabaseProviderEnabled(environment: SupabaseServerEnvironment = process.env as SupabaseServerEnvironment) {
  return (environment.MRAP_DATA_PROVIDER?.trim().toLocaleLowerCase("en-US") || "sqlite") === "supabase";
}
