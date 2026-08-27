import type { LeaderboardEntry } from "@/lib/models";
import { normalizeUserSearchText } from "@/lib/user-search";

/** Filtering never re-numbers entries; rank remains authoritative for its scope. */
export function filterLeaderboardEntries(entries: LeaderboardEntry[], query: string) {
  const needle = normalizeUserSearchText(query);
  return needle
    ? entries.filter((entry) => normalizeUserSearchText(`${entry.displayName} ${entry.username}`).includes(needle))
    : entries;
}
