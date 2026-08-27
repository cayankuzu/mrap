import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByUsername: vi.fn(),
  findById: vi.fn(),
  toPublicUser: vi.fn(),
  signUp: vi.fn(),
  consentInsert: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/repository", () => ({
  findUserRowByUsername: mocks.findByUsername,
  findUserRowById: mocks.findById,
  toPublicUser: mocks.toPublicUser,
  UserIdentityConflictError: class UserIdentityConflictError extends Error {
    field: "email" | "username";
    constructor(field: "email" | "username") { super(field); this.field = field; }
  },
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createMrapSupabaseServerClient: async () => ({ auth: { signUp: mocks.signUp } }),
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: () => ({
    auth: { admin: { deleteUser: mocks.deleteUser } },
    from: () => ({ insert: mocks.consentInsert }),
  }),
}));

import { registerSupabaseAccount } from "@/lib/supabase/auth-operations";

const input = {
  email: "oyuncu@example.com",
  password: "Guvenli123",
  username: "oyuncu",
  displayName: "Örnek Oyuncu",
  birthDate: "2000-01-01",
  countryCode: "TR",
  cityId: "istanbul",
  color: "#0D8BFF",
  legalConsent: { termsVersion: "2026-08", privacyVersion: "2026-08" },
  emailRedirectTo: "https://mrap.example/auth/callback?next=%2Fhome",
};

describe("Supabase hesap kaydı", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByUsername.mockResolvedValue(undefined);
    mocks.findById.mockResolvedValue({ id: "user-1" });
    mocks.toPublicUser.mockResolvedValue({ id: "user-1", username: "oyuncu" });
    mocks.consentInsert.mockResolvedValue({ error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
  });

  it("e-posta doğrulaması bekleyen hesabı oturum açılmış gibi göstermez", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-1", email: input.email, identities: [{ id: "identity-1" }] }, session: null },
      error: null,
    });
    const result = await registerSupabaseAccount(input);
    expect(result.requiresEmailVerification).toBe(true);
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: input.email,
      options: expect.objectContaining({ emailRedirectTo: input.emailRedirectTo }),
    }));
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("proje otomatik doğrulamadaysa mevcut oturumu korur", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-1", email: input.email, identities: [{ id: "identity-1" }] }, session: { access_token: "token" } },
      error: null,
    });
    const result = await registerSupabaseAccount(input);
    expect(result.requiresEmailVerification).toBe(false);
  });

  it("profil sonrası yasal onay yazılamazsa yarım hesabı temizler", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-1", email: input.email, identities: [{ id: "identity-1" }] }, session: null },
      error: null,
    });
    mocks.consentInsert.mockResolvedValue({ error: { code: "23505" } });
    await expect(registerSupabaseAccount(input)).rejects.toThrow("Yasal onay kaydı oluşturulamadı");
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-1", false);
  });
});
