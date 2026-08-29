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

  it("Türkiye için yalnızca 81 ili sunar; ilçeleri şehir kataloğuna karıştırmaz", async () => {
    expect((await getAllCitiesOfCountry("TR")).length).toBeGreaterThan(900);
    const result = await searchWorldCities({ countryCode: "TR", query: "" });
    expect(result.cities).toHaveLength(81);
    expect(result.hasMore).toBe(false);

    const allProvinceLabels = result.cities.map((city) => city.label);
    expect(new Set(allProvinceLabels)).toHaveLength(81);
    expect(allProvinceLabels).toContain("İstanbul");
    expect(allProvinceLabels).not.toContain("Kadıköy");
    expect(allProvinceLabels).not.toContain("Çankaya");

    const districtSearch = await searchWorldCities({ countryCode: "TR", query: "Kadıköy" });
    expect(districtSearch.cities).toEqual([]);

    const istanbulResult = await searchWorldCities({ countryCode: "TR", query: "istanbul" });
    const istanbul = istanbulResult.cities.find((city) => city.label.toLocaleLowerCase("tr-TR").includes("istanbul"));
    expect(istanbul?.id).toMatch(/^csc:TR:/);
    await expect(resolveWorldLocation("TR", istanbul!.id)).resolves.toEqual({
      country: "Türkiye",
      city: "İstanbul",
      cityId: istanbul!.id,
    });
    await expect(resolveWorldLocation("DE", istanbul!.id)).resolves.toBeNull();
  });

  it("önceden kaydedilmiş Türkiye ilçe kimliklerini bağlı oldukları ile taşır", async () => {
    const legacyDistrict = (await getAllCitiesOfCountry("TR")).find(
      (city) => city.state_code === "34" && city.name === "Adalar",
    );
    expect(legacyDistrict).toBeDefined();

    await expect(resolveWorldLocation("TR", `csc:TR:34:${legacyDistrict!.id}`)).resolves.toEqual({
      country: "Türkiye",
      city: "İstanbul",
      cityId: expect.stringMatching(/^csc:TR:34:/),
    });
  });

  it("diğer ülkelerde ülkeye bağlı gerçek şehir kataloğunu korur", async () => {
    const germany = await searchWorldCities({ countryCode: "DE", query: "Berlin" });
    expect(germany.cities).toContainEqual(
      expect.objectContaining({ id: expect.stringMatching(/^csc:DE:/), label: "Berlin" }),
    );
    expect((await searchWorldCities({ countryCode: "FR", query: "Berlin" })).cities).toEqual([]);
  });

  it("şehir dosyası bulunmayan yerleşik ülkelerde başkenti güvenli seçenek olarak sunar", async () => {
    const result = await searchWorldCities({ countryCode: "VA", query: "vatican" });
    expect(result.cities).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^csc:VA:_:\d+$/), label: "Vatican City" }),
    ]);
    await expect(resolveWorldLocation("VA", result.cities[0]!.id)).resolves.toEqual({
      country: "Vatikan",
      city: "Vatican City",
      cityId: result.cities[0]!.id,
    });
  });

  it("doğrudan domain çağrılarında dahi sonuç ve girdi kaynaklarını sınırlar", async () => {
    const result = await searchWorldCities({
      countryCode: "TR",
      query: "",
      limit: Number.MAX_SAFE_INTEGER,
    });
    expect(result.cities).toHaveLength(81);
    expect(result.hasMore).toBe(false);

    const oversizedQuery = `istanbul${"x".repeat(WORLD_LOCATION_LIMITS.cityQueryLength * 2)}`;
    await expect(searchWorldCities({ countryCode: "TR", query: oversizedQuery })).resolves.toMatchObject({ cities: [] });
  });
});
