import { getCurrentUser } from "@/lib/auth";
import { API_BODY_LIMITS, enforceGameLimit, exactObjectKeys, noStoreJson, requireSessionNonce } from "@/server/game/api-helpers";
import { AUTHORITATIVE_GAME_CONFIG } from "@/server/game/authoritative-config";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    const { id } = await context.params;
    return noStoreJson(await authoritativeGameStore.getSessionRecovery({
      userId: user.id,
      sessionId: id,
      nonce: requireSessionNonce(request),
    }), { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    return gameErrorResponse(error, correlationId);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.session);
    const { id } = await context.params;
    if (body.action === "resume_online") {
      exactObjectKeys(body, ["action", "expectedCurrentSegmentIndex"]);
      await enforceGameLimit(user, request, "online-segment", AUTHORITATIVE_GAME_CONFIG.limits.candidatesPerMinute, 60_000, id);
      if (!Number.isSafeInteger(body.expectedCurrentSegmentIndex) || Number(body.expectedCurrentSegmentIndex) < 0) {
        gameError("INVALID_REQUEST", "Rota segmenti doğrulanamadı.");
      }
      return noStoreJson(await authoritativeGameStore.beginOnlineSegment({
        userId: user.id,
        sessionId: id,
        nonce: requireSessionNonce(request),
        expectedCurrentSegmentIndex: Number(body.expectedCurrentSegmentIndex),
        correlationId,
      }), { headers: { "X-Correlation-Id": correlationId } });
    }
    exactObjectKeys(body, ["action"]);
    if (body.action !== "finish") gameError("INVALID_REQUEST", "Rota oturumu işlemi geçersiz.");
    return noStoreJson(await authoritativeGameStore.finishSession({ userId: user.id, sessionId: id, nonce: requireSessionNonce(request) }), {
      headers: { "X-Correlation-Id": correlationId },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
