import { getCurrentUser } from "@/lib/auth";
import { getRouteSessionTotals, listRouteSessions } from "@/lib/repository";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Yetkisiz." }, { status: 401, headers: noStoreHeaders });
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "Liste sınırı 1–100 arasında olmalı." }, { status: 400, headers: noStoreHeaders });
  }
  const [sessions, totals] = await Promise.all([
    listRouteSessions(user.id, limit),
    getRouteSessionTotals(user.id),
  ]);
  return Response.json({ sessions, totals }, { headers: noStoreHeaders });
}

export async function POST() {
  return Response.json({
    error: "İstemci tarafından oluşturulan rota kayıtları artık kabul edilmiyor.",
    code: "SERVER_AUTHORITATIVE_FLOW_REQUIRED",
    next: "/api/game/sessions",
  }, { status: 410, headers: noStoreHeaders });
}
