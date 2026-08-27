import type { DatabaseSync } from "node:sqlite";

export type PostLikeActor = {
  id: string;
  username: string;
  displayName: string;
  initials: string;
  color: string;
  avatarData: string | null;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

export function listPostLikeActorsFromDatabase(database: DatabaseSync, postId: string, limit = 100): PostLikeActor[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Beğeni listesi limiti geçersiz.");
  const rows = database.prepare(`
    SELECT users.id, users.username, users.display_name, users.color,
      (users.avatar_data IS NOT NULL) AS has_avatar
    FROM likes JOIN users ON users.id = likes.user_id
    WHERE likes.post_id = ?
    ORDER BY likes.created_at DESC
    LIMIT ?
  `).all(postId, limit) as Array<{ id: string; username: string; display_name: string; color: string; has_avatar: number }>;
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    initials: initials(row.display_name),
    color: row.color,
    avatarData: row.has_avatar ? `/api/users/${encodeURIComponent(row.id)}/avatar` : null,
  }));
}
