import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class TestUserIdentityConflictError extends Error {}
  return {
    UserIdentityConflictError: TestUserIdentityConflictError,
    checkRateLimit: vi.fn(),
    createPostRecord: vi.fn(),
    createSession: vi.fn(),
    deleteUserAccount: vi.fn(),
    destroySession: vi.fn(),
    findUserRowByEmail: vi.fn(),
    findUserRowByUsername: vi.fn(),
    getCurrentUser: vi.fn(),
    hashPassword: vi.fn(() => ({ hash: "dummy-hash", salt: "dummy-salt" })),
    listNotifications: vi.fn(),
    listPostPage: vi.fn(),
    listPosts: vi.fn(),
    listSavedPostPage: vi.fn(),
    listSavedPosts: vi.fn(),
    listTerritories: vi.fn(),
    listUserPostPage: vi.fn(),
    markNotificationsRead: vi.fn(),
    resolveFollowRequest: vi.fn(),
    resolveLocation: vi.fn(),
    resolveWorldLocation: vi.fn(),
    toPublicUser: vi.fn(),
    setFollowState: vi.fn(),
    setLikeState: vi.fn(),
    setSaveState: vi.fn(),
    updateUser: vi.fn(),
    verifyCurrentUserPassword: vi.fn(),
    verifyPassword: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  createSession: mocks.createSession,
  destroySession: mocks.destroySession,
  getCurrentUser: mocks.getCurrentUser,
  hashPassword: mocks.hashPassword,
  verifyCurrentUserPassword: mocks.verifyCurrentUserPassword,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/lib/app-config", () => ({
  resolveLocation: mocks.resolveLocation,
  ROUTE_COLORS: ["#0D8BFF"],
  normalizeRouteColor: (value: unknown) => String(value).toUpperCase() === "#0D8BFF" ? "#0D8BFF" : null,
}));
vi.mock("@/lib/world-locations", () => ({
  resolveWorldLocation: mocks.resolveWorldLocation,
}));
vi.mock("@/lib/repository", () => ({
  UserIdentityConflictError: mocks.UserIdentityConflictError,
  createPostRecord: mocks.createPostRecord,
  deleteUserAccount: mocks.deleteUserAccount,
  findUserRowByEmail: mocks.findUserRowByEmail,
  findUserRowByUsername: mocks.findUserRowByUsername,
  listNotifications: mocks.listNotifications,
  listPostPage: mocks.listPostPage,
  listPosts: mocks.listPosts,
  listSavedPostPage: mocks.listSavedPostPage,
  listSavedPosts: mocks.listSavedPosts,
  listTerritories: mocks.listTerritories,
  listUserPostPage: mocks.listUserPostPage,
  markNotificationsRead: mocks.markNotificationsRead,
  resolveFollowRequest: mocks.resolveFollowRequest,
  toPublicUser: mocks.toPublicUser,
  setFollowState: mocks.setFollowState,
  setLikeState: mocks.setLikeState,
  setSaveState: mocks.setSaveState,
  updateUser: mocks.updateUser,
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { DELETE as deleteAccount } from "@/app/api/account/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as resolveFollowRequest } from "@/app/api/follow-requests/[id]/route";
import { POST as toggleFollow } from "@/app/api/follows/[id]/route";
import { GET as getNotifications, PUT as readNotifications } from "@/app/api/notifications/route";
import { POST as toggleLike } from "@/app/api/posts/[id]/like/route";
import { POST as toggleSave } from "@/app/api/posts/[id]/save/route";
import { GET as getPosts, POST as createPost } from "@/app/api/posts/route";
import { GET as getProfile, PUT as updateProfile } from "@/app/api/profile/route";
import { encodePostCursor } from "@/lib/post-cursor";
import { IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";
import { jpegDataUrl, pngDataUrl } from "@/test/image-fixtures";

const currentUser = {
  id: "user-1",
  username: "oyuncu_1",
  displayName: "Ada Yılmaz",
  color: "#0D8BFF",
  accountVisibility: "public" as const,
  countryCode: "TR",
  cityId: "tr-istanbul",
  country: "Türkiye",
  city: "İstanbul",
  bio: "",
  birthDate: "1990-01-01",
  avatarData: null,
  coverData: null,
};

const validJpeg = jpegDataUrl();
const validPng = pngDataUrl();

function request(url: string, method = "POST", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(id = "target-1") {
  return { params: Promise.resolve({ id }) };
}

function postBody(overrides: Record<string, unknown> = {}) {
  return {
    territoryId: "territory-1",
    title: "Sahil rotası",
    body: "Bugünün alanı.",
    images: [],
    mapSnapshot: null,
    mapView: null,
    idempotencyKey: "post-attempt-12345678",
    ...overrides,
  };
}

function profileBody(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Ada Yılmaz",
    username: "oyuncu_1",
    color: "#0D8BFF",
    accountVisibility: "public",
    countryCode: "TR",
    cityId: "tr-istanbul",
    bio: "Harita kaşifi",
    birthDate: "1990-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.getCurrentUser.mockResolvedValue(currentUser);
  mocks.resolveLocation.mockReturnValue({ country: "Türkiye", city: "İstanbul" });
  mocks.resolveWorldLocation.mockResolvedValue(null);
  mocks.findUserRowByUsername.mockReturnValue(null);
  mocks.listNotifications.mockReturnValue([]);
  mocks.listPostPage.mockReturnValue({ posts: [], nextCursor: null, total: 0 });
  mocks.listPosts.mockReturnValue([]);
  mocks.listSavedPostPage.mockReturnValue({ posts: [], nextCursor: null, total: 0 });
  mocks.listSavedPosts.mockReturnValue([]);
  mocks.listTerritories.mockReturnValue([]);
  mocks.listUserPostPage.mockReturnValue({ posts: [], nextCursor: null, total: 0 });
  mocks.resolveFollowRequest.mockReturnValue(true);
  mocks.setFollowState.mockReturnValue({ status: "following" });
  mocks.setLikeState.mockReturnValue({ liked: true, count: 1 });
  mocks.setSaveState.mockReturnValue({ saved: true });
  mocks.updateUser.mockReturnValue(currentUser);
  mocks.verifyCurrentUserPassword.mockReturnValue(true);
  mocks.deleteUserAccount.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("gönderi API branch sözleşmeleri", () => {
  it("GET için oturumu zorunlu tutar ve tüm desteklenen akış modlarını doğru repository çağrısına yönlendirir", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await getPosts(new Request("http://localhost/api/posts"))).status).toBe(401);

    for (const mode of ["following", "explore", "mine", "unknown"] as const) {
      const response = await getPosts(new Request(`http://localhost/api/posts?mode=${mode}`));
      expect(response.status).toBe(200);
    }
    await getPosts(new Request("http://localhost/api/posts?mode=saved"));

    expect(mocks.listPostPage.mock.calls.map((call) => call[1])).toEqual([
      "following",
      "explore",
      "mine",
      "following",
    ]);
    expect(mocks.listSavedPostPage).toHaveBeenCalledWith("user-1", { cursor: null, limit: 6 });
    expect(mocks.listTerritories).not.toHaveBeenCalled();
  });

  it("GET cursor, limit ve kullanıcı profili parametrelerini sınırlandırır", async () => {
    expect((await getPosts(new Request("http://localhost/api/posts?limit=0"))).status).toBe(400);
    expect((await getPosts(new Request("http://localhost/api/posts?limit=13"))).status).toBe(400);
    expect((await getPosts(new Request("http://localhost/api/posts?cursor=bozuk"))).status).toBe(400);
    expect((await getPosts(new Request("http://localhost/api/posts?mode=user"))).status).toBe(400);

    const cursor = encodePostCursor({ createdAt: "2026-08-27 10:00:00", id: "post-2" });
    const response = await getPosts(new Request(`http://localhost/api/posts?mode=user&ownerId=owner-1&limit=9&cursor=${cursor}`));

    expect(response.status).toBe(200);
    expect(mocks.listUserPostPage).toHaveBeenCalledWith("user-1", "owner-1", {
      cursor: { createdAt: "2026-08-27 10:00:00", id: "post-2" },
      limit: 9,
    });
  });

  it("POST için oturum ve kullanıcı kapsamlı rate limit uygular", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await createPost(request("http://localhost/api/posts", "POST", postBody()))).status).toBe(401);

    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await createPost(request("http://localhost/api/posts", "POST", postBody()))).toBe(limited);
    expect(mocks.createPostRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["sayısal başlık", postBody({ title: 42 })],
    ["nesne fotoğraf listesi", postBody({ images: {} })],
    ["string olmayan fotoğraf", postBody({ images: [validJpeg, 42] })],
    ["eksik territory", postBody({ territoryId: "" })],
    ["uzun başlık", postBody({ title: "x".repeat(81) })],
    ["uzun açıklama", postBody({ body: "x".repeat(501) })],
    ["fazla fotoğraf", postBody({ images: Array.from({ length: 7 }, () => validJpeg) })],
    ["güvensiz fotoğraf", postBody({ images: ["data:image/jpeg;base64,AAAA"] })],
    ["sayısal harita görseli", postBody({ mapSnapshot: 42 })],
    ["güvensiz harita görseli", postBody({ mapSnapshot: "data:image/jpeg;base64,AAAA" })],
    ["geçersiz harita kadrajı", postBody({ mapView: { center: [400, 41], zoom: 12, bearing: 0, pitch: 0 } })],
    ["geçersiz gönderim anahtarı", postBody({ idempotencyKey: "kısa" })],
  ])("%s payloadını repository mutasyonundan önce reddeder", async (_label, body) => {
    const response = await createPost(request("http://localhost/api/posts", "POST", body));

    expect(response.status).toBe(400);
    expect(mocks.createPostRecord).not.toHaveBeenCalled();
  });

  it("opsiyonel alanları normalize eder, varsayılan açıklamayı kullanır ve geçerli medya/kadrajı kaydeder", async () => {
    mocks.createPostRecord.mockReturnValue("post-1");
    const response = await createPost(request("http://localhost/api/posts", "POST", {
      territoryId: "territory-1",
      body: "   ",
      images: [validJpeg],
      mapSnapshot: validPng,
      mapView: { center: [29.12345678, 41.12345678], zoom: 12.345, bearing: 1.234, pitch: 25.678 },
      idempotencyKey: "post-attempt-12345678",
    }));

    expect(response.status).toBe(201);
    expect(mocks.createPostRecord).toHaveBeenCalledWith("user-1", expect.objectContaining({
      title: expect.any(String),
      body: expect.any(String),
      images: [validJpeg],
      mapSnapshot: validPng,
      mapView: { center: [29.123457, 41.123457], zoom: 12.35, bearing: 1.23, pitch: 25.68 },
    }));
  });

  it("boş snapshotı null yapar ve sahip olunmayan alanı 403 ile reddeder", async () => {
    mocks.createPostRecord.mockReturnValue(null);

    const response = await createPost(request("http://localhost/api/posts", "POST", postBody({ mapSnapshot: "" })));

    expect(response.status).toBe(403);
    expect(mocks.createPostRecord).toHaveBeenCalledWith("user-1", expect.objectContaining({ mapSnapshot: null }));
  });

  it("beklenmeyen repository hatasını HTTP body hatası gibi maskelemez", async () => {
    mocks.createPostRecord.mockImplementation(() => { throw new Error("repository unavailable"); });

    await expect(createPost(request("http://localhost/api/posts", "POST", postBody())))
      .rejects.toThrow("repository unavailable");
  });

  it("aynı gönderim anahtarı farklı payload ile kullanılırsa 409 döndürür", async () => {
    mocks.createPostRecord.mockImplementation(() => { throw new IdempotencyPayloadConflictError(); });

    const response = await createPost(request("http://localhost/api/posts", "POST", postBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Aynı işlem anahtarı farklı içerikle yeniden kullanılamaz." });
  });
});

describe("profil API branch sözleşmeleri", () => {
  it("GET için hem oturumlu hem oturumsuz sözleşmeyi döndürür", async () => {
    expect((await getProfile()).status).toBe(200);
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await getProfile()).status).toBe(401);
  });

  it("PUT için oturumu ve rate limiti mutasyondan önce uygular", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await updateProfile(request("http://localhost/api/profile", "PUT", profileBody()))).status).toBe(401);

    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await updateProfile(request("http://localhost/api/profile", "PUT", profileBody()))).toBe(limited);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["renk", profileBody({ color: "blue" }), 400],
    ["palette dışı renk", profileBody({ color: "#FFFFFF" }), 400],
    ["hesap görünürlüğü", profileBody({ accountVisibility: "friends" }), 400],
    ["kısa görünen ad", profileBody({ displayName: "A" }), 400],
    ["uzun görünen ad", profileBody({ displayName: "A".repeat(61) }), 400],
    ["kullanıcı adı", profileBody({ username: "a!" }), 400],
    ["uzun biyografi", profileBody({ bio: "x".repeat(181) }), 400],
    ["bozuk tarih", profileBody({ birthDate: "2026-02-30" }), 400],
    ["13 yaş altı", profileBody({ birthDate: "2015-01-01" }), 400],
    ["100 yaş üstü", profileBody({ birthDate: "1900-01-01" }), 400],
    ["sayısal avatar", profileBody({ avatarData: 42 }), 400],
    ["sayısal kapak", profileBody({ coverData: 42 }), 400],
  ])("geçersiz %s alanını reddeder", async (_label, body, status) => {
    const response = await updateProfile(request("http://localhost/api/profile", "PUT", body));

    expect(response.status).toBe(status);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("başka kullanıcıya ait kullanıcı adını 409 ile reddeder", async () => {
    mocks.findUserRowByUsername.mockReturnValue({ id: "other-user" });

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody()));

    expect(response.status).toBe(409);
  });

  it("çözümlenemeyen ülke/şehir çiftini reddeder", async () => {
    mocks.resolveLocation.mockReturnValue(null);

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody()));

    expect(response.status).toBe(400);
  });

  it("eski Türkiye ilçe kimliğini profil kaydında kanonik il kimliğine taşır", async () => {
    mocks.resolveLocation.mockReturnValueOnce(null);
    mocks.resolveWorldLocation.mockResolvedValueOnce({
      country: "Türkiye",
      city: "İstanbul",
      cityId: "csc:TR:34:2170",
    });

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({
      cityId: "csc:TR:34:153786",
    })));

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
      cityId: "csc:TR:34:2170",
      country: "Türkiye",
      city: "İstanbul",
    }));
  });

  it("geçerli null ve JPEG görsellerini normalize eder; doğum günü gelmediyse yaşı bir azaltır", async () => {
    mocks.findUserRowByUsername.mockReturnValue({ id: "user-1" });
    const updated = { ...currentUser, avatarData: null, coverData: validJpeg };
    mocks.updateUser.mockReturnValue(updated);

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({
      birthDate: "2000-08-28",
      avatarData: null,
      coverData: validJpeg,
    })));

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
      locationVisibility: "private",
      avatarData: null,
      coverData: validJpeg,
    }));
  });

  it("henüz gelmeyen ay için yaş düzeltmesini uygular ve eksik görsellerde mevcut değerleri korur", async () => {
    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({ birthDate: "2000-09-01" })));

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ avatarData: undefined, coverData: undefined }));
  });

  it("korumalı mevcut medya URL'lerini yeniden yüklemeye çalışmadan korur", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      ...currentUser,
      avatarData: "/api/users/user-1/avatar",
      coverData: "/api/users/user-1/cover",
    });

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({
      avatarData: "/api/users/user-1/avatar",
      coverData: "/api/users/user-1/cover",
    })));

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ avatarData: undefined, coverData: undefined }));
  });

  it("geçersiz JPEG imzasını hem avatar hem kapak için reddeder", async () => {
    expect((await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({
      avatarData: "data:image/jpeg;base64,AAAA",
    })))).status).toBe(400);
    expect((await updateProfile(request("http://localhost/api/profile", "PUT", profileBody({
      avatarData: null,
      coverData: "data:image/jpeg;base64,AAAA",
    })))).status).toBe(400);
  });

  it("repository unique constraint yarışını kararlı 409 yanıtına çevirir", async () => {
    mocks.updateUser.mockImplementation(() => { throw new mocks.UserIdentityConflictError("duplicate"); });

    const response = await updateProfile(request("http://localhost/api/profile", "PUT", profileBody()));

    expect(response.status).toBe(409);
  });

  it("beklenmeyen profil repository hatasını yeniden fırlatır", async () => {
    mocks.updateUser.mockImplementation(() => { throw new Error("profile storage failed"); });

    await expect(updateProfile(request("http://localhost/api/profile", "PUT", profileBody())))
      .rejects.toThrow("profile storage failed");
  });
});

