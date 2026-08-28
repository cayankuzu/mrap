import { getWorldCountries } from "@/lib/world-locations";
import { checkRateLimit } from "@/server/http/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "locations-countries", 60, 5 * 60 * 1_000);
  if (limited) return limited;
  try {
    const countries = await getWorldCountries();
    return Response.json({ countries }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch {
    return Response.json({ error: "Ülke listesi şu anda yüklenemiyor." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
