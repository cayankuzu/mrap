import { searchWorldCities, WORLD_LOCATION_LIMITS } from "@/lib/world-locations";
import { checkRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "locations-cities", 120, 60 * 1_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const rawCountryCode = url.searchParams.get("country") ?? "";
  const rawQuery = url.searchParams.get("q") ?? "";
  const rawSelectedCityId = url.searchParams.get("selected") ?? "";
  const countryCode = rawCountryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return Response.json({ error: "Geçerli bir ülke seç." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (rawQuery.length > WORLD_LOCATION_LIMITS.cityQueryLength || rawSelectedCityId.length > WORLD_LOCATION_LIMITS.selectedCityIdLength) {
    return Response.json({ error: "Şehir araması izin verilen uzunluğu aşıyor." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await searchWorldCities({
      countryCode,
      query: rawQuery.trim(),
      selectedCityId: rawSelectedCityId.trim(),
      limit: WORLD_LOCATION_LIMITS.cityResultCount,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return Response.json({ error: "Şehir listesi şu anda yüklenemiyor." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