describe("login API branch sözleşmeleri", () => {
  it("rate limit yanıtını body okumadan geçirir", async () => {
    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);

    expect(await login(request("http://localhost/api/auth/login", "POST", {}))).toBe(limited);
    expect(mocks.findUserRowByEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["eksik e-posta", { password: "secret" }],
    ["eksik parola", { email: "a@example.com" }],
    ["uzun e-posta", { email: `${"a".repeat(255)}@example.com`, password: "secret" }],
    ["uzun parola", { email: "a@example.com", password: "x".repeat(129) }],
  ])("%s girdisinde genel kimlik doğrulama hatası döndürür", async (_label, body) => {
    const response = await login(request("http://localhost/api/auth/login", "POST", body));

    expect(response.status).toBe(401);
  });

  it("olmayan kullanıcı için dummy hash doğrulaması yapar", async () => {
    mocks.findUserRowByEmail.mockReturnValue(null);
    mocks.verifyPassword.mockReturnValue(false);

    const response = await login(request("http://localhost/api/auth/login", "POST", {
      email: "missing@example.com",
      password: "secret",
    }));

    expect(response.status).toBe(401);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("secret", "dummy-salt", "dummy-hash");
  });

  it("mevcut kullanıcıda yanlış parolayı aynı genel yanıtla reddeder", async () => {
    mocks.findUserRowByEmail.mockReturnValue({ id: "user-1", password_salt: "salt", password_hash: "hash" });
    mocks.verifyPassword.mockReturnValue(false);

    expect((await login(request("http://localhost/api/auth/login", "POST", {
      email: "ada@example.com",
      password: "wrong",
    }))).status).toBe(401);
  });

  it("beklenmeyen repository hatasını maskelemeden yeniden fırlatır", async () => {
    mocks.findUserRowByEmail.mockImplementation(() => { throw new Error("login storage failed"); });

    await expect(login(request("http://localhost/api/auth/login", "POST", {
      email: "ada@example.com",
      password: "secret",
    }))).rejects.toThrow("login storage failed");
  });
});

