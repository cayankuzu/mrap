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
    await enforceGameLimit(user, request, "session-takeover", AUTHORITATIVE_GAME_CONFIG.limits.sessionStartsPerHour, 60 * 60 * 1_000);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.session);
    exactObjectKeys(body, ["action", "acknowledged", "mode"]);
    const mode = body.mode as CompetitiveLocationMode;
    if (body.action !== "takeover" || body.acknowledged !== true) gameError("INVALID_REQUEST", "Rota devralma onayı geçersiz.");
    if (mode !== "real_gps" && mode !== "development_simulation") gameError("INVALID_REQUEST", "Konum modu geçersiz.");
    return noStoreJson(await authoritativeGameStore.takeOverActiveSession(user.id, mode, correlationId), {
      headers: { "X-Correlation-Id": correlationId },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
