import type { LeaderboardEntry } from "@/lib/models";
import { normalizeUserSearchText } from "@/lib/user-search";

export type LeaderboardScope = "friends" | "city" | "country" | "world";

export type ScopedLeaderboardEntry = LeaderboardEntry & {
  scopeRank: number;
};

export type LeaderboardScopeFilter = {
  scope: LeaderboardScope;
  currentUserId: string;
  followingIds: ReadonlySet<string>;
  selectedCityKeys: ReadonlySet<string>;
  selectedCountryCodes: ReadonlySet<string>;
};

/**
 * City ids can differ between legacy/local and canonical provider datasets.
 * Ranking filters therefore use the human location identity that survives a
 * database migration: ISO country code + normalized city label.
 */
export function leaderboardCityKey(countryCode: string, city: string) {
  return `${countryCode.trim().toUpperCase()}:${normalizeUserSearchText(city)}`;
}

function byAuthoritativeScore(left: LeaderboardEntry, right: LeaderboardEntry) {
  return right.areaKm2 - left.areaKm2
    || right.routes - left.routes
    || left.rank - right.rank
    || left.id.localeCompare(right.id);
}

/** Scope is applied before numbering so searches never change a player's scope rank. */
export function scopeLeaderboardEntries(entries: LeaderboardEntry[], filter: LeaderboardScopeFilter): ScopedLeaderboardEntry[] {
  return entries
    .filter((entry) => {
      if (filter.scope === "friends") return entry.id === filter.currentUserId || filter.followingIds.has(entry.id);
      if (filter.scope === "city") return filter.selectedCityKeys.has(leaderboardCityKey(entry.countryCode, entry.city));
      if (filter.scope === "country") return filter.selectedCountryCodes.has(entry.countryCode);
      return true;
    })
    .sort(byAuthoritativeScore)
    .map((entry, index) => ({ ...entry, scopeRank: index + 1 }));
}

/** Filtering never re-numbers entries; the scope rank remains stable while searching. */
export function filterLeaderboardEntries<T extends LeaderboardEntry>(entries: T[], query: string): T[] {
  const needle = normalizeUserSearchText(query);
  return needle
    ? entries.filter((entry) => normalizeUserSearchText(
      `${entry.displayName} ${entry.username} ${entry.city} ${entry.country}`,
    ).includes(needle))
    : entries;
}
