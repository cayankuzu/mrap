import { CONTENT_LIMITS } from "@/lib/content-limits";

const DEFAULT_MAX_BODY_BYTES = 512;
const ACCOUNT_DELETION_KEYS = new Set(["acknowledged", "confirmation", "password"]);

export type AccountDeletionPayload = {
  confirmation: string;
  acknowledged: boolean;
  password: string;
};

export type AccountDeletionBodyResult =
  | { ok: true; payload: AccountDeletionPayload }
  | { ok: false; reason: "unsupported_media_type" | "too_large" | "invalid_json" };

function configuredMaximumBodyBytes() {
  const parsed = Number.parseInt(process.env.MRAP_ACCOUNT_DELETE_MAX_BODY_BYTES ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 128 && parsed <= 4_096 ? parsed : DEFAULT_MAX_BODY_BYTES;
}

export async function readAccountDeletionBody(request: Request): Promise<AccountDeletionBodyResult> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, reason: "unsupported_media_type" };
  }

  const maximumBytes = configuredMaximumBodyBytes();
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return { ok: false, reason: "too_large" };

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid_json" };
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid_json" };
    const payload = parsed as Record<string, unknown>;
    const keys = Object.keys(payload);
    if (
      keys.length !== ACCOUNT_DELETION_KEYS.size
      || keys.some((key) => !ACCOUNT_DELETION_KEYS.has(key))
      || typeof payload.confirmation !== "string"
      || typeof payload.acknowledged !== "boolean"
      || typeof payload.password !== "string"
      || payload.confirmation.length > CONTENT_LIMITS.username.max
      || payload.password.length < 1
      || payload.password.length > CONTENT_LIMITS.password.max
    ) return { ok: false, reason: "invalid_json" };
    return { ok: true, payload: payload as AccountDeletionPayload };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function isAccountDeletionConfirmed(payload: AccountDeletionPayload, username: string) {
  return payload.acknowledged === true
    && payload.confirmation === username
    && payload.password.length > 0;
}
