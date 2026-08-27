import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ purgeExpiredRawLocations: vi.fn() }));
vi.mock("@/server/game/store", () => ({
  authoritativeGameStore: { purgeExpiredRawLocations: mocks.purgeExpiredRawLocations },
}));

import { GET } from "@/app/api/internal/maintenance/location-retention/route";

const SECRET = "cron-secret-at-least-16";

function request(secret = SECRET) {
  return new Request("http://localhost/api/internal/maintenance/location-retention", {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("MRAP_DATA_PROVIDER", "sqlite");
  mocks.purgeExpiredRawLocations.mockReset();
  mocks.purgeExpiredRawLocations.mockReturnValue(12);
});

afterEach(() => vi.unstubAllEnvs());

describe("konum saklama bakımı", () => {
  it("yetkisiz istekte konum verisine dokunmaz", async () => {
    const response = await GET(request("yanlis-secret-degeri"));
    expect(response.status).toBe(401);
    expect(mocks.purgeExpiredRawLocations).not.toHaveBeenCalled();
  });

  it("yerel authoritative store üzerinde süresi dolan ham noktaları temizler", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, deletedPoints: 12, hasMore: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.purgeExpiredRawLocations).toHaveBeenCalledOnce();
  });

  it("yerel transaction hatasını ayrıntı sızdırmadan bildirir", async () => {
    mocks.purgeExpiredRawLocations.mockImplementation(() => { throw new Error("database path"); });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Yerel konum saklama bakımı tamamlanamadı." });
  });

  it("uzak provider yapılandırılmamışsa açıkça 503 döndürür", async () => {
    vi.stubEnv("MRAP_DATA_PROVIDER", "supabase");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
  });
});
