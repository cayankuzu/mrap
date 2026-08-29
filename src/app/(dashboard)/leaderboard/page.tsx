import type { Metadata } from "next";
import { LeaderboardPageHeader } from "@/components/LeaderboardPageHeader";
import { RealLeaderboard } from "@/components/RealLeaderboard";
import { requireCurrentUser } from "@/lib/auth";
import { LEADERBOARD_LIMIT } from "@/lib/content-limits";
import { getScopedLeaderboard } from "@/lib/repository";
import { getWorldCountries, searchWorldCities } from "@/lib/world-locations";

export const metadata: Metadata = { title: "Sıralama" };
export default async function LeaderboardPage() {
  const user = await requireCurrentUser();
  const [entries, optionEntries, countries, cityCatalog] = await Promise.all([
    getScopedLeaderboard({
      scope: "city",
      viewerId: user.id,
      cities: [{ countryCode: user.countryCode, city: user.city }],
      countryCodes: [],
      limit: LEADERBOARD_LIMIT,
    }),
    getScopedLeaderboard({
      scope: "world",
      viewerId: user.id,
      cities: [],
      countryCodes: [],
      limit: LEADERBOARD_LIMIT,
    }),
    getWorldCountries().catch(() => []),
    searchWorldCities({ countryCode: user.countryCode, limit: 80 }).catch(() => ({ cities: [], hasMore: false })),
  ]);
  const cityOptions = cityCatalog.cities.map((city) => ({
    countryCode: user.countryCode,
    country: user.country,
    city: city.label,
  }));
  const countryOptions = countries.map((country) => ({ countryCode: country.code, country: country.label }));
  return <div className="content-page leaderboard-page"><LeaderboardPageHeader /><RealLeaderboard entries={entries} optionEntries={optionEntries} cityOptions={cityOptions} countryOptions={countryOptions} currentUser={user} remote /></div>;
}
