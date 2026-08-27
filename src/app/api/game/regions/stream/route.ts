import { getCurrentUser } from "@/lib/auth";
import { enforceGameLimit, requestedWorld } from "@/server/game/api-helpers";
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
    await enforceGameLimit(user, request, "realtime-subscription", AUTHORITATIVE_GAME_CONFIG.limits.realtimeSubscriptionsPerMinute, 60_000);
    const url = new URL(request.url);
    const regions = (url.searchParams.get("regions") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const worldId = requestedWorld(request);
    let cursor = Number(url.searchParams.get("after") ?? 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) gameError("INVALID_REQUEST", "Gerçek zamanlı akış imleci geçersiz.");
    // Validate region access before starting the long-lived stream.
    const validationSnapshot = await authoritativeGameStore.getRegionSnapshot(worldId, regions);
    const replayGap = validationSnapshot.latestOutboxSequence - cursor;
    const initialResync = cursor > validationSnapshot.latestOutboxSequence
      || replayGap > AUTHORITATIVE_GAME_CONFIG.realtime.maximumReplayEvents;
    if (initialResync) cursor = validationSnapshot.latestOutboxSequence;
    await authoritativeGameStore.recordMetric("realtime_connection_opened_total");
    const encoder = new TextEncoder();
    let interval: ReturnType<typeof setInterval> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let polling = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) return;
          closed = true;
          if (interval) clearInterval(interval);
          if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        };
        const send = (event: string, data: unknown) => {
          if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        send("ready", { worldId, cursor, correlationId });
        if (initialResync) send("resync", { reason: "cursor_outside_replay_window", cursor });
        interval = setInterval(async () => {
          if (closed || polling) return;
          polling = true;
          try {
            const entries = await authoritativeGameStore.listRegionEvents(worldId, regions, cursor);
            for (const entry of entries) {
              cursor = Math.max(cursor, entry.sequence);
              send("patch", entry);
            }
          } catch {
            try {
              const recovery = await authoritativeGameStore.getRegionSnapshot(worldId, regions);
              cursor = recovery.latestOutboxSequence;
              send("resync", { reason: "stream_read_failed", cursor });
            } catch {
              close();
            }
          } finally {
            polling = false;
          }
        }, AUTHORITATIVE_GAME_CONFIG.realtime.streamPollMs);
        heartbeat = setInterval(() => send("heartbeat", { cursor }), AUTHORITATIVE_GAME_CONFIG.realtime.streamHeartbeatMs);
        request.signal.addEventListener("abort", close, { once: true });
      },
      cancel() {
        closed = true;
        if (interval) clearInterval(interval);
        if (heartbeat) clearInterval(heartbeat);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Correlation-Id": correlationId,
      },
    });
  } catch (error) {
    return gameErrorResponse(error, correlationId);
  }
}
