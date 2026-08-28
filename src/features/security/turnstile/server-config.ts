import "server-only";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileAction = "register" | "password_reset" | "resend_verification";

export type TurnstileServerConfig =
  | Readonly<{ enabled: false }>
  | Readonly<{
      enabled: true;
      secretKey: string;
      expectedHostnames: ReadonlySet<string>;
      timeoutMs: number;
    }>;

export type TurnstileEnvironment = Readonly<{
  NODE_ENV?: string;
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY?: string;
  CLOUDFLARE_TURNSTILE_SECRET_KEY?: string;
  MRAP_TURNSTILE_EXPECTED_HOSTNAMES?: string;
}>;

export class TurnstileConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnstileConfigurationError";
  }
}

function normalizedHostname(value: string) {
  return value.trim().toLocaleLowerCase("en-US").replace(/\.$/, "");
}

function parseExpectedHostnames(value: string) {
  const hostnames = value.split(",").map(normalizedHostname).filter(Boolean);
  if (hostnames.some((hostname) => !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/.test(hostname))) {
    throw new TurnstileConfigurationError("Turnstile hostname listesi geçersiz.");
  }
  return new Set(hostnames);
}

/**
 * Turnstile remains optional for local/test work. Production is fail-closed:
 * the complete client/server/hostname tuple must be present and there is no
 * separate bypass flag.
 */
export function resolveTurnstileServerConfig(
  environment: TurnstileEnvironment = process.env as TurnstileEnvironment,
): TurnstileServerConfig {
  const siteKey = environment.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = environment.CLOUDFLARE_TURNSTILE_SECRET_KEY?.trim() ?? "";
  const hostnameValue = environment.MRAP_TURNSTILE_EXPECTED_HOSTNAMES?.trim() ?? "";
  const configured = Boolean(siteKey || secretKey || hostnameValue);

  if (!configured) {
    if (environment.NODE_ENV === "production") {
      throw new TurnstileConfigurationError("Üretim ortamında Turnstile yapılandırması zorunlu.");
    }
    return { enabled: false };
  }
  if (!siteKey || !secretKey || !hostnameValue) {
    throw new TurnstileConfigurationError("Turnstile yapılandırması eksik; site key, secret ve hostname listesi birlikte tanımlanmalı.");
  }

  const expectedHostnames = parseExpectedHostnames(hostnameValue);
  if (expectedHostnames.size === 0) throw new TurnstileConfigurationError("En az bir Turnstile hostname değeri gerekli.");
  return { enabled: true, secretKey, expectedHostnames, timeoutMs: 5_000 };
}
