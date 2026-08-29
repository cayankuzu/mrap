import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getCurrentUser: vi.fn(),
  getScopedLeaderboard: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({ getScopedLeaderboard: mocks.getScopedLeaderboard }));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET } from "@/app/api/leaderboard/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-session" });
  mocks.getScopedLeaderboard.mockResolvedValue([{ id: "rank-1" }]);
});

describe("sıralama endpoint'i", () => {
  it("oturum olmadan veri veya istemci viewerId değeri kullanmaz", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/leaderboard?scope=world&viewerId=attacker"));
    expect(response.status).toBe(401);
    expect(mocks.getScopedLeaderboard).not.toHaveBeenCalled();
  });

  it("kullanıcı kapsamlı okuma hız sınırını repository çağrısından önce uygular", async () => {
    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockResolvedValueOnce(limited);
    const request = new Request("http://localhost/api/leaderboard?scope=world");

    expect(await GET(request)).toBe(limited);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(request, "leaderboard-read:viewer-session", 240, 600_000);
    expect(mocks.getScopedLeaderboard).not.toHaveBeenCalled();
  });

  it.each([
    ["scope=wrong", "geçersiz kapsam"],
    ["scope=world&scope=friends", "tekrarlı kapsam"],
    ["scope=world&limit=0", "sıfır limit"],
    ["scope=world&limit=101", "yüksek limit"],
    ["scope=world&limit=10&limit=20", "tekrarlı limit"],
    ["scope=city", "eksik şehir"],
    ["scope=city&city=TR", "bozuk şehir"],
    ["scope=city&city=TUR:İstanbul", "bozuk şehir ülkesi"],
    ["scope=country", "eksik ülke"],
    ["scope=country&country=TUR", "bozuk ülke"],
    ["scope=country&country=%C3%9F", "ASCII olmayan ülke kodu"],
  ])("%s sorgusunu reddeder (%s)", async (query) => {
    const response = await GET(new Request(`http://localhost/api/leaderboard?${query}`));
    expect(response.status).toBe(400);
    expect(mocks.getScopedLeaderboard).not.toHaveBeenCalled();
  });

  it.each([
    ["friends", "scope=friends"],
    ["city", "scope=city&city=TR%3A%C4%B0stanbul"],
    ["country", "scope=country&country=TR"],
    ["world", "scope=world"],
  ] as const)("%s kapsamını oturum sahibine göre kabul eder", async (scope, query) => {
    const response = await GET(new Request(`http://localhost/api/leaderboard?${query}`));
    expect(response.status).toBe(200);
    expect(mocks.getScopedLeaderboard).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      viewerId: "viewer-session",
      limit: 100,
    }));
  });

  it("tekrarlı şehir ve ülke seçimlerini doğrular, normalize eder ve tekilleştirir", async () => {
    const url = new URL("http://localhost/api/leaderboard");
    url.searchParams.set("scope", "city");
    url.searchParams.set("limit", "25");
    url.searchParams.set("viewerId", "attacker");
    url.searchParams.append("city", "tr: İstanbul ");
    url.searchParams.append("city", "TR:İstanbul");
    url.searchParams.append("city", "DE:Berlin");
    url.searchParams.append("country", "tr");
    url.searchParams.append("country", "DE");

    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ entries: [{ id: "rank-1" }] });
    expect(mocks.getScopedLeaderboard).toHaveBeenCalledWith({
      scope: "city",
      viewerId: "viewer-session",
      cities: [
        { countryCode: "TR", city: "İstanbul" },
        { countryCode: "DE", city: "Berlin" },
      ],
      countryCodes: ["TR", "DE"],
      limit: 25,
    });
  });

  it("seçim sayısını kötüye kullanıma karşı sınırlar", async () => {
    const url = new URL("http://localhost/api/leaderboard?scope=country");
    for (let index = 0; index < 101; index += 1) url.searchParams.append("country", "TR");
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(mocks.getScopedLeaderboard).not.toHaveBeenCalled();
  });
});
