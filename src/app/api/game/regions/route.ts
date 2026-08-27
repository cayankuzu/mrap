import { getCurrentUser } from "@/lib/auth";
import { enforceGameLimit, noStoreJson, requestedWorld } from "@/server/game/api-helpers";
import { AUTHORITATIVE_GAME_CONFIG } from "@/server/game/authoritative-config";
import { gameError, gameErrorResponse } from "@/server/game/authoritative-error";
import { correlationIdFrom } from "@/server/game/safe-telemetry";
import { authoritativeGameStore } from "@/server/game/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = correlationIdFrom(request);
  try {
    const user = await getCurrentUser();
    if (!user) gameError("UNAUTHORIZED", "Oturum açmalısın.", 401);
    await enforceGameLimit(user, request, "region-snapshot", AUTHORITATIVE_GAME_CONFIG.limits.snapshotsPerMinute, 60_000);
    const url = new URL(request.url);
    const regions = (url.searchParams.get("regions") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const snapshot = await authoritativeGameStore.getRegionSnapshot(requestedWorld(request), regions);
    await authoritativeGameStore.recordMetric("region_snapshot_served_total");
    return noStoreJson({ snapshot }, { headers: { "X-Correlation-Id": correlationId } });
  } catch (error) {
    return gameErrorResponse(error, correlationId);
  }
}
