import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { notificationHref } from "@/lib/notification-presentation";
import { normalizePostResourceId } from "@/lib/post-resource";

type PostInteractionType = "post_like" | "post_comment";

const POST_INTERACTION_COPY: Record<PostInteractionType, { title: string; body: string }> = {
  post_like: {
    title: "Paylaşımın beğenildi",
    body: "Bir kaşif alan paylaşımını beğendi.",
  },
  post_comment: {
    title: "Paylaşımına yorum yapıldı",
    body: "Bir kaşif alan paylaşımına yorum yaptı.",
  },
};

export function insertPostInteractionNotification(
  database: DatabaseSync,
  input: { recipientId: string; actorId: string; postId: string; type: PostInteractionType },
) {
  if (input.recipientId === input.actorId) return false;
  const postId = normalizePostResourceId(input.postId);
  if (!postId) throw new RangeError("Bildirim gönderi kimliği geçersiz.");
  const copy = POST_INTERACTION_COPY[input.type];
  const result = database.prepare(`
    INSERT INTO notifications
      (id, user_id, actor_id, type, title, body, resource_type, resource_id)
    VALUES (?, ?, ?, ?, ?, ?, 'post', ?)
  `).run(randomUUID(), input.recipientId, input.actorId, input.type, copy.title, copy.body, postId);
  return result.changes === 1;
}

export function listNotificationsFromDatabase(database: DatabaseSync, userId: string) {
  const rows = database.prepare(`
    SELECT notifications.id, notifications.type, notifications.title, notifications.body,
      notifications.resource_type, notifications.resource_id,
      notifications.read_at, notifications.created_at, actor.username AS actor_username
    FROM notifications
    LEFT JOIN users AS actor ON actor.id = notifications.actor_id
    WHERE notifications.user_id = ?
    ORDER BY notifications.created_at DESC, notifications.id DESC
    LIMIT 50
  `).all(userId) as Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    resource_type: string | null;
    resource_id: string | null;
    read_at: string | null;
    created_at: string;
    actor_username: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    read_at: row.read_at,
    created_at: row.created_at,
    href: notificationHref(row.type, row.actor_username, row.resource_type, row.resource_id),
  }));
}
