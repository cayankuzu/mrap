import { getCurrentUser } from "@/lib/auth";
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
    await enforceGameLimit(user, request, "candidate", AUTHORITATIVE_GAME_CONFIG.limits.candidatesPerMinute, 60_000);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.candidate);
    exactObjectKeys(body, ["sessionId", "lastAcceptedPointSequence"]);
    if (typeof body.sessionId !== "string" || !Number.isSafeInteger(body.lastAcceptedPointSequence)) gameError("INVALID_REQUEST", "Döngü isteği geçersiz.");
    await enforceGameLimit(user, request, "candidate-session", AUTHORITATIVE_GAME_CONFIG.limits.candidatesPerMinute, 60_000, body.sessionId);
    const candidate = await authoritativeGameStore.createLoopCandidate({
      userId: user.id,
      sessionId: body.sessionId,
      nonce: requireSessionNonce(request),
      lastAcceptedPointSequence: Number(body.lastAcceptedPointSequence),
    });
    return noStoreJson({ candidate }, { status: 201, headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
