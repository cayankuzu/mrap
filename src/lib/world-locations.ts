import "server-only";

import {
  getAllCitiesOfCountry,
  getCountries,
  type ICity,
  type ICountry,
} from "@countrystatecity/countries";
import { resolveLocation as resolveLegacyLocation } from "@/lib/app-config";

export type WorldCountryOption = Readonly<{ code: string; label: string }>;
export type WorldCityOption = Readonly<{ id: string; label: string; stateCode: string }>;

export const WORLD_LOCATION_LIMITS = Object.freeze({
  cityCacheCountryCount: 8,
  cityCacheTtlMs: 30 * 60 * 1_000,
  cityQueryLength: 80,
  cityResultCount: 80,
  selectedCityIdLength: 100,
});

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const WORLD_CITY_ID_PATTERN = /^csc:([A-Z]{2}):([^:]+):(\d+)$/;
type IndexedCity = WorldCityOption & Readonly<{ searchValue: string }>;
type CityCacheEntry = {
  promise: Promise<readonly IndexedCity[]>;
  expiresAt: number;
  lastAccessedAt: number;
};

const cityCache = new Map<string, CityCacheEntry>();
let countriesPromise: Promise<ICountry[]> | undefined;
let countryOptionsPromise: Promise<WorldCountryOption[]> | undefined;

function normalizeSearch(value: string) {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\u0131/g, "i");
}

function legacySlug(value: string) {
  return normalizeSearch(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function countryLabel(country: ICountry) {
  try {
    return new Intl.DisplayNames(["tr"], { type: "region" }).of(country.iso2) ?? country.native ?? country.name;
  } catch {
    return country.native || country.name;
  }
}

function cityLabel(city: ICity) {
  const legacy = resolveLegacyLocation(
    city.country_code,
    `${city.country_code.toLocaleLowerCase("en-US")}-${legacySlug(city.name)}`,
  );
  return legacy?.city || city.native?.trim() || city.name;
}

function cityId(city: ICity) {
  return `csc:${city.country_code.toUpperCase()}:${city.state_code || "_"}:${city.id}`;
}

async function loadCountries() {
  if (!countriesPromise) {
    const pending = getCountries();
    countriesPromise = pending;
    void pending.catch(() => {
      if (countriesPromise === pending) countriesPromise = undefined;
    });
  }
  return countriesPromise;
}

function worldCityOption(city: ICity): WorldCityOption {
  return { id: cityId(city), label: cityLabel(city), stateCode: city.state_code };
}

function pruneCityCache(now: number) {
  for (const [code, entry] of cityCache) {
    if (entry.expiresAt <= now) cityCache.delete(code);
  }
  while (cityCache.size >= WORLD_LOCATION_LIMITS.cityCacheCountryCount) {
    let oldestCode: string | undefined;
    let oldestAccess = Number.POSITIVE_INFINITY;
    for (const [code, entry] of cityCache) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestCode = code;
      }
    }
    if (!oldestCode) break;
    cityCache.delete(oldestCode);
  }
}

async function loadCityIndex(countryCode: string) {
  const code = countryCode.trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(code)) return [];
  const now = Date.now();
  const cached = cityCache.get(code);
  if (cached && cached.expiresAt > now) {
    cached.lastAccessedAt = now;
    return cached.promise;
  }

  if (cached) cityCache.delete(code);
  pruneCityCache(now);
  const pending = Promise.all([getAllCitiesOfCountry(code), loadCountries()]).then(([cities, countries]) => {
    const seen = new Set<string>();
    const indexed: IndexedCity[] = [];
    for (const city of cities) {
      const option = worldCityOption(city);
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      indexed.push({ ...option, searchValue: normalizeSearch(`${option.label} ${option.stateCode}`) });
    }
    if (indexed.length === 0) {
      const country = countries.find((item) => item.iso2.toUpperCase() === code);
      const capital = country?.capital.trim();
      if (country && capital) {
        indexed.push({
          id: `csc:${code}:_:${country.id}`,
          label: capital,
          stateCode: "",
          searchValue: normalizeSearch(capital),
        });
      }
    }
    indexed.sort((left, right) => left.label.localeCompare(right.label, "tr", { sensitivity: "base" }));
    return indexed;
  });
  cityCache.set(code, {
    promise: pending,
    expiresAt: now + WORLD_LOCATION_LIMITS.cityCacheTtlMs,
    lastAccessedAt: now,
  });
  void pending.catch(() => {
    if (cityCache.get(code)?.promise === pending) cityCache.delete(code);
  });
  return pending;
}

