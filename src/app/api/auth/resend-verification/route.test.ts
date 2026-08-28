import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestEmailDeliveryUnavailableError extends Error {}
  class TestEmailVerificationRequestError extends Error {}
  return {
    checkRateLimit: vi.fn(),
    resend: vi.fn(),
    verifyTurnstile: vi.fn(),
    EmailDeliveryUnavailableError: TestEmailDeliveryUnavailableError,
    EmailVerificationRequestError: TestEmailVerificationRequestError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/auth-operations", () => ({
  EmailDeliveryUnavailableError: mocks.EmailDeliveryUnavailableError,
  EmailVerificationRequestError: mocks.EmailVerificationRequestError,
  resendSupabaseVerification: mocks.resend,
}));
vi.mock("@/lib/supabase/server-config", () => ({ supabaseProviderEnabled: () => true }));
vi.mock("@/lib/public-origin", () => ({ resolvePublicOrigin: () => "https://mrap.example" }));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/features/security/turnstile/verify-turnstile", () => ({
  turnstileFailureStatus: () => 403,
  verifyTurnstileMutation: mocks.verifyTurnstile,
}));

import { POST } from "@/app/api/auth/resend-verification/route";

function request(email = "oyuncu@example.com") {
  return new Request("https://mrap.example/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

describe("doğrulama e-postası yeniden gönderim API'si", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.verifyTurnstile.mockResolvedValue({ ok: true });
    mocks.resend.mockResolvedValue({ accepted: true });
  });

  it("hesap varlığına dair ayrıntı vermeyen ortak kabul yanıtını döndürür", async () => {
    const response = await POST(request());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body.accepted).toBe(true);
    expect(body.requestId).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("exists");
    expect(body).not.toHaveProperty("verified");
  });

  it("SMTP dışı sağlayıcı hatasını ayrıntı sızdırmadan ortak servis hatasına dönüştürür", async () => {
    mocks.resend.mockRejectedValueOnce(new mocks.EmailVerificationRequestError());

    const response = await POST(request("bilinmeyen@example.com"));
    const body = await response.json() as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe("Doğrulama e-postası şu anda istenemiyor. Lütfen daha sonra yeniden dene.");
    expect(JSON.stringify(body)).not.toContain("bilinmeyen@example.com");
  });
});
