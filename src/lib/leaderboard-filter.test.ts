import { describe, expect, it } from "vitest";
import { filterLeaderboardEntries, leaderboardCityKey, scopeLeaderboardEntries } from "@/lib/leaderboard-filter";
import type { LeaderboardEntry } from "@/lib/models";

const entries: LeaderboardEntry[] = [
  { id: "u1", username: "bir", displayName: "Bir", initials: "B", color: "#111111", pattern: 0, countryCode: "TR", cityId: "tr-istanbul", country: "Türkiye", city: "İstanbul", avatarData: null, areaKm2: 10, routes: 3, rank: 1 },
  { id: "u2", username: "cayan", displayName: "Çayan Akın", initials: "ÇA", color: "#222222", pattern: 0, countryCode: "TR", cityId: "tr-istanbul", country: "Türkiye", city: "İstanbul", avatarData: null, areaKm2: 5, routes: 2, rank: 2 },
  { id: "u3", username: "ece", displayName: "Ece Güner", initials: "EG", color: "#333333", pattern: 0, countryCode: "TR", cityId: "tr-ankara", country: "Türkiye", city: "Ankara", avatarData: null, areaKm2: 8, routes: 5, rank: 3 },
  { id: "u4", username: "alp", displayName: "Alp Duran", initials: "AD", color: "#444444", pattern: 0, countryCode: "DE", cityId: "de-berlin", country: "Almanya", city: "Berlin", avatarData: null, areaKm2: 7, routes: 4, rank: 4 },
];

const baseFilter = {
  currentUserId: "u2",
  followingIds: new Set(["u3"]),
  selectedCityKeys: new Set([leaderboardCityKey("TR", "İstanbul")]),
  selectedCountryCodes: new Set(["TR"]),
};

describe("sıralama filtresi", () => {
  it("Türkçe katlamayla oyuncu ve konum arar, mevcut kapsam sırasını korur", () => {
    const scoped = scopeLeaderboardEntries(entries, { ...baseFilter, scope: "world" });
    expect(filterLeaderboardEntries(scoped, "CAYAN")).toEqual([expect.objectContaining({ id: "u2", scopeRank: 4 })]);
    expect(filterLeaderboardEntries(scoped, "ALMANYA")).toEqual([expect.objectContaining({ id: "u4", scopeRank: 3 })]);
  });

  it("birden fazla şehri OR mantığıyla filtreler ve kapsamı yeniden sıralar", () => {
    const result = scopeLeaderboardEntries(entries, {
      ...baseFilter,
      scope: "city",
      selectedCityKeys: new Set([leaderboardCityKey("TR", "İstanbul"), leaderboardCityKey("DE", "Berlin")]),
    });
    expect(result.map(({ id, scopeRank }) => [id, scopeRank])).toEqual([["u1", 1], ["u4", 2], ["u2", 3]]);
  });

  it("birden fazla ülkeyi OR mantığıyla filtreler", () => {
    const result = scopeLeaderboardEntries(entries, {
      ...baseFilter,
      scope: "country",
      selectedCountryCodes: new Set(["TR", "DE"]),
    });
    expect(result.map((entry) => entry.id)).toEqual(["u1", "u3", "u4", "u2"]);
  });

  it("aynı şehir için legacy ve canonical şehir kimliklerini tek seçimde birleştirir", () => {
    const aliases = [
      entries[0],
      { ...entries[1], cityId: "csc:TR:34", city: "İSTANBUL" },
    ];
    const result = scopeLeaderboardEntries(aliases, {
      ...baseFilter,
      scope: "city",
      selectedCityKeys: new Set([leaderboardCityKey("TR", "İstanbul")]),
    });
    expect(result.map((entry) => entry.id)).toEqual(["u1", "u2"]);
  });

  it("arkadaşlarda kullanıcının kendisini ve takip ettiklerini gösterir", () => {
    const result = scopeLeaderboardEntries(entries, { ...baseFilter, scope: "friends" });
    expect(result.map((entry) => entry.id)).toEqual(["u3", "u2"]);
  });

  it("filtrelerken gerçek alan değerlerini değiştirmez", () => {
    const result = scopeLeaderboardEntries(entries, { ...baseFilter, scope: "world" });
    expect(result.map((entry) => entry.areaKm2)).toEqual([10, 8, 7, 5]);
  });
});
