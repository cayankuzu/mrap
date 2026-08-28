import { describe, expect, it, vi } from "vitest";
import { getAllCitiesOfCountry } from "@countrystatecity/countries";

vi.mock("server-only", () => ({}));

import { getWorldCountries, resolveWorldLocation, searchWorldCities, WORLD_LOCATION_LIMITS } from "@/lib/world-locations";

describe("dünya ülke ve şehir kataloğu", () => {
  it("tüm ISO ülkelerini Türkçe etiketlerle sunar", async () => {
    const countries = await getWorldCountries();
    expect(countries.length).toBeGreaterThanOrEqual(240);
    expect(countries).toContainEqual({ code: "TR", label: "Türkiye" });
    expect(new Set(countries.map((country) => country.code))).toHaveLength(countries.length);
  });

  it("şehirleri yalnız seçilen ülke içinde arar ve kararlı kimlik üretir", async () => {
    expect((await getAllCitiesOfCountry("TR")).length).toBeGreaterThan(900);
    const result = await searchWorldCities({ countryCode: "TR", query: "istanbul" });
    const istanbul = result.cities.find((city) => city.label.toLocaleLowerCase("tr-TR").includes("istanbul"));
    expect(istanbul?.id).toMatch(/^csc:TR:/);
    await expect(resolveWorldLocation("TR", istanbul!.id)).resolves.toEqual({ country: "Türkiye", city: "İstanbul" });
    await expect(resolveWorldLocation("DE", istanbul!.id)).resolves.toBeNull();
  });

  it("şehir dosyası bulunmayan yerleşik ülkelerde başkenti güvenli seçenek olarak sunar", async () => {
    const result = await searchWorldCities({ countryCode: "VA", query: "vatican" });
    expect(result.cities).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^csc:VA:_:\d+$/), label: "Vatican City" }),
    ]);
    await expect(resolveWorldLocation("VA", result.cities[0]!.id)).resolves.toEqual({
      country: "Vatikan",
      city: "Vatican City",
    });
  });

  it("doğrudan domain çağrılarında dahi sonuç ve girdi kaynaklarını sınırlar", async () => {
    const result = await searchWorldCities({
      countryCode: "TR",
      query: "",
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(result.cities).toHaveLength(WORLD_LOCATION_LIMITS.cityResultCount);
    expect(result.hasMore).toBe(true);

    const oversizedQuery = `istanbul${"x".repeat(WORLD_LOCATION_LIMITS.cityQueryLength * 2)}`;
    await expect(searchWorldCities({ countryCode: "TR", query: oversizedQuery })).resolves.toMatchObject({ cities: [] });
  });
});
