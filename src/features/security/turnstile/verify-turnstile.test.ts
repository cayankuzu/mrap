import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveTurnstileServerConfig, TurnstileConfigurationError } from "@/features/security/turnstile/server-config";
import { turnstileFailureStatus, verifyTurnstileMutation } from "@/features/security/turnstile/verify-turnstile";

const now = Date.parse("2026-08-27T09:00:00.000Z");
const environment = {
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "public-site-key",
  CLOUDFLARE_TURNSTILE_SECRET_KEY: "server-secret-key",
  MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "mrap.example,www.mrap.example",
};

function siteverifyFetch(payload: Record<string, unknown>, status = 200) {
  return vi.fn(async () => Response.json(payload, { status })) as unknown as typeof fetch;
}

function successPayload(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    challenge_ts: new Date(now - 10_000).toISOString(),
    hostname: "mrap.example",
    action: "register",
    "error-codes": [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Turnstile typed ortam yapılandırması", () => {
  it("değer yoksa yerel akışı Cloudflare hesabına bağlamaz", () => {
    expect(resolveTurnstileServerConfig({})).toEqual({ enabled: false });
  });

  it("production ortamında eksik yapılandırmayı fail-closed reddeder", () => {
    expect(() => resolveTurnstileServerConfig({ NODE_ENV: "production" })).toThrow(TurnstileConfigurationError);
  });

  it("kısmi yapılandırmayı sessiz bypass yerine reddeder", () => {
    expect(() => resolveTurnstileServerConfig({
      NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: "public-site-key",
    })).toThrow(TurnstileConfigurationError);
  });

  it("hostname allow-listesini normalize eder ve wildcard kabul etmez", () => {
    const config = resolveTurnstileServerConfig({ ...environment, MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "MRAP.EXAMPLE." });
    expect(config.enabled && config.expectedHostnames.has("mrap.example")).toBe(true);
    expect(() => resolveTurnstileServerConfig({ ...environment, MRAP_TURNSTILE_EXPECTED_HOSTNAMES: "*.mrap.example" })).toThrow(TurnstileConfigurationError);
  });
});

describe("Turnstile trusted server doğrulaması", () => {
  it("geçerli, doğru action ve hostname taşıyan tek kullanımlık tokenı kabul eder", async () => {
    const fetchImpl = siteverifyFetch(successPayload());
    const result = await verifyTurnstileMutation({ token: "valid-token", expectedAction: "register", environment, fetchImpl, now });

    expect(result).toEqual({ ok: true, bypassed: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.cache).toBe("no-store");
    expect(String(init.body)).toContain("response=valid-token");
  });

  it("eksik tokenı Cloudflare'a istek atmadan reddeder", async () => {
    const fetchImpl = siteverifyFetch(successPayload());
    await expect(verifyTurnstileMutation({ token: "", expectedAction: "register", environment, fetchImpl, now }))
      .resolves.toEqual({ ok: false, reason: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("geçersiz tokenı reddeder", async () => {
    const fetchImpl = siteverifyFetch({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstileMutation({ token: "invalid-token", expectedAction: "register", environment, fetchImpl, now }))
      .resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("süresi dolmuş veya daha önce kullanılmış tokenı reddeder", async () => {
    const fetchImpl = siteverifyFetch({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const result = await verifyTurnstileMutation({ token: "used-token", expectedAction: "register", environment, fetchImpl, now });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("Cloudflare başarılı dese bile eski challenge zamanını reddeder", async () => {
    const fetchImpl = siteverifyFetch(successPayload({ challenge_ts: new Date(now - 6 * 60_000).toISOString() }));
    await expect(verifyTurnstileMutation({ token: "old-token", expectedAction: "register", environment, fetchImpl, now }))
      .resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("yanlış hostname ve action sonuçlarını ayrı ayrı reddeder", async () => {
    const wrongHostname = siteverifyFetch(successPayload({ hostname: "attacker.example" }));
    const wrongAction = siteverifyFetch(successPayload({ action: "password_reset" }));
    await expect(verifyTurnstileMutation({ token: "host-token", expectedAction: "register", environment, fetchImpl: wrongHostname, now }))
      .resolves.toEqual({ ok: false, reason: "hostname_mismatch" });
    await expect(verifyTurnstileMutation({ token: "action-token", expectedAction: "register", environment, fetchImpl: wrongAction, now }))
      .resolves.toEqual({ ok: false, reason: "action_mismatch" });
  });

  it("siteverify ağ ve HTTP arızalarında kritik mutationı fail-closed tutar", async () => {
    const networkFailure = vi.fn(async () => { throw new Error("network unavailable"); }) as unknown as typeof fetch;
    const httpFailure = siteverifyFetch({ error: true }, 503);
    const networkResult = await verifyTurnstileMutation({ token: "token", expectedAction: "register", environment, fetchImpl: networkFailure, now });
    const httpResult = await verifyTurnstileMutation({ token: "token", expectedAction: "register", environment, fetchImpl: httpFailure, now });

    expect(networkResult).toEqual({ ok: false, reason: "unavailable" });
    expect(httpResult).toEqual({ ok: false, reason: "unavailable" });
    if (!networkResult.ok) expect(turnstileFailureStatus(networkResult)).toBe(503);
  });
});
