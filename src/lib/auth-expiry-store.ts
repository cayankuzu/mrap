import type { DatabaseSync } from "node:sqlite";

/** SQLite CURRENT_TIMESTAMP and JavaScript ISO strings have different separators.
 * Always normalize with datetime() before comparing authentication expiries. */
export function removeUnavailablePasswordResetTokens(database: DatabaseSync, userId: string) {
  return database.prepare(`
    DELETE FROM password_reset_tokens
    WHERE user_id = ?
       OR used_at IS NOT NULL
       OR datetime(expires_at) IS NULL
       OR datetime(expires_at) <= CURRENT_TIMESTAMP
  `).run(userId);
}

export function findActivePasswordResetUserId(database: DatabaseSync, tokenHash: string) {
  return (database.prepare(`
    SELECT user_id
    FROM password_reset_tokens
    WHERE token_hash = ?
      AND used_at IS NULL
      AND datetime(expires_at) > CURRENT_TIMESTAMP
  `).get(tokenHash) as { user_id: string } | undefined)?.user_id ?? null;
}

export function removeExpiredSessions(database: DatabaseSync) {
  return database.prepare(`
    DELETE FROM sessions
    WHERE datetime(expires_at) IS NULL
       OR datetime(expires_at) <= CURRENT_TIMESTAMP
  `).run();
}

export function findActiveSessionUserId(database: DatabaseSync, tokenHash: string) {
  return (database.prepare(`
    SELECT user_id
    FROM sessions
    WHERE token_hash = ?
      AND datetime(expires_at) > CURRENT_TIMESTAMP
  `).get(tokenHash) as { user_id: string } | undefined)?.user_id ?? null;
}
