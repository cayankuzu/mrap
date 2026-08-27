import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/legal-consent";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createSession: vi.fn(),
  createUser: vi.fn(),
  findUserRowByEmail: vi.fn(),
  findUserRowByUsername: vi.fn(),
  hashPassword: vi.fn(() => ({ hash: "hash", salt: "salt" })),
  resolveLocation: vi.fn(() => ({ country: "Türkiye", city: "İstanbul" })),
  verifyTurnstileMutation: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ createSession: mocks.createSession, hashPassword: mocks.hashPassword }));
vi.mock("@/lib/app-config", () => ({
  resolveLocation: mocks.resolveLocation,
  ROUTE_COLORS: ["#0D8BFF"],
  normalizeRouteColor: (value: unknown) => String(value).toUpperCase() === "#0D8BFF" ? "#0D8BFF" : null,
}));
vi.mock("@/lib/repository", () => ({
  createUser: mocks.createUser,
  findUserRowByEmail: mocks.findUserRowByEmail,
  findUserRowByUsername: mocks.findUserRowByUsername,
  UserIdentityConflictError: class UserIdentityConflictError extends Error {},
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/features/security/turnstile/verify-turnstile", () => ({
  verifyTurnstileMutation: mocks.verifyTurnstileMutation,
  turnstileFailureStatus: (result: { reason: string }) => result.reason === "unavailable" || result.reason === "configuration" ? 503 : 403,
}));

import { POST } from "@/app/api/auth/register/route";

const validBody = {
  displayName: "Ada Yılmaz",
  username: "ada_1990",
  birthDate: "1990-01-01",
  email: "ada@example.test",
  password: "guvenli123",
  color: "#0D8BFF",
  countryCode: "TR",
  cityId: "tr-istanbul",
  termsAccepted: true,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  turnstileToken: "challenge-token",
};

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyTurnstileMutation.mockResolvedValue({ ok: true, bypassed: false });
  mocks.createUser.mockReturnValue({ id: "user-1", username: "ada_1990" });
});

describe("kayıt yasal onay sınırı", () => {
  it.each([
    [{ ...validBody, termsAccepted: false }],
    [{ ...validBody, termsVersion: "eski" }],
    [{ ...validBody, privacyVersion: undefined }],
  ])("eksik veya eski politika onayıyla hesap oluşturmaz", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("güncel açık onayı kullanıcıyla atomik saklama katmanına iletir", async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "ada@example.test",
      legalConsent: { termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
    }));
    expect(mocks.createSession).toHaveBeenCalledWith("user-1", { persistent: true });
  });

  it("geçerli hex görünse de palette bulunmayan rengi reddeder", async () => {
    const response = await POST(request({ ...validBody, color: "#FFFFFF" }));
    expect(response.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("kayıt mutationını server tarafındaki register challenge kararına bağlar", async () => {
    mocks.verifyTurnstileMutation.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const response = await POST(request(validBody));

    expect(response.status).toBe(403);
    expect(mocks.verifyTurnstileMutation).toHaveBeenCalledWith({ token: "challenge-token", expectedAction: "register" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("Unicode kullanıcı adını Türkçe casing ile normalize ederek kaydeder", async () => {
    const response = await POST(request({ ...validBody, username: "IŞIK_İPEK" }));
    expect(response.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ username: "ışık_ipek" }));
  });
});
