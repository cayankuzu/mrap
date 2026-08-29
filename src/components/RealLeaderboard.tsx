import { LeaderboardClient } from "@/components/LeaderboardClient";
import type { AppUser, LeaderboardEntry } from "@/lib/models";

export function RealLeaderboard({
  entries,
  optionEntries,
  cityOptions,
  countryOptions,
  currentUser,
  remote = true,
}: {
  entries: LeaderboardEntry[];
  optionEntries: LeaderboardEntry[];
  cityOptions: Array<{ countryCode: string; country: string; city: string }>;
  countryOptions: Array<{ countryCode: string; country: string }>;
  currentUser: Pick<AppUser, "id" | "cityId" | "city" | "countryCode" | "country">;
  remote?: boolean;
}) {
  return (
    <LeaderboardClient
      entries={entries}
      optionEntries={optionEntries}
      cityOptions={cityOptions}
      countryOptions={countryOptions}
      currentUser={currentUser}
      profileBasePath="/users"
      selfProfilePath="/profile"
      remote={remote}
    />
  );
}
