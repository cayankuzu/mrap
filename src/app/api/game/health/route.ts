import { getCurrentUser } from "@/lib/auth";
import { noStoreJson } from "@/server/game/api-helpers";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = correlationIdFrom(request);
  try {
    if (process.env.NODE_ENV === "production") gameError("NOT_FOUND", "Kaynak bulunamadı.", 404);
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    return noStoreJson(await authoritativeGameStore.health(), { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    return gameErrorResponse(error, correlationId);
  }
}
