import { getCurrentUser } from "@/lib/auth";
import { decodeConnectionCursor } from "@/lib/connection-cursor";
import { CONNECTION_PAGE_LIMITS } from "@/lib/content-limits";
import { getConnectionListAccess, listConnectionPage } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { checkRateLimit } from "@/server/http/rate-limit";

function parseLimit(value: string | null) {
  if (value === null) return CONNECTION_PAGE_LIMITS.default;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= CONNECTION_PAGE_LIMITS.max ? limit : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkRateLimit(request, `connection-list:${user.id}`, 120, 60 * 60 * 1_000);
  if (limited) return limited;

  const searchParams = new URL(request.url).searchParams;
  const type = searchParams.get("type");
  if (type !== "followers" && type !== "following") return noStoreJson({ error: "Liste türü geçersiz." }, { status: 400 });

  const limit = parseLimit(searchParams.get("limit"));
  if (limit === null) return noStoreJson({ error: `Limit 1–${CONNECTION_PAGE_LIMITS.max} arasında olmalı.` }, { status: 400 });
  const encodedCursor = searchParams.get("cursor");
  const cursor = encodedCursor === null ? null : decodeConnectionCursor(encodedCursor);
  if (encodedCursor !== null && !cursor) return noStoreJson({ error: "Bağlantı imleci geçersiz." }, { status: 400 });

  const targetId = (await params).id;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) return noStoreJson({ error: "Kullanıcı kimliği geçersiz." }, { status: 400 });
  const access = await getConnectionListAccess(targetId, user.id);
  if (access === "not_found") return noStoreJson({ error: "Kullanıcı bulunamadı." }, { status: 404 });
  if (access === "forbidden") return noStoreJson({ error: "Bu hesap bağlantı listesini gizli tutuyor." }, { status: 403 });

  const page = await listConnectionPage(targetId, user.id, type, { cursor, limit });
  return noStoreJson({ type, ...page });
}
