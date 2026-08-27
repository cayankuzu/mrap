import { getCurrentUser } from "@/lib/auth";
import { noStoreJson } from "@/server/game/api-helpers";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ idempotencyKey: string }> }) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    const { idempotencyKey } = await context.params;
    return noStoreJson(await authoritativeGameStore.getCommandResult(user.id, idempotencyKey), { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    return gameErrorResponse(error, correlationId);
  }
}