describe("sosyal API branch sözleşmeleri", () => {
  it("bildirim GET/PUT işlemlerinde auth, başarı ve rate-limit dallarını korur", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await getNotifications()).status).toBe(401);
    expect((await getNotifications()).status).toBe(200);
    expect(mocks.listNotifications).toHaveBeenCalledWith("user-1");

    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await readNotifications(request("http://localhost/api/notifications", "PUT"))).status).toBe(401);
    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await readNotifications(request("http://localhost/api/notifications", "PUT"))).toBe(limited);
  });

  it.each([
    ["follow", toggleFollow, () => mocks.setFollowState.mockReturnValue(null)],
    ["like", toggleLike, () => mocks.setLikeState.mockReturnValue(null)],
    ["save", toggleSave, () => mocks.setSaveState.mockReturnValue(null)],
  ])("%s mutationında auth, rate-limit ve not-found dallarını uygular", async (_label, handler, makeMissing) => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await handler(request("http://localhost/api/action"), context())).status).toBe(401);

    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await handler(request("http://localhost/api/action"), context())).toBe(limited);

    makeMissing();
    expect((await handler(request("http://localhost/api/action", "POST", { desired: true }), context())).status).toBe(404);
  });

  it("takip isteğinde auth, rate-limit, reject, geçersiz işlem ve not-found dallarını ayırır", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await resolveFollowRequest(request("http://localhost/api/follow-requests/r1", "POST", { action: "accept" }), context("r1"))).status).toBe(401);

    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await resolveFollowRequest(request("http://localhost/api/follow-requests/r1", "POST", { action: "accept" }), context("r1"))).toBe(limited);

    expect((await resolveFollowRequest(request("http://localhost/api/follow-requests/r1", "POST", { action: "reject" }), context("r1"))).status).toBe(200);
    expect((await resolveFollowRequest(request("http://localhost/api/follow-requests/r1", "POST", { action: "later" }), context("r1"))).status).toBe(400);
    mocks.resolveFollowRequest.mockReturnValueOnce(false);
    expect((await resolveFollowRequest(request("http://localhost/api/follow-requests/r1", "POST", { action: "accept" }), context("r1"))).status).toBe(404);
  });

  it("takip isteğinde beklenmeyen repository hatasını yeniden fırlatır", async () => {
    mocks.resolveFollowRequest.mockImplementation(() => { throw new Error("follow storage failed"); });

    await expect(resolveFollowRequest(
      request("http://localhost/api/follow-requests/r1", "POST", { action: "accept" }),
      context("r1"),
    )).rejects.toThrow("follow storage failed");
  });
});

