import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeConnectionCursor } from "@/lib/connection-cursor";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getConnectionListAccess: vi.fn(),
  getCurrentUser: vi.fn(),
  listConnectionPage: vi.fn(),
  searchPlayers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({
  getConnectionListAccess: mocks.getConnectionListAccess,
  listConnectionPage: mocks.listConnectionPage,
  searchPlayers: mocks.searchPlayers,
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET as searchUsers } from "@/app/api/users/route";
import { GET as listConnections } from "@/app/api/users/[id]/connections/route";

function context(id = "target-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-1" });
  mocks.getConnectionListAccess.mockReturnValue("allowed");
  mocks.listConnectionPage.mockReturnValue({ connections: [], nextCursor: null, total: 0 });
  mocks.searchPlayers.mockReturnValue([]);
  mocks.checkRateLimit.mockReturnValue(null);
});

describe("kullanıcı arama endpoint'i", () => {
  it("auth, rate-limit ve sorgu uzunluğu sınırlarını uygular", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await searchUsers(new Request("http://localhost/api/users?q=cayan"))).status).toBe(401);

    const limited = Response.json({ error: "limited" }, { status: 429 });
    mocks.checkRateLimit.mockReturnValueOnce(limited);
    expect(await searchUsers(new Request("http://localhost/api/users?q=cayan"))).toBe(limited);

    expect((await searchUsers(new Request(`http://localhost/api/users?q=${"x".repeat(41)}`))).status).toBe(400);
    expect(mocks.searchPlayers).not.toHaveBeenCalled();
  });

  it("Türkçe sorguyu repository'ye aynen iletir ve private no-store döner", async () => {
    const response = await searchUsers(new Request("http://localhost/api/users?q=%C3%87ayan"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.searchPlayers).toHaveBeenCalledWith("viewer-1", "Çayan");
  });
});

describe("bağlantı listesi endpoint'i", () => {
  it("limit ve cursor sınırlarını doğrular", async () => {
    expect((await listConnections(new Request("http://localhost/api/users/target-1/connections?type=wrong"), context())).status).toBe(400);
    expect((await listConnections(new Request("http://localhost/api/users/target-1/connections?type=followers&limit=51"), context())).status).toBe(400);
    expect((await listConnections(new Request("http://localhost/api/users/target-1/connections?type=followers&cursor=***"), context())).status).toBe(400);
    expect((await listConnections(new Request("http://localhost/api/users/bad/connections?type=followers"), context("../bad"))).status).toBe(400);
  });

  it.each([
    ["not_found", 404],
    ["forbidden", 403],
  ] as const)("%s gizlilik sonucunu %s olarak döner", async (access, status) => {
    mocks.getConnectionListAccess.mockReturnValue(access);
    expect((await listConnections(new Request("http://localhost/api/users/target-1/connections?type=following"), context())).status).toBe(status);
    expect(mocks.listConnectionPage).not.toHaveBeenCalled();
  });

  it("doğrulanmış cursor ile yalnız istenen sayfayı yükler", async () => {
    const cursor = encodeConnectionCursor({ searchKey: "cayan akin", id: "user-20" });
    const response = await listConnections(new Request(`http://localhost/api/users/target-1/connections?type=followers&limit=12&cursor=${cursor}`), context());
    expect(response.status).toBe(200);
    expect(mocks.listConnectionPage).toHaveBeenCalledWith("target-1", "viewer-1", "followers", {
      cursor: { searchKey: "cayan akin", id: "user-20" },
      limit: 12,
    });
  });
});
