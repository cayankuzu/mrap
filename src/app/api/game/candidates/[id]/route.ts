import { getCurrentUser } from "@/lib/auth";
import { API_BODY_LIMITS, exactObjectKeys, noStoreJson, requireSessionNonce } from "@/server/game/api-helpers";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    const body = await readLimitedJsonObject(request, API_BODY_LIMITS.candidate);
    exactObjectKeys(body, ["action"]);
    if (body.action !== "continue") gameError("INVALID_REQUEST", "Döngü işlemi geçersiz.");
    const { id } = await context.params;
    const candidate = await authoritativeGameStore.continueCandidate({ userId: user.id, candidateId: id, nonce: requireSessionNonce(request) });
    return noStoreJson({ candidate }, { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    if (error instanceof RequestBodyError) return noStoreJson({ error: error.message, code: "INVALID_REQUEST", correlationId }, { status: error.status });
    return gameErrorResponse(error, correlationId);
  }
}
