import { getCurrentUser } from "@/lib/auth";
import type { CompetitiveLocationMode } from "@/lib/game/authoritative-types";
import { API_BODY_LIMITS, enforceGameLimit, exactObjectKeys, noStoreJson } from "@/server/game/api-helpers";
import { AUTHORITATIVE_GAME_CONFIG } from "@/server/game/authoritative-config";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    await enforceGameLimit(user, request, "session-start", AUTHORITATIVE_GAME_CONFIG.limits.sessionStartsPerHour, 60 * 60 * 1_000);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.session);
    exactObjectKeys(body, ["mode"]);
    const mode = body.mode as CompetitiveLocationMode;
    if (mode !== "real_gps" && mode !== "development_simulation") gameError("INVALID_REQUEST", "Konum modu geçersiz.");
    const session = await authoritativeGameStore.startSession(user.id, mode, correlationId);
    return noStoreJson({ session }, { status: 201, headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
