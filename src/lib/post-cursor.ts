import type { PostCursor } from "@/lib/models";

const CURSOR_VERSION = 1;
const MAX_ENCODED_CURSOR_LENGTH = 512;
const MAX_POST_ID_LENGTH = 128;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;
const POST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type SerializedPostCursor = {
  v: typeof CURSOR_VERSION;
  t: string;
  i: string;
};

function isCursorValue(value: unknown): value is SerializedPostCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SerializedPostCursor>;
  const timestamp = typeof candidate.t === "string" ? candidate.t : "";
  const parseableTimestamp = timestamp.includes("T") || /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
  return candidate.v === CURSOR_VERSION
    && TIMESTAMP_PATTERN.test(timestamp)
    && !Number.isNaN(Date.parse(parseableTimestamp))
    && typeof candidate.i === "string"
    && candidate.i.length >= 1
    && candidate.i.length <= MAX_POST_ID_LENGTH
    && POST_ID_PATTERN.test(candidate.i);
}

export function encodePostCursor(cursor: PostCursor) {
  const serialized: SerializedPostCursor = { v: CURSOR_VERSION, t: cursor.createdAt, i: cursor.id };
  if (!isCursorValue(serialized)) throw new RangeError("Gönderi imleci geçersiz.");
  return Buffer.from(JSON.stringify(serialized), "utf8").toString("base64url");
}

export function decodePostCursor(value: string): PostCursor | null {
  if (!value || value.length > MAX_ENCODED_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isCursorValue(parsed)) return null;
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}
