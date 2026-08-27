import type { ConnectionCursor } from "@/lib/models";

const CURSOR_VERSION = 1;
const MAX_ENCODED_CURSOR_LENGTH = 512;
const MAX_SEARCH_KEY_LENGTH = 100;
const MAX_USER_ID_LENGTH = 128;
const USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

type SerializedConnectionCursor = {
  v: typeof CURSOR_VERSION;
  k: string;
  i: string;
};

function isCursorValue(value: unknown): value is SerializedConnectionCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SerializedConnectionCursor>;
  return candidate.v === CURSOR_VERSION
    && typeof candidate.k === "string"
    && candidate.k.length <= MAX_SEARCH_KEY_LENGTH
    && typeof candidate.i === "string"
    && candidate.i.length >= 1
    && candidate.i.length <= MAX_USER_ID_LENGTH
    && USER_ID_PATTERN.test(candidate.i);
}

export function encodeConnectionCursor(cursor: ConnectionCursor) {
  const serialized: SerializedConnectionCursor = { v: CURSOR_VERSION, k: cursor.searchKey, i: cursor.id };
  if (!isCursorValue(serialized)) throw new RangeError("Bağlantı imleci geçersiz.");
  return Buffer.from(JSON.stringify(serialized), "utf8").toString("base64url");
}

export function decodeConnectionCursor(value: string): ConnectionCursor | null {
  if (!value || value.length > MAX_ENCODED_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isCursorValue(parsed)) return null;
    return { searchKey: parsed.k, id: parsed.i };
  } catch {
    return null;
  }
}
