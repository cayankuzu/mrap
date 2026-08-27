import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_BODY_BYTE_LIMITS } from "@/server/http/api-security";
import { jpegDataUrl } from "@/test/image-fixtures";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createPostRecord: vi.fn(),
  createSession: vi.fn(),
  findUserRowByEmail: vi.fn(),
  findUserRowByUsername: vi.fn(),
  getCurrentUser: vi.fn(),
  hashPassword: vi.fn(() => ({ hash: "dummy-hash", salt: "dummy-salt" })),
  listPosts: vi.fn(),
  listSavedPosts: vi.fn(),
  listTerritories: vi.fn(),
  resolveLocation: vi.fn(),
  toPublicUser: vi.fn(),
  updateUser: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  createSession: mocks.createSession,
  getCurrentUser: mocks.getCurrentUser,
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/lib/app-config", () => ({
  resolveLocation: mocks.resolveLocation,
  ROUTE_COLORS: ["#0D8BFF"],
  normalizeRouteColor: (value: unknown) => String(value).toUpperCase() === "#0D8BFF" ? "#0D8BFF" : null,
}));
vi.mock("@/lib/repository", () => ({
  createPostRecord: mocks.createPostRecord,
  findUserRowByEmail: mocks.findUserRowByEmail,
  findUserRowByUsername: mocks.findUserRowByUsername,
  listPosts: mocks.listPosts,
  listSavedPosts: mocks.listSavedPosts,
  listTerritories: mocks.listTerritories,
  toPublicUser: mocks.toPublicUser,
  updateUser: mocks.updateUser,
  UserIdentityConflictError: class UserIdentityConflictError extends Error {},
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as createPost } from "@/app/api/posts/route";
import { PUT as updateProfile } from "@/app/api/profile/route";

const currentUser = {
  id: "user-1",
  username: "oyuncu_1",
  displayName: "Ada Yılmaz",
  color: "#0D8BFF",
  accountVisibility: "public",
  countryCode: "TR",
  cityId: "tr-istanbul",
  country: "Türkiye",
  city: "İstanbul",
  bio: "",
  birthDate: "1990-01-01",
  avatarData: null,
  coverData: null,
};

function jsonRequest(url: string, method: string, body: unknown, contentLength?: number) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(contentLength === undefined ? {} : { "Content-Length": String(contentLength) }),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.getCurrentUser.mockResolvedValue(currentUser);
  mocks.resolveLocation.mockReturnValue({ country: "Türkiye", city: "İstanbul" });
  mocks.findUserRowByUsername.mockReturnValue(null);
});

describe("auth JSON sınırları", () => {
  it("JSON olmayan ve ilan edilen sınırı aşan login gövdelerini no-store yanıtla reddeder", async () => {
    const wrongType = new Request("http://localhost/api/auth/login", { method: "POST", body: "{}" });
    const tooLarge = jsonRequest("http://localhost/api/auth/login", "POST", {}, API_BODY_BYTE_LIMITS.authLogin + 1);

    const wrongTypeResponse = await login(wrongType);
    const tooLargeResponse = await login(tooLarge);

    expect(wrongTypeResponse.status).toBe(415);
    expect(tooLargeResponse.status).toBe(413);
    expect(wrongTypeResponse.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.findUserRowByEmail).not.toHaveBeenCalled();
  });

  it("başarılı login yanıt sözleşmesini korur", async () => {
    const row = { id: "user-1", password_salt: "salt", password_hash: "hash" };
    const publicUser = { id: "user-1", username: "oyuncu_1" };
    mocks.findUserRowByEmail.mockReturnValue(row);
    mocks.verifyPassword.mockReturnValue(true);
    mocks.toPublicUser.mockReturnValue(publicUser);

    const response = await login(jsonRequest("http://localhost/api/auth/login", "POST", { email: "ada@example.com", password: "Guvenli123" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: publicUser });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createSession).toHaveBeenCalledWith("user-1", { persistent: false });
  });

  it("beni hatırla tercihini kalıcı oturum sözleşmesine taşır", async () => {
    mocks.findUserRowByEmail.mockReturnValue({ id: "user-1", password_salt: "salt", password_hash: "hash" });
    mocks.verifyPassword.mockReturnValue(true);
    mocks.toPublicUser.mockReturnValue({ id: "user-1" });

    const response = await login(jsonRequest("http://localhost/api/auth/login", "POST", {
      email: "ada@example.com",
      password: "Guvenli123",
      remember: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith("user-1", { persistent: true });
  });
});

describe("gönderi oluşturma JSON sınırları", () => {
  it("toplam medya bütçesini koruyan merkezi HTTP sınırını aşan gövdeyi okumadan reddeder", async () => {
    const response = await createPost(jsonRequest("http://localhost/api/posts", "POST", {}, API_BODY_BYTE_LIMITS.postCreate + 1));

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createPostRecord).not.toHaveBeenCalled();
  });

  it("geçerli gönderinin mevcut 201 yanıtını korur", async () => {
    mocks.createPostRecord.mockReturnValue("post-1");
    const response = await createPost(jsonRequest("http://localhost/api/posts", "POST", {
      territoryId: "territory-1",
      title: "Sahil rotası",
      body: "Bugünün alanı.",
      images: [],
      mapSnapshot: null,
      mapView: null,
      idempotencyKey: "post-attempt-12345678",
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "post-1", title: "Sahil rotası" });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "post-create:user-1", 20, 600_000);
  });
});

describe("profil HTTP ve medya doğrulaması", () => {
  it("profil gövde sınırını aşan isteği reddeder", async () => {
    const response = await updateProfile(jsonRequest("http://localhost/api/profile", "PUT", {}, API_BODY_BYTE_LIMITS.profileUpdate + 1));

    expect(response.status).toBe(413);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("JPEG etiketi taşıyan fakat JPEG imzası olmayan profil verisini reddeder", async () => {
    const response = await updateProfile(jsonRequest("http://localhost/api/profile", "PUT", {
      avatarData: "data:image/jpeg;base64,AAAA",
    }));

    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("imzası doğrulanan küçük JPEG ile başarı sözleşmesini korur", async () => {
    const updated = { ...currentUser, avatarData: jpegDataUrl() };
    mocks.updateUser.mockReturnValue(updated);
    const response = await updateProfile(jsonRequest("http://localhost/api/profile", "PUT", {
      avatarData: updated.avatarData,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: updated });
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "profile-update:user-1", 30, 600_000);
  });
});
