import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
  headerGet: vi.fn(),
  redirect: vi.fn(),
  createSessionRecord: vi.fn(),
  deleteSessionRecord: vi.fn(),
  findUserBySession: vi.fn(),
  findUserRowById: vi.fn(),
  toPublicUser: vi.fn(),
  providerEnabled: vi.fn(),
  resolveServerConfig: vi.fn(),
  createServerClient: vi.fn(),
  serverGetUser: vi.fn(),
  serverSignOut: vi.fn(),
  createClient: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
  }),
  headers: async () => ({ get: mocks.headerGet }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/repository", () => ({
  createSessionRecord: mocks.createSessionRecord,
  deleteSessionRecord: mocks.deleteSessionRecord,
  findUserBySession: mocks.findUserBySession,
  findUserRowById: mocks.findUserRowById,
  toPublicUser: mocks.toPublicUser,
}));
vi.mock("@/lib/supabase/server-config", () => ({
  resolveSupabaseServerConfig: mocks.resolveServerConfig,
  supabaseProviderEnabled: mocks.providerEnabled,
}));
vi.mock("@/lib/supabase/server-client", () => ({
  createMrapSupabaseServerClient: mocks.createServerClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  requireCurrentUser,
  verifyCurrentUserPassword,
  verifyPassword,
} from "@/lib/auth";

const FIXED_NOW = new Date("2026-08-27T12:00:00.000Z");
const ENABLED_SUPABASE_CONFIG = {
  enabled: true as const,
  provider: "supabase" as const,
  url: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "publishable-key-at-least-twenty-characters",
  secretKey: "secret-key-at-least-twenty-characters",
  projectRef: "abcdefghijklmnopqrst",
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function arrangeSupabaseUser({
  id = "user-1",
  authEmail = "auth@example.com",
  rowEmail = "row@example.com",
}: {
  id?: string;
  authEmail?: string;
  rowEmail?: string;
} = {}) {
  mocks.serverGetUser.mockResolvedValue({
    data: { user: { id, email: authEmail || undefined } },
    error: null,
  });
  mocks.findUserRowById.mockResolvedValue({ id, email: rowEmail });
  mocks.toPublicUser.mockResolvedValue({ id, username: "oyuncu", displayName: "Oyuncu" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();

  mocks.providerEnabled.mockReturnValue(false);
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.headerGet.mockReturnValue(null);
  mocks.createSessionRecord.mockResolvedValue(undefined);
  mocks.deleteSessionRecord.mockResolvedValue(undefined);
  mocks.findUserBySession.mockResolvedValue(null);
  mocks.findUserRowById.mockResolvedValue(undefined);
  mocks.toPublicUser.mockResolvedValue(null);
  mocks.resolveServerConfig.mockReturnValue(ENABLED_SUPABASE_CONFIG);
  mocks.serverGetUser.mockResolvedValue({ data: { user: null }, error: null });
  mocks.serverSignOut.mockResolvedValue({ error: null });
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: mocks.serverGetUser, signOut: mocks.serverSignOut },
  });
  mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: null });
  mocks.createClient.mockReturnValue({ auth: { signInWithPassword: mocks.signInWithPassword } });
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT_TEST");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("parola kriptografisi", () => {
  it("verilen salt ile deterministik, 64 baytlık bir scrypt özeti üretir", () => {
    const first = hashPassword("Güvenli-123", "00112233445566778899aabbccddeeff");
    const second = hashPassword("Güvenli-123", "00112233445566778899aabbccddeeff");

    expect(first).toEqual(second);
    expect(first.salt).toBe("00112233445566778899aabbccddeeff");
    expect(first.hash).toMatch(/^[a-f0-9]{128}$/);
    expect(verifyPassword("Güvenli-123", first.salt, first.hash)).toBe(true);
  });

  it("salt verilmediğinde rastgele 16 baytlık salt üretir", () => {
    const first = hashPassword("Güvenli-123");
    const second = hashPassword("Güvenli-123");

    expect(first.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(second.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(first.salt).not.toBe(second.salt);
  });

  it("yanlış parolayı reddeder", () => {
    const stored = hashPassword("doğru-parola", "sabit-salt");
    expect(verifyPassword("yanlış-parola", stored.salt, stored.hash)).toBe(false);
  });

  it.each(["abcd", "zz".repeat(64), "00".repeat(63)])(
    "bozuk veya yanlış uzunluktaki özeti istisna atmadan reddeder: %s",
    (malformedHash) => {
      expect(verifyPassword("parola", "salt", malformedHash)).toBe(false);
    },
  );
});

describe("SQLite parola ve oturum akışı", () => {
  it("kayıtlı yerel kullanıcının doğru parolasını kabul eder", async () => {
    const stored = hashPassword("doğru-parola", "yerel-salt");
    mocks.findUserRowById.mockResolvedValue({
      id: "user-1",
      password_salt: stored.salt,
      password_hash: stored.hash,
    });

    await expect(verifyCurrentUserPassword("user-1", "doğru-parola")).resolves.toBe(true);
    await expect(verifyCurrentUserPassword("user-1", "yanlış-parola")).resolves.toBe(false);
  });

  it("bulunmayan yerel kullanıcının parolasını reddeder", async () => {
    mocks.findUserRowById.mockResolvedValue(undefined);
    await expect(verifyCurrentUserPassword("missing", "parola")).resolves.toBe(false);
  });

  it("kalıcı oturum kaydını hash'lenmiş token ve 30 günlük cookie ile oluşturur", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await createSession("user-1", { persistent: true });

    expect(mocks.createSessionRecord).toHaveBeenCalledOnce();
    const [storedToken, userId, expiresAt] = mocks.createSessionRecord.mock.calls[0] as [string, string, string];
    const [cookieName, rawToken, options] = mocks.cookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(cookieName).toBe(SESSION_COOKIE);
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(storedToken).toBe(sha256(rawToken));
    expect(userId).toBe("user-1");
    expect(expiresAt).toBe("2026-09-26T12:00:00.000Z");
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      priority: "high",
      expires: new Date("2026-09-26T12:00:00.000Z"),
    });
  });

  it("geçici oturumu 12 saatlik kayıtla ve expires olmayan cookie ile oluşturur", async () => {
    await createSession("user-2", { persistent: false });

    const [storedToken, userId, expiresAt] = mocks.createSessionRecord.mock.calls[0] as [string, string, string];
    const [, rawToken, options] = mocks.cookieSet.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(storedToken).toBe(sha256(rawToken));
    expect(userId).toBe("user-2");
    expect(expiresAt).toBe("2026-08-28T00:00:00.000Z");
    expect(options).toMatchObject({ secure: false, httpOnly: true, sameSite: "lax", path: "/" });
    expect(options).not.toHaveProperty("expires");
  });

  it("token varsa veritabanı oturum kaydını hash ile silip cookie'yi temizler", async () => {
    mocks.cookieGet.mockReturnValue({ name: SESSION_COOKIE, value: "ham-token" });

    await destroySession();

    expect(mocks.deleteSessionRecord).toHaveBeenCalledWith(sha256("ham-token"));
    expect(mocks.cookieDelete).toHaveBeenCalledWith(SESSION_COOKIE);
  });

  it("token yoksa veritabanına dokunmadan cookie'yi temizler", async () => {
    await destroySession();

    expect(mocks.deleteSessionRecord).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith(SESSION_COOKIE);
  });

  it("token varsa hash'iyle oturum kullanıcısını getirir", async () => {
    const expectedUser = { id: "user-1", username: "oyuncu" };
    mocks.cookieGet.mockReturnValue({ name: SESSION_COOKIE, value: "ham-token" });
    mocks.findUserBySession.mockResolvedValue(expectedUser);

    await expect(getCurrentUser()).resolves.toBe(expectedUser);
    expect(mocks.findUserBySession).toHaveBeenCalledWith(sha256("ham-token"));
  });

  it("token yoksa kullanıcı sorgusu yapmadan null döner", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mocks.findUserBySession).not.toHaveBeenCalled();
  });
});

