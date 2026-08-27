import { getCurrentUser } from "@/lib/auth";
import type { CloseLoopCommand } from "@/lib/game/authoritative-types";
import { API_BODY_LIMITS, enforceGameLimit, exactObjectKeys, noStoreJson, requireSessionNonce } from "@/server/game/api-helpers";
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
    await enforceGameLimit(user, request, "claim", AUTHORITATIVE_GAME_CONFIG.limits.claimsPerTenMinutes, 10 * 60 * 1_000);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.claim);
    exactObjectKeys(body, ["sessionId", "candidateId", "lastAcceptedPointSequence", "selectedColorId", "idempotencyKey"]);
    if (
      typeof body.sessionId !== "string"
      || typeof body.candidateId !== "string"
      || !Number.isSafeInteger(body.lastAcceptedPointSequence)
      || typeof body.selectedColorId !== "string"
      || typeof body.idempotencyKey !== "string"
    ) gameError("INVALID_REQUEST", "Alan kapatma komutu geçersiz.");
    const command = body as CloseLoopCommand;
    await enforceGameLimit(user, request, "claim-session", AUTHORITATIVE_GAME_CONFIG.limits.claimsPerTenMinutes, 10 * 60 * 1_000, command.sessionId);
    const worldId = await authoritativeGameStore.getSessionWorld(user.id, command.sessionId);
    const result = await authoritativeGameStore.claim({ userId: user.id, nonce: requireSessionNonce(request), command });
    const affectedRegions = Object.keys(result.affectedRegionVersions);
    const mapState = affectedRegions.length > 0
      ? await authoritativeGameStore.getMapState(worldId, affectedRegions)
      : { territories: [], paints: [] };
    return noStoreJson({ result, mapState }, {
      headers: { "X-Correlation-Id": correlationId },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
