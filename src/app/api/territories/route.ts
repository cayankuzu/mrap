import { getCurrentUser } from "@/lib/auth";
import { getTerritoryMapState } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Yetkisiz." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json(await getTerritoryMapState(), { headers: { "Cache-Control": "no-store, private" } });
}

/**
 * Legacy client-polygon endpoint intentionally cannot mutate ownership.
 * Competitive claims must use the server-issued session → points → candidate → command flow.
 */
export async function POST() {
  return Response.json(
    {
      error: "Bu alan kapatma yöntemi güvenlik nedeniyle kaldırıldı.",
      code: "SERVER_AUTHORITATIVE_FLOW_REQUIRED",
      next: "/api/game/sessions",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