describe("Supabase parola ve oturum akışı", () => {
  beforeEach(() => {
    mocks.providerEnabled.mockReturnValue(true);
    arrangeSupabaseUser();
  });

  it("mevcut Supabase kullanıcısı yoksa parolayı reddeder", async () => {
    mocks.serverGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(verifyCurrentUserPassword("user-1", "parola")).resolves.toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("oturum kullanıcısı istenen kullanıcı değilse parolayı reddeder", async () => {
    await expect(verifyCurrentUserPassword("other-user", "parola")).resolves.toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("oturum kullanıcısının e-postası yoksa parolayı reddeder", async () => {
    arrangeSupabaseUser({ authEmail: "", rowEmail: "" });

    await expect(verifyCurrentUserPassword("user-1", "parola")).resolves.toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("Supabase sunucu yapılandırması etkin değilse parolayı reddeder", async () => {
    mocks.resolveServerConfig.mockReturnValue({ enabled: false, provider: "sqlite" });

    await expect(verifyCurrentUserPassword("user-1", "parola")).resolves.toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("Supabase sign-in hatasını ve boş kullanıcı sonucunu reddeder", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ data: { user: null }, error: { message: "invalid" } })
      .mockResolvedValueOnce({ data: { user: null }, error: null });

    await expect(verifyCurrentUserPassword("user-1", "yanlış")).resolves.toBe(false);
    await expect(verifyCurrentUserPassword("user-1", "yanlış")).resolves.toBe(false);
  });

  it("farklı Supabase kullanıcı kimliği dönerse parolayı reddeder", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "other-user" } },
      error: null,
    });

    await expect(verifyCurrentUserPassword("user-1", "parola")).resolves.toBe(false);
  });

  it("aynı Supabase kullanıcısı için başarılı sign-in sonucunu kabul eder", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    await expect(verifyCurrentUserPassword("user-1", "doğru-parola")).resolves.toBe(true);
    expect(mocks.createClient).toHaveBeenCalledWith(
      ENABLED_SUPABASE_CONFIG.url,
      ENABLED_SUPABASE_CONFIG.publishableKey,
      { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
    );
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "auth@example.com",
      password: "doğru-parola",
    });
  });

  it("yerel createSession çağrısını fail-fast reddeder", async () => {
    await expect(createSession("user-1", { persistent: true })).rejects.toThrow(
      "Supabase oturumu",
    );
    expect(mocks.createSessionRecord).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("oturumu Supabase auth signOut ile sonlandırır", async () => {
    await destroySession();

    expect(mocks.createServerClient).toHaveBeenCalledOnce();
    expect(mocks.serverSignOut).toHaveBeenCalledOnce();
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("Supabase getUser hatasında null döner", async () => {
    mocks.serverGetUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mocks.findUserRowById).not.toHaveBeenCalled();
  });

  it("auth kullanıcısının profil satırı yoksa null döner", async () => {
    mocks.findUserRowById.mockResolvedValue(undefined);

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mocks.toPublicUser).not.toHaveBeenCalled();
  });

  it("profil satırını public kullanıcıya dönüştürüp auth e-postasıyla döner", async () => {
    const publicUser = { id: "user-1", username: "oyuncu", displayName: "Oyuncu" };
    mocks.toPublicUser.mockResolvedValue(publicUser);

    await expect(getCurrentUser()).resolves.toEqual({ ...publicUser, email: "auth@example.com" });
    expect(mocks.findUserRowById).toHaveBeenCalledWith("user-1");
    expect(mocks.toPublicUser).toHaveBeenCalledWith(expect.objectContaining({
      id: "user-1",
      email: "row@example.com",
    }));
  });

  it("auth ve profil e-postası yoksa güvenli boş e-posta değeri döner", async () => {
    const publicUser = { id: "user-1", username: "oyuncu", displayName: "Oyuncu" };
    mocks.serverGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: undefined } },
      error: null,
    });
    mocks.findUserRowById.mockResolvedValue({ id: "user-1", email: undefined });
    mocks.toPublicUser.mockResolvedValue(publicUser);

    await expect(getCurrentUser()).resolves.toEqual({ ...publicUser, email: "" });
  });
});

describe("korumalı sayfa yönlendirmesi", () => {
  it("oturum açıksa mevcut kullanıcıyı döndürür", async () => {
    const user = { id: "user-1", username: "oyuncu" };
    mocks.cookieGet.mockReturnValue({ name: SESSION_COOKIE, value: "ham-token" });
    mocks.findUserBySession.mockResolvedValue(user);

    await expect(requireCurrentUser()).resolves.toBe(user);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("oturum yoksa güvenli return path'i kodlayarak login'e yönlendirir", async () => {
    mocks.headerGet.mockReturnValue("/profile/settings?tab=gizlilik");

    await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT_TEST");
    expect(mocks.headerGet).toHaveBeenCalledWith("x-mrap-return-to");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fprofile%2Fsettings%3Ftab%3Dgizlilik",
    );
  });

  it.each([null, "//evil.example/profile", "/landing"])(
    "eksik veya korumasız return path için /home varsayılanını kullanır: %s",
    async (returnPath) => {
      mocks.headerGet.mockReturnValue(returnPath);

      await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT_TEST");
      expect(mocks.redirect).toHaveBeenCalledWith("/login?next=%2Fhome");
    },
  );
});
