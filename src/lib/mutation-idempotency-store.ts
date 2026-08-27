import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;

export class IdempotencyPayloadConflictError extends Error {
  constructor() {
    super("Aynı işlem anahtarı farklı içerikle yeniden kullanılamaz.");
    this.name = "IdempotencyPayloadConflictError";
  }
}

export function createMutationPayloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function resolveReplay(row: { id: string; payload_hash: string | null } | undefined, payloadHash: string) {
  if (!row) return null;
  if (row.payload_hash !== payloadHash) throw new IdempotencyPayloadConflictError();
  return row.id;
}

export function findPostIdempotencyReplay(
  database: DatabaseSync,
  userId: string,
  idempotencyKey: string,
  payloadHash: string,
) {
  const row = database.prepare(`
    SELECT id, payload_hash
    FROM posts
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey) as { id: string; payload_hash: string | null } | undefined;
  return resolveReplay(row, payloadHash);
}

export function findCommentIdempotencyReplay(
  database: DatabaseSync,
  userId: string,
  postId: string,
  idempotencyKey: string,
  payloadHash: string,
) {
  const row = database.prepare(`
    SELECT id, payload_hash
    FROM comments
    WHERE user_id = ? AND post_id = ? AND idempotency_key = ?
  `).get(userId, postId, idempotencyKey) as { id: string; payload_hash: string | null } | undefined;
  return resolveReplay(row, payloadHash);
}
