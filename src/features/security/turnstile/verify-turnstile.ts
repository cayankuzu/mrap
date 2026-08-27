import "server-only";

import { randomUUID } from "node:crypto";
import {
  resolveTurnstileServerConfig,
  TURNSTILE_SITEVERIFY_URL,
  TurnstileConfigurationError,
  type TurnstileAction,
  type TurnstileEnvironment,
} from "@/features/security/turnstile/server-config";

const MAX_TOKEN_LENGTH = 2_048;
const MAX_CHALLENGE_AGE_MS = 5 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;

type SiteverifyResponse = Readonly<{
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  "error-codes"?: ReadonlyArray<string>;
}>;

export type TurnstileVerificationResult =
  | Readonly<{ ok: true; bypassed: boolean }>
  | Readonly<{
      ok: false;
      reason: "missing" | "invalid" | "expired" | "action_mismatch" | "hostname_mismatch" | "unavailable" | "configuration";
    }>;

type FetchLike = typeof fetch;

export async function verifyTurnstileMutation({
  token,
  expectedAction,
  environment = process.env as TurnstileEnvironment,
  fetchImpl = fetch,
  now = Date.now(),
}: Readonly<{
  token: unknown;
  expectedAction: TurnstileAction;
  environment?: TurnstileEnvironment;
  fetchImpl?: FetchLike;
  now?: number;
}>): Promise<TurnstileVerificationResult> {
  let config;
  try {
    config = resolveTurnstileServerConfig(environment);
  } catch (error) {
    if (error instanceof TurnstileConfigurationError) return { ok: false, reason: "configuration" };
    throw error;
  }

  if (!config.enabled) return { ok: true, bypassed: true };
  if (typeof token !== "string" || token.trim().length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const body = new URLSearchParams({
      secret: config.secretKey,
      response: token,
      idempotency_key: randomUUID(),
    });
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };

    let result: SiteverifyResponse;
    try {
      result = await response.json() as SiteverifyResponse;
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!result.success) {
      return { ok: false, reason: result["error-codes"]?.includes("timeout-or-duplicate") ? "expired" : "invalid" };
    }
    if (result.action !== expectedAction) return { ok: false, reason: "action_mismatch" };

    const hostname = typeof result.hostname === "string"
      ? result.hostname.trim().toLocaleLowerCase("en-US").replace(/\.$/, "")
      : "";
    if (!config.expectedHostnames.has(hostname)) return { ok: false, reason: "hostname_mismatch" };

    const challengeAt = typeof result.challenge_ts === "string" ? Date.parse(result.challenge_ts) : Number.NaN;
    if (!Number.isFinite(challengeAt) || challengeAt < now - MAX_CHALLENGE_AGE_MS || challengeAt > now + MAX_CLOCK_SKEW_MS) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, bypassed: false };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export function turnstileFailureStatus(result: Exclude<TurnstileVerificationResult, { ok: true }>) {
  return result.reason === "unavailable" || result.reason === "configuration" ? 503 : 403;
}

