import { getCurrentUser } from "@/lib/auth";
import { LEADERBOARD_LIMIT } from "@/lib/content-limits";
import type { LeaderboardDataScope } from "@/lib/models";
import { getScopedLeaderboard } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { checkRateLimit } from "@/server/http/rate-limit";

const SCOPES = new Set<LeaderboardDataScope>(["friends", "city", "country", "world"]);
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const MAX_LOCATION_SELECTIONS = LEADERBOARD_LIMIT;
const MAX_CITY_NAME_LENGTH = 120;

function parseScope(value: string | null): LeaderboardDataScope | null {
  return value && SCOPES.has(value as LeaderboardDataScope) ? value as LeaderboardDataScope : null;
}

function parseLimit(value: string | null) {
  if (value === null) return LEADERBOARD_LIMIT;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= LEADERBOARD_LIMIT ? limit : null;
}

function normalizeCountryCode(value: string) {
  const countryCode = value.trim();
  return /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : null;
}

function parseCountryCodes(values: string[]) {
  if (values.length > MAX_LOCATION_SELECTIONS) return null;
  const unique = new Set<string>();
  for (const value of values) {
    const countryCode = normalizeCountryCode(value);
    if (!countryCode) return null;
    unique.add(countryCode);
  }
  return [...unique];
}

function parseCities(values: string[]) {
  if (values.length > MAX_LOCATION_SELECTIONS) return null;
  const unique = new Map<string, { countryCode: string; city: string }>();
  for (const value of values) {
    const separatorIndex = value.indexOf(":");
    if (separatorIndex < 0) return null;
    const countryCode = normalizeCountryCode(value.slice(0, separatorIndex));
    const city = value.slice(separatorIndex + 1).trim();
    if (!countryCode
      || city.length < 1
      || city.length > MAX_CITY_NAME_LENGTH
      || CONTROL_CHARACTER_PATTERN.test(city)) return null;
    unique.set(`${countryCode}\u0000${city}`, { countryCode, city });
  }
  return [...unique.values()];
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkRateLimit(request, `leaderboard-read:${user.id}`, 240, 10 * 60 * 1_000);
  if (limited) return limited;

  const searchParams = new URL(request.url).searchParams;
  const scopeValues = searchParams.getAll("scope");
  const limitValues = searchParams.getAll("limit");
  const scope = scopeValues.length === 1 ? parseScope(scopeValues[0]) : null;
  const limit = limitValues.length <= 1 ? parseLimit(limitValues[0] ?? null) : null;
  const cities = parseCities(searchParams.getAll("city"));
  const countryCodes = parseCountryCodes(searchParams.getAll("country"));
  if (!scope) return noStoreJson({ error: "Sıralama kapsamı geçersiz." }, { status: 400 });
  if (limit === null) return noStoreJson({ error: `Limit 1–${LEADERBOARD_LIMIT} arasında olmalı.` }, { status: 400 });
  if (!cities) return noStoreJson({ error: "Şehir seçimi geçersiz." }, { status: 400 });
  if (!countryCodes) return noStoreJson({ error: "Ülke seçimi geçersiz." }, { status: 400 });
  if (scope === "city" && cities.length === 0) return noStoreJson({ error: "En az bir şehir seçmelisin." }, { status: 400 });
  if (scope === "country" && countryCodes.length === 0) return noStoreJson({ error: "En az bir ülke seçmelisin." }, { status: 400 });

  const entries = await getScopedLeaderboard({
    scope,
    viewerId: user.id,
    cities,
    countryCodes,
    limit,
  });
  return noStoreJson({ entries });
}
