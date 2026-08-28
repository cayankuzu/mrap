import "server-only";

import { createMrapSupabaseAdminClient } from "@/lib/supabase/admin-client";

export type SupabaseLocationCatalogEntry = Readonly<{
  countryCode: string;
  country: string;
  cityId: string;
  city: string;
}>;

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const LEGACY_CITY_ID_PATTERN = /^[a-z]{2}-[a-z0-9-]{2,80}$/;
const WORLD_CITY_ID_PATTERN = /^csc:([A-Z]{2}):[A-Za-z0-9_-]{1,16}:[0-9]{1,12}$/;

function validCatalogEntry(entry: SupabaseLocationCatalogEntry) {
  const countryCode = entry.countryCode.trim().toUpperCase();
  const country = entry.country.trim();
  const cityId = entry.cityId.trim();
  const city = entry.city.trim();
  const worldCountry = cityId.match(WORLD_CITY_ID_PATTERN)?.[1];
  const legacyMatchesCountry = LEGACY_CITY_ID_PATTERN.test(cityId)
    && cityId.startsWith(`${countryCode.toLocaleLowerCase("en-US")}-`);
  return COUNTRY_CODE_PATTERN.test(countryCode)
    && country.length >= 2
    && country.length <= 80
    && city.length >= 2
    && city.length <= 100
    && (legacyMatchesCountry || worldCountry === countryCode);
}

/**
 * Keeps the normalized Supabase FK catalogue in sync with a location that was
 * already validated against the server-only world dataset.
 */
export async function ensureSupabaseLocationCatalog(entry: SupabaseLocationCatalogEntry) {
  if (!validCatalogEntry(entry)) throw new Error("Supabase konum kataloğu girdisi geçersiz.");
  const countryCode = entry.countryCode.trim().toUpperCase();
  const admin = createMrapSupabaseAdminClient();
  const countryResult = await admin.from("countries").upsert({
    code: countryCode,
    name_tr: entry.country.trim(),
    is_active: true,
  }, { onConflict: "code" });
  if (countryResult.error) throw new Error("Supabase ülke kataloğu güncellenemedi.");

  const cityResult = await admin.from("cities").upsert({
    id: entry.cityId.trim(),
    country_code: countryCode,
    name_tr: entry.city.trim(),
    is_active: true,
  }, { onConflict: "id" });
  if (cityResult.error) throw new Error("Supabase şehir kataloğu güncellenemedi.");
}
