import type { DatabaseSync } from "node:sqlite";

export function updateNotificationActorUsername(
  database: DatabaseSync,
  userId: string,
  previousUsername: string,
  nextUsername: string,
) {
  const previousPrefix = `@${previousUsername} `;
  const nextPrefix = `@${nextUsername} `;
  return database.prepare(`
    UPDATE notifications
    SET body = ? || substr(body, length(?) + 1)
    WHERE (actor_id = ? OR actor_id IS NULL)
      AND substr(body, 1, length(?)) = ?
  `).run(nextPrefix, previousPrefix, userId, previousPrefix, previousPrefix);
}
