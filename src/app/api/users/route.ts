import { getCurrentUser } from "@/lib/auth";
import { PLAYER_SEARCH_LIMITS } from "@/lib/content-limits";
import { searchPlayers } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { checkRateLimit } from "@/server/http/rate-limit";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkRateLimit(request, `player-search:${user.id}`, 120, 10 * 60 * 1_000);
  if (limited) return limited;
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.length > PLAYER_SEARCH_LIMITS.queryMax) return noStoreJson({ error: `Arama en fazla ${PLAYER_SEARCH_LIMITS.queryMax} karakter olabilir.` }, { status: 400 });
  return noStoreJson({ players: await searchPlayers(user.id, query) });
}
