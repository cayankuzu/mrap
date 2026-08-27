import { describe, expect, it } from "vitest";
import { filterLeaderboardEntries } from "@/lib/leaderboard-filter";
import type { LeaderboardEntry } from "@/lib/models";

const entries: LeaderboardEntry[] = [
  { id: "u1", username: "bir", displayName: "Bir", initials: "B", color: "#111111", pattern: 0, city: "İstanbul", avatarData: null, areaKm2: 10, routes: 3, rank: 1 },
  { id: "u2", username: "cayan", displayName: "Çayan Akın", initials: "ÇA", color: "#222222", pattern: 0, city: "İstanbul", avatarData: null, areaKm2: 5, routes: 2, rank: 50 },
];

describe("sıralama filtresi", () => {
  it("Türkçe katlamayla arar ve filtre sonrasında gerçek sırayı korur", () => {
    expect(filterLeaderboardEntries(entries, "CAYAN")).toEqual([expect.objectContaining({ id: "u2", rank: 50 })]);
  });
});
