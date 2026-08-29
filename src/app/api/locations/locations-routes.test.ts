import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getWorldCountries: vi.fn(),
  searchWorldCities: vi.fn(),
}));

vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/world-locations", () => ({
  WORLD_LOCATION_LIMITS: {
    cityQueryLength: 80,
    cityResultCount: 100,
    selectedCityIdLength: 100,
  },
  getWorldCountries: mocks.getWorldCountries,
  searchWorldCities: mocks.searchWorldCities,
}));

import { GET as getCities } from "@/app/api/locations/cities/route";
import { GET as getCountries } from "@/app/api/locations/countries/route";

describe("konum kataloğu endpoint korumaları", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.getWorldCountries.mockResolvedValue([{ code: "TR", label: "Türkiye" }]);
    mocks.searchWorldCities.mockResolvedValue({ cities: [], hasMore: false });
  });

  it("ülke ve şehir isteklerini veri okumadan önce hız sınırından geçirir", async () => {
    const limited = Response.json({ error: "limit" }, { status: 429 });
    mocks.checkRateLimit.mockResolvedValue(limited);

    await expect(getCountries(new Request("https://mrap.test/api/locations/countries"))).resolves.toBe(limited);
    await expect(getCities(new Request("https://mrap.test/api/locations/cities?country=TR"))).resolves.toBe(limited);
    expect(mocks.getWorldCountries).not.toHaveBeenCalled();
    expect(mocks.searchWorldCities).not.toHaveBeenCalled();
  });

  it("geçersiz veya aşırı uzun şehir sorgusunu işleme almadan reddeder", async () => {
    const invalidCountry = await getCities(new Request("https://mrap.test/api/locations/cities?country=TUR"));
    const oversizedQuery = await getCities(new Request(`https://mrap.test/api/locations/cities?country=TR&q=${"a".repeat(81)}`));

    expect(invalidCountry.status).toBe(400);
    expect(oversizedQuery.status).toBe(400);
    expect(mocks.searchWorldCities).not.toHaveBeenCalled();
  });

  it("arama yanıtını paylaşımlı CDN önbelleğine bırakmaz ve domain limitini kullanır", async () => {
    const response = await getCities(new Request("https://mrap.test/api/locations/cities?country=tr&q=ankara"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    expect(mocks.searchWorldCities).toHaveBeenCalledWith({
      countryCode: "TR",
      query: "ankara",
      selectedCityId: "",
      limit: 100,
    });
  });

  it("katalog hatalarını iç detay sızdırmadan geçici servis hatasına dönüştürür", async () => {
    mocks.getWorldCountries.mockRejectedValue(new Error("secret upstream path"));
    mocks.searchWorldCities.mockRejectedValue(new Error("secret city file"));

    const countryResponse = await getCountries(new Request("https://mrap.test/api/locations/countries"));
    const cityResponse = await getCities(new Request("https://mrap.test/api/locations/cities?country=TR"));

    expect(countryResponse.status).toBe(503);
    expect(cityResponse.status).toBe(503);
    expect(await countryResponse.text()).not.toContain("secret");
    expect(await cityResponse.text()).not.toContain("secret");
  });
});
