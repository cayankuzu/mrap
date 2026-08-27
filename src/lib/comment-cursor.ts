import type { PostCommentCursor } from "@/lib/models";

const CURSOR_VERSION = 1;
const MAX_ENCODED_CURSOR_LENGTH = 512;
const MAX_COMMENT_ID_LENGTH = 128;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;
const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type SerializedCommentCursor = {
  v: typeof CURSOR_VERSION;
  t: string;
  i: string;
};

function isCursorValue(value: unknown): value is SerializedCommentCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SerializedCommentCursor>;
  return candidate.v === CURSOR_VERSION
    && typeof candidate.t === "string"
    && TIMESTAMP_PATTERN.test(candidate.t)
    && !Number.isNaN(Date.parse(candidate.t.replace(" ", "T") + (candidate.t.includes("T") || /(?:Z|[+-]\d{2}:\d{2})$/.test(candidate.t) ? "" : "Z")))
    && typeof candidate.i === "string"
    && candidate.i.length >= 1
    && candidate.i.length <= MAX_COMMENT_ID_LENGTH
    && COMMENT_ID_PATTERN.test(candidate.i);
}

export function encodeCommentCursor(cursor: PostCommentCursor) {
  const serialized: SerializedCommentCursor = { v: CURSOR_VERSION, t: cursor.createdAt, i: cursor.id };
  if (!isCursorValue(serialized)) throw new RangeError("Yorum imleci geçersiz.");
  return Buffer.from(JSON.stringify(serialized), "utf8").toString("base64url");
}

export function decodeCommentCursor(value: string): PostCommentCursor | null {
  if (!value || value.length > MAX_ENCODED_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isCursorValue(parsed)) return null;
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}
