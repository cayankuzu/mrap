import { getCurrentUser } from "@/lib/auth";
import { decodeCommentCursor } from "@/lib/comment-cursor";
import { COMMENT_PAGE_LIMITS, CONTENT_LIMITS } from "@/lib/content-limits";
import { addComment, listPostComments } from "@/lib/repository";
import { readLimitedJsonObject, RequestBodyError } from "@/server/http/limited-json";
import { checkRateLimit } from "@/server/http/rate-limit";
import { IDEMPOTENCY_KEY_PATTERN, IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";

const COMMENT_BODY_MAX_BYTES = 4_096;
const COMMENT_RATE_LIMIT = 30;
const COMMENT_RATE_WINDOW_MS = 10 * 60 * 1_000;
const COMMENT_LIST_RATE_LIMIT = 120;
const COMMENT_LIST_RATE_WINDOW_MS = 60 * 60 * 1_000;

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(value, { ...init, headers });
}

function parseLimit(value: string | null) {
  if (value === null) return COMMENT_PAGE_LIMITS.default;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= COMMENT_PAGE_LIMITS.max ? limit : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Yetkisiz." }, { status: 401 });

  const limited = await checkRateLimit(request, `post-comments-list:${user.id}`, COMMENT_LIST_RATE_LIMIT, COMMENT_LIST_RATE_WINDOW_MS);
  if (limited) return limited;

  const searchParams = new URL(request.url).searchParams;
  const limit = parseLimit(searchParams.get("limit"));
  if (limit === null) return json({ error: `Limit 1–${COMMENT_PAGE_LIMITS.max} arasında olmalı.` }, { status: 400 });

  const encodedCursor = searchParams.get("cursor");
  const cursor = encodedCursor === null ? null : decodeCommentCursor(encodedCursor);
  if (encodedCursor !== null && !cursor) return json({ error: "Yorum imleci geçersiz." }, { status: 400 });

  const result = await listPostComments(user.id, (await params).id, { cursor, limit });
  return result
    ? json(result)
    : json({ error: "Gönderi bulunamadı." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Yetkisiz." }, { status: 401 });

  const limited = await checkRateLimit(request, `post-comment-create:${user.id}`, COMMENT_RATE_LIMIT, COMMENT_RATE_WINDOW_MS);
  if (limited) return limited;

  try {
    const body = await readLimitedJsonObject(request, COMMENT_BODY_MAX_BYTES);
    if (Object.keys(body).length !== 2 || !("body" in body) || !("idempotencyKey" in body)) {
      return json({ error: "Yalnızca yorum metni ve güvenli gönderim anahtarı gönderilebilir." }, { status: 400 });
    }
    if (typeof body.body !== "string") return json({ error: "Yorum metni geçersiz." }, { status: 400 });
    if (typeof body.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey)) {
      return json({ error: "Yorum gönderim anahtarı geçersiz." }, { status: 400 });
    }

    const text = body.body.trim();
    if (text.length < CONTENT_LIMITS.commentBody.min) return json({ error: "Yorum boş olamaz." }, { status: 400 });
    if (text.length > CONTENT_LIMITS.commentBody.max) return json({ error: `Yorum ${CONTENT_LIMITS.commentBody.max} karakteri geçemez.` }, { status: 400 });

    const result = await addComment(user.id, (await params).id, text, body.idempotencyKey);
    return result
      ? json({ comment: result.comment, total: result.total }, { status: 201 })
      : json({ error: "Gönderi bulunamadı." }, { status: 404 });
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, { status: error.status });
    if (error instanceof IdempotencyPayloadConflictError) return json({ error: error.message }, { status: 409 });
    throw error;
  }
}
