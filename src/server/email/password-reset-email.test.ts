import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  resolvePasswordResetEmailTimeout,
  sendPasswordResetEmail,
} from "@/server/email/password-reset-email";

const configuredEnvironment = {
  RESEND_API_KEY: "resend-test-key",
  MRAP_EMAIL_FROM: "mrap <noreply@mrap.example>",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("şifre yenileme e-postası", () => {
  it("eksik üretim yapılandırmasını ağ isteği yapmadan raporlar", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(sendPasswordResetEmail(
      { email: "oyuncu@example.com", resetUrl: "https://mrap.example/forgot-password?token=abc" },
      { environment: {}, fetchImpl },
    )).resolves.toEqual({ ok: false, reason: "configuration_missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sağlayıcı reddini yalnız güvenli durum koduyla döndürür", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(sendPasswordResetEmail(
      { email: "oyuncu@example.com", resetUrl: "https://mrap.example/forgot-password?token=abc" },
      { environment: configuredEnvironment, fetchImpl },
    )).resolves.toEqual({ ok: false, reason: "provider_rejected", providerStatus: 503 });
  });

  it("bekleyen sağlayıcı isteğini süre dolunca abort eder", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));

    const delivery = sendPasswordResetEmail(
      { email: "oyuncu@example.com", resetUrl: "https://mrap.example/forgot-password?token=abc" },
      { environment: configuredEnvironment, fetchImpl, timeoutMs: 1_000 },
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(delivery).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("ağ hatası ile zaman aşımını ayırır ve geçerli isteği abort etmez", async () => {
    const networkFailure = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network unavailable"));
    await expect(sendPasswordResetEmail(
      { email: "oyuncu@example.com", resetUrl: "https://mrap.example/forgot-password?token=abc" },
      { environment: configuredEnvironment, fetchImpl: networkFailure },
    )).resolves.toEqual({ ok: false, reason: "network_error" });

    const success = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(sendPasswordResetEmail(
      { email: "oyuncu@example.com", resetUrl: "https://mrap.example/forgot-password?token=abc" },
      { environment: configuredEnvironment, fetchImpl: success },
    )).resolves.toEqual({ ok: true });
    expect(success.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  });

  it("yapılandırılan zaman aşımını güvenli aralıkta tutar", () => {
    expect(resolvePasswordResetEmailTimeout({ MRAP_EMAIL_TIMEOUT_MS: "5000" })).toBe(5_000);
    expect(resolvePasswordResetEmailTimeout({ MRAP_EMAIL_TIMEOUT_MS: "999" })).toBe(8_000);
    expect(resolvePasswordResetEmailTimeout({ MRAP_EMAIL_TIMEOUT_MS: "999999" })).toBe(8_000);
    expect(resolvePasswordResetEmailTimeout({ MRAP_EMAIL_TIMEOUT_MS: "bozuk" })).toBe(8_000);
  });
});