describe("hesap silme API branch sözleşmeleri", () => {
  const validDeletion = { confirmation: "oyuncu_1", acknowledged: true, password: "secret-123" };

  it("oturumsuz isteği reddeder", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);

    expect((await deleteAccount(request("http://localhost/api/account", "DELETE", validDeletion))).status).toBe(401);
  });

  it("geçerli environment rate limit sınırlarını uygular ve limiter yanıtını geçirir", async () => {
    vi.stubEnv("MRAP_ACCOUNT_DELETE_RATE_LIMIT", "1");
    vi.stubEnv("MRAP_ACCOUNT_DELETE_RATE_WINDOW_MS", "60000");
    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);

    expect(await deleteAccount(request("http://localhost/api/account", "DELETE", validDeletion))).toBe(limited);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "account-delete:user-1", 1, 60_000);
  });

  it("sınır dışı environment değerlerinde güvenli varsayılanları kullanır", async () => {
    vi.stubEnv("MRAP_ACCOUNT_DELETE_RATE_LIMIT", "21");
    vi.stubEnv("MRAP_ACCOUNT_DELETE_RATE_WINDOW_MS", "86400001");
    mocks.verifyCurrentUserPassword.mockReturnValue(false);

    await deleteAccount(request("http://localhost/api/account", "DELETE", validDeletion));

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "account-delete:user-1", 5, 3_600_000);
  });

  it.each([
    [new Request("http://localhost/api/account", { method: "DELETE", body: "{}" }), 415],
    [request("http://localhost/api/account", "DELETE", validDeletion, { "Content-Length": "5000" }), 413],
  ])("gövde protokol hatasını doğru HTTP durumuna dönüştürür", async (incoming, status) => {
    const response = await deleteAccount(incoming);

    expect(response.status).toBe(status);
    expect(mocks.verifyCurrentUserPassword).not.toHaveBeenCalled();
  });

  it("silme yarışında hesap bulunamazsa oturumu kapatıp 404 döndürür", async () => {
    mocks.deleteUserAccount.mockReturnValue(false);

    const response = await deleteAccount(request("http://localhost/api/account", "DELETE", validDeletion));

    expect(response.status).toBe(404);
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });
});
