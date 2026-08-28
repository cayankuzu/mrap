import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByUsername: vi.fn(),
  findById: vi.fn(),
  toPublicUser: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resend: vi.fn(),
  consentInsert: vi.fn(),
  deleteUser: vi.fn(),
  ensureLocation: vi.fn(),
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
  createMrapSupabaseServerClient: async () => ({ auth: { signUp: mocks.signUp, signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut, resend: mocks.resend } }),
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: () => ({
    auth: { admin: { deleteUser: mocks.deleteUser } },
    from: () => ({ insert: mocks.consentInsert }),
  }),
}));
vi.mock("@/lib/supabase/location-catalog", () => ({
  ensureSupabaseLocationCatalog: mocks.ensureLocation,
}));

import {
  EmailDeliveryUnavailableError,
  EmailVerificationRequestError,
  registerSupabaseAccount,
  resendSupabaseVerification,
  signInSupabaseAccount,
} from "@/lib/supabase/auth-operations";

const input = {
  email: "oyuncu@example.com",
  password: "Guvenli123",
  username: "oyuncu",
  displayName: "Örnek Oyuncu",
  birthDate: "2000-01-01",
  countryCode: "TR",
  cityId: "csc:TR:34:153786",
  country: "Türkiye",
  city: "İstanbul",
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
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.resend.mockResolvedValue({ error: null });
    mocks.ensureLocation.mockResolvedValue(undefined);
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
    expect(mocks.ensureLocation).toHaveBeenCalledWith({
      countryCode: "TR",
      country: "Türkiye",
      cityId: "csc:TR:34:153786",
      city: "İstanbul",
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("proje otomatik doğrulamadaysa mevcut oturumu korur", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "user-1", email: input.email, email_confirmed_at: "2026-08-28T12:00:00Z", identities: [{ id: "identity-1" }] }, session: { access_token: "token" } },
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

  it("doğrulanmamış doğru parolayı özel durum olarak döndürür", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "email_not_confirmed", message: "Email not confirmed" } });
    await expect(signInSupabaseAccount(input.email, input.password)).resolves.toEqual({ status: "email_unverified" });
  });

  it("doğrulanmış kullanıcıyı girişe kabul eder", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1", email: input.email, email_confirmed_at: "2026-08-28T12:00:00Z" } },
      error: null,
    });
    await expect(signInSupabaseAccount(input.email, input.password)).resolves.toEqual({
      status: "authenticated",
      user: { id: "user-1", username: "oyuncu", email: input.email },
    });
  });

  it("doğrulama e-postasını aynı callback akışıyla yeniden ister", async () => {
    await expect(resendSupabaseVerification(input.email, input.emailRedirectTo)).resolves.toEqual({ accepted: true });
    expect(mocks.resend).toHaveBeenCalledWith({ type: "signup", email: input.email, options: { emailRedirectTo: input.emailRedirectTo } });
  });

  it("SMTP teslim hatasını özel servis hatasına dönüştürür", async () => {
    mocks.resend.mockResolvedValueOnce({ error: { message: "Error sending confirmation email via SMTP", status: 500 } });

    await expect(resendSupabaseVerification(input.email, input.emailRedirectTo)).rejects.toBeInstanceOf(EmailDeliveryUnavailableError);
  });

  it("SMTP dışındaki sağlayıcı hatasını başarı olarak gizlemez ve ayrıntısını dışarı taşımaz", async () => {
    mocks.resend.mockResolvedValueOnce({ error: { message: "Provider request rejected: internal-account-detail", status: 500 } });

    await expect(resendSupabaseVerification(input.email, input.emailRedirectTo)).rejects.toMatchObject({
      name: EmailVerificationRequestError.name,
      message: "Doğrulama e-postası isteği tamamlanamadı.",
    });
  });
});
