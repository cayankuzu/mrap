import { randomUUID } from "node:crypto";
import { hasValidCronAuthorization } from "@/server/maintenance/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  const correlationId = randomUUID();
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ ok: false, error: "Yetkisiz.", correlationId }, { status: 401, headers: responseHeaders });
  }

  if ((process.env.MRAP_DATA_PROVIDER ?? "sqlite") === "sqlite") {
    try {
      const { authoritativeGameStore } = await import("@/server/game/store");
      const deletedPoints = await authoritativeGameStore.purgeExpiredRawLocations();
      return Response.json({ ok: true, deletedPoints, hasMore: false, correlationId }, { headers: responseHeaders });
    } catch {
      return Response.json({ ok: false, error: "Yerel konum saklama bakımı tamamlanamadı.", correlationId }, { status: 500, headers: responseHeaders });
    }
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return Response.json({ ok: false, error: "Bakım veri bağlantısı yapılandırılmadı.", correlationId }, { status: 503, headers: responseHeaders });
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/purge_expired_location_data`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_limit: 25000 }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      return Response.json({ ok: false, error: "Konum saklama bakımı tamamlanamadı.", correlationId }, { status: 502, headers: responseHeaders });
    }

    const result = await response.json() as { deletedBatches?: number; hasMore?: boolean };
    return Response.json({
      ok: true,
      deletedBatches: Number.isSafeInteger(result.deletedBatches) ? result.deletedBatches : 0,
      hasMore: result.hasMore === true,
      correlationId,
    }, { headers: responseHeaders });
  } catch {
    return Response.json({ ok: false, error: "Konum saklama bakımı zaman aşımına uğradı.", correlationId }, { status: 504, headers: responseHeaders });
  }
}
