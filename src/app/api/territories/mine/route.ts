import { getCurrentUser } from "@/lib/auth";
import { listPostableTerritories } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Yetkisiz." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 30) : 30;
  return Response.json(
    { territories: await listPostableTerritories(user.id, limit) },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
