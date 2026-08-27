import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { encodeCommentCursor } from "@/lib/comment-cursor";
import { COMMENT_PAGE_LIMITS, CONTENT_LIMITS } from "@/lib/content-limits";
import type { AddPostCommentResult, PostComment, PostCommentCursor, PostCommentPage } from "@/lib/models";
import { createMutationPayloadHash, findCommentIdempotencyReplay, IDEMPOTENCY_KEY_PATTERN } from "@/lib/mutation-idempotency-store";

type CommentRow = {
  comment_id: string;
  comment_post_id: string;
  comment_body: string;
  comment_created_at: string;
  user_id: string;
  username: string;
  display_name: string;
  color: string;
  user_has_avatar: number;
};

const COMMENT_SELECT = `
  SELECT
    comments.id AS comment_id,
    comments.post_id AS comment_post_id,
    comments.body AS comment_body,
    comments.created_at AS comment_created_at,
    users.id AS user_id,
    users.username,
    users.display_name,
    users.color,
    (users.avatar_data IS NOT NULL) AS user_has_avatar
  FROM comments
  JOIN users ON users.id = comments.user_id
`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

function rowToComment(row: CommentRow): PostComment {
  return {
    id: row.comment_id,
    postId: row.comment_post_id,
    body: row.comment_body,
    createdAt: row.comment_created_at,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      initials: initials(row.display_name),
      color: row.color,
      avatarData: row.user_has_avatar ? `/api/users/${encodeURIComponent(row.user_id)}/avatar` : null,
    },
  };
}

function assertPageLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > COMMENT_PAGE_LIMITS.max) {
    throw new RangeError(`Yorum sayfa limiti 1–${COMMENT_PAGE_LIMITS.max} arasında olmalı.`);
  }
}

export function listPostCommentsFromDatabase(
  database: DatabaseSync,
  postId: string,
  options: { cursor: PostCommentCursor | null; limit: number },
): PostCommentPage {
  assertPageLimit(options.limit);
  const cursorFilter = options.cursor
    ? "AND (comments.created_at < ? OR (comments.created_at = ? AND comments.id < ?))"
    : "";
  const statement = database.prepare(`
    ${COMMENT_SELECT}
    WHERE comments.post_id = ?
    ${cursorFilter}
    ORDER BY comments.created_at DESC, comments.id DESC
    LIMIT ?
  `);
  const rows = (options.cursor
    ? statement.all(postId, options.cursor.createdAt, options.cursor.createdAt, options.cursor.id, options.limit + 1)
    : statement.all(postId, options.limit + 1)) as CommentRow[];
  const hasMore = rows.length > options.limit;
  const comments = rows.slice(0, options.limit).map(rowToComment);
  const last = comments.at(-1);
  const total = (database.prepare("SELECT COUNT(*) AS count FROM comments WHERE post_id = ?").get(postId) as { count: number }).count;
  return {
    comments,
    nextCursor: hasMore && last ? encodeCommentCursor({ createdAt: last.createdAt, id: last.id }) : null,
    total,
  };
}

export function addPostCommentToDatabase(
  database: DatabaseSync,
  userId: string,
  postId: string,
  body: string,
  idempotencyKey?: string,
  onCreated?: (comment: PostComment) => void,
): AddPostCommentResult {
  const text = body.trim();
  if (text.length < CONTENT_LIMITS.commentBody.min || text.length > CONTENT_LIMITS.commentBody.max) {
    throw new RangeError(`Yorum ${CONTENT_LIMITS.commentBody.min}–${CONTENT_LIMITS.commentBody.max} karakter olmalı.`);
  }
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new RangeError("Yorum gönderim anahtarı geçersiz.");
  }
  const payloadHash = idempotencyKey ? createMutationPayloadHash({ body: text }) : null;

  const id = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (idempotencyKey && payloadHash) {
      const replayId = findCommentIdempotencyReplay(database, userId, postId, idempotencyKey, payloadHash);
      if (replayId) {
        const replayRow = database.prepare(`${COMMENT_SELECT} WHERE comments.id = ?`).get(replayId) as CommentRow | undefined;
        if (!replayRow) throw new Error("Tekrarlanan yorum okunamadı.");
        const replayTotal = (database.prepare("SELECT COUNT(*) AS count FROM comments WHERE post_id = ?").get(postId) as { count: number }).count;
        database.exec("COMMIT");
        return { comment: rowToComment(replayRow), total: replayTotal, replayed: true };
      }
    }
    database.prepare("INSERT INTO comments (id, user_id, post_id, body, idempotency_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, userId, postId, text, idempotencyKey ?? null, payloadHash);
    const row = database.prepare(`${COMMENT_SELECT} WHERE comments.id = ?`).get(id) as CommentRow | undefined;
    if (!row) throw new Error("Eklenen yorum okunamadı.");
    const comment = rowToComment(row);
    onCreated?.(comment);
    const total = (database.prepare("SELECT COUNT(*) AS count FROM comments WHERE post_id = ?").get(postId) as { count: number }).count;
    database.exec("COMMIT");
    return { comment, total, replayed: false };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