export async function getWorldCountries(): Promise<WorldCountryOption[]> {
  if (!countryOptionsPromise) {
    const pending = loadCountries().then((countries) => countries
      .map((country) => ({ code: country.iso2.toUpperCase(), label: countryLabel(country) }))
      .sort((left, right) => left.label.localeCompare(right.label, "tr", { sensitivity: "base" })));
    countryOptionsPromise = pending;
    void pending.catch(() => {
      if (countryOptionsPromise === pending) countryOptionsPromise = undefined;
    });
  }
  return countryOptionsPromise;
}

export async function searchWorldCities(input: {
  countryCode: string;
  query?: string;
  selectedCityId?: string;
  limit?: number;
}): Promise<{ cities: WorldCityOption[]; hasMore: boolean }> {
  const code = input.countryCode.trim().toUpperCase();
  const query = normalizeSearch((input.query ?? "").slice(0, WORLD_LOCATION_LIMITS.cityQueryLength));
  const limit = Math.min(Math.max(input.limit ?? WORLD_LOCATION_LIMITS.cityResultCount, 1), WORLD_LOCATION_LIMITS.cityResultCount);
  const allCities = await loadCityIndex(code);
  const matches: IndexedCity[] = [];
  for (const city of allCities) {
    if (query && !city.searchValue.includes(query)) continue;
    matches.push(city);
    if (matches.length > limit) break;
  }

  const result = matches.slice(0, limit).map(({ id, label, stateCode }) => ({ id, label, stateCode }));
  const selectedId = (input.selectedCityId ?? "").slice(0, WORLD_LOCATION_LIMITS.selectedCityIdLength);
  const selectedMatch = selectedId ? allCities.find((city) => city.id === selectedId) : undefined;
  const selected = selectedMatch
    ? { id: selectedMatch.id, label: selectedMatch.label, stateCode: selectedMatch.stateCode }
    : selectedId ? await resolveWorldCity(code, selectedId) : null;
  if (selected && !result.some((city) => city.id === selected.id)) result.unshift(selected);
  return { cities: result.slice(0, limit), hasMore: matches.length > limit };
}

export async function resolveWorldCity(countryCode: string, selectedCityId: string): Promise<WorldCityOption | null> {
  const code = countryCode.trim().toUpperCase();
  const boundedSelectedCityId = selectedCityId.slice(0, WORLD_LOCATION_LIMITS.selectedCityIdLength);
  const allCities = await loadCityIndex(code);
  const worldMatch = boundedSelectedCityId.match(WORLD_CITY_ID_PATTERN);
  let city: IndexedCity | undefined;

  if (worldMatch && worldMatch[1] === code) {
    city = allCities.find((item) => item.id === boundedSelectedCityId);
  } else if (boundedSelectedCityId.toLocaleLowerCase("en-US").startsWith(`${code.toLocaleLowerCase("en-US")}-`)) {
    const expectedSlug = boundedSelectedCityId.slice(3);
    city = allCities.find((item) => legacySlug(item.label) === expectedSlug);
  }

  return city ? { id: city.id, label: city.label, stateCode: city.stateCode } : null;
}

export async function resolveWorldLocation(countryCode: string, selectedCityId: string) {
  const legacy = resolveLegacyLocation(countryCode, selectedCityId);
  if (legacy) return legacy;
  const code = countryCode.trim().toUpperCase();
  const [countries, city] = await Promise.all([loadCountries(), resolveWorldCity(code, selectedCityId)]);
  const country = countries.find((item) => item.iso2.toUpperCase() === code);
  return country && city ? { country: countryLabel(country), city: city.label } : null;
}

export function isWorldCityId(value: string) {
  return WORLD_CITY_ID_PATTERN.test(value);
}
