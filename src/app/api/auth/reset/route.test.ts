import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createPasswordResetToken: vi.fn(),
  findUserRowByEmail: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  verifyTurnstileMutation: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
  after: vi.fn((callback: () => unknown | Promise<unknown>) => {
    const task = Promise.resolve().then(callback);
    mocks.afterTasks.push(task);
  }),
}));

vi.mock("@/lib/repository", () => ({
  createPasswordResetToken: mocks.createPasswordResetToken,
  findUserRowByEmail: mocks.findUserRowByEmail,
  resetPasswordWithToken: mocks.resetPasswordWithToken,
}));
vi.mock("@/server/email/password-reset-email", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/features/security/turnstile/verify-turnstile", () => ({
  verifyTurnstileMutation: mocks.verifyTurnstileMutation,
  turnstileFailureStatus: (result: { reason: string }) => result.reason === "unavailable" || result.reason === "configuration" ? 503 : 403,
}));
vi.mock("next/server", () => ({ after: mocks.after }));

import { POST } from "@/app/api/auth/reset/route";

function resetRequest(email: string, origin = "https://attacker.example") {
  return new Request(`${origin}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, turnstileToken: "challenge-token" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.afterTasks.length = 0;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MRAP_CANONICAL_ORIGIN", "https://mrap.example/app/path");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "ignored.vercel.app");
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.sendPasswordResetEmail.mockResolvedValue({ ok: true });
  mocks.verifyTurnstileMutation.mockResolvedValue({ ok: true, bypassed: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("şifre yenileme API teslimatı", () => {
  it("ilk şifre yenileme isteğini server tarafındaki challenge kararı olmadan ilerletmez", async () => {
    mocks.verifyTurnstileMutation.mockResolvedValueOnce({ ok: false, reason: "missing" });
    const response = await POST(resetRequest("oyuncu@example.com"));

    expect(response.status).toBe(403);
    expect(mocks.verifyTurnstileMutation).toHaveBeenCalledWith({ token: "challenge-token", expectedAction: "password_reset" });
    expect(mocks.findUserRowByEmail).not.toHaveBeenCalled();
    expect(mocks.createPasswordResetToken).not.toHaveBeenCalled();
  });

  it("linki istek hostundan değil güvenilir public origin çözümünden üretir", async () => {
    mocks.findUserRowByEmail.mockReturnValue({ id: "user-1" });

    const response = await POST(resetRequest("oyuncu@example.com"));
    await Promise.all(mocks.afterTasks);

    expect(response.status).toBe(200);
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith({
      email: "oyuncu@example.com",
      resetUrl: expect.stringMatching(/^https:\/\/mrap\.example\/forgot-password\?token=[a-f0-9]{64}$/),
    });
    expect(mocks.sendPasswordResetEmail.mock.calls[0]?.[0].resetUrl).not.toContain("attacker.example");
    expect(response.headers.get("X-Correlation-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sağlayıcı hatasını kaydeder ama dışarıda hesap varlığını açığa çıkarmaz", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findUserRowByEmail.mockReturnValueOnce({ id: "user-1" }).mockReturnValueOnce(null);
    mocks.sendPasswordResetEmail.mockResolvedValue({ ok: false, reason: "provider_rejected", providerStatus: 503 });

    const failedDelivery = await POST(resetRequest("registered@example.com"));
    const missingAccount = await POST(resetRequest("missing@example.com"));
    await Promise.all(mocks.afterTasks);
    const failedBody = await failedDelivery.json();
    const missingBody = await missingAccount.json();

    expect(failedDelivery.status).toBe(200);
    expect(missingAccount.status).toBe(200);
    expect(failedBody).toEqual(missingBody);
    expect(errorSpy).toHaveBeenCalledOnce();
    const logLine = String(errorSpy.mock.calls[0]?.[0]);
    expect(logLine).toContain('"event":"password_reset_email_delivery_failed"');
    expect(logLine).toContain('"reason":"provider_rejected"');
    expect(logLine).not.toContain("registered@example.com");
    expect(logLine).not.toMatch(/[a-f0-9]{64}/);
  });

  it("eksik e-posta sağlayıcı ayarını da genel yanıt arkasında güvenli kaydeder", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findUserRowByEmail.mockReturnValue({ id: "user-1" });
    mocks.sendPasswordResetEmail.mockResolvedValue({ ok: false, reason: "configuration_missing" });

    const response = await POST(resetRequest("registered@example.com"));
    await Promise.all(mocks.afterTasks);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Bu e-posta kayıtlıysa güvenli yenileme bağlantısı gönderildi.",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("beklenmeyen teslimat hattı hatasını PII olmadan kaydeder", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findUserRowByEmail.mockReturnValue({ id: "user-1" });
    mocks.createPasswordResetToken.mockImplementation(() => { throw new Error("database unavailable"); });

    const response = await POST(resetRequest("registered@example.com"));
    await Promise.all(mocks.afterTasks);

    expect(response.status).toBe(200);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('"reason":"pipeline_error"');
    expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain("registered@example.com");
  });
});
