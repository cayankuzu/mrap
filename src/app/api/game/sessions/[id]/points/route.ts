import { getCurrentUser } from "@/lib/auth";
import type { LocationPointCommand } from "@/lib/game/authoritative-types";
import { API_BODY_LIMITS, enforceGameLimit, exactObjectKeys, noStoreJson, requireSessionNonce } from "@/server/game/api-helpers";
import { AUTHORITATIVE_GAME_CONFIG } from "@/server/game/authoritative-config";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    const { id } = await context.params;
    await enforceGameLimit(user, request, "point-batch", AUTHORITATIVE_GAME_CONFIG.limits.pointBatchesPerMinute, 60_000, id);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.points);
    exactObjectKeys(body, ["idempotencyKey", "points"]);
    if (typeof body.idempotencyKey !== "string" || !Array.isArray(body.points)) gameError("INVALID_REQUEST", "Konum paketi geçersiz.");
    const result = await authoritativeGameStore.appendPointBatch({
      userId: user.id,
      sessionId: id,
      nonce: requireSessionNonce(request),
      idempotencyKey: body.idempotencyKey,
      points: body.points as LocationPointCommand[],
    });
    return noStoreJson(result, { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
