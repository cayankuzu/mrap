import type { DatabaseSync } from "node:sqlite";
import { POST_PAGE_LIMITS } from "@/lib/content-limits";
import type { PostCursor, PostPage, RealPost } from "@/lib/models";
import { normalizeMapCamera } from "@/lib/map-preview";
import { encodePostCursor } from "@/lib/post-cursor";

export type PostFeedMode = "following" | "explore" | "mine" | "saved" | "user";

type FeedPostRow = {
  post_id: string;
  post_user_id: string;
  post_title: string;
  post_body: string;
  post_map_view: string | null;
  post_created_at: string;
  post_image_count: number;
  user_username: string;
  user_display_name: string;
  user_color: string;
  user_pattern: number;
  user_has_avatar: number;
  territory_id: string;
  territory_user_id: string;
  territory_name: string;
  territory_district: string;
  territory_geojson: string;
  territory_color: string;
  territory_pattern: number;
  territory_area_km2: number;
  territory_newly_added_area_km2: number;
  territory_overlap_area_km2: number;
  territory_total_area_after_km2: number;
  territory_distance_km: number;
  territory_duration_seconds: number;
  territory_active: number;
  territory_created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: number;
  saved_by_me: number;
  followed_by_me: number;
  requested_by_me: number;
};

const FEED_POST_SELECT = `
  SELECT
    posts.id AS post_id,
    posts.user_id AS post_user_id,
    posts.title AS post_title,
    posts.body AS post_body,
    posts.map_view_json AS post_map_view,
    posts.created_at AS post_created_at,
    CASE
      WHEN EXISTS(SELECT 1 FROM post_images WHERE post_images.post_id = posts.id)
        THEN (SELECT COUNT(*) FROM post_images WHERE post_images.post_id = posts.id)
      WHEN posts.image_data IS NOT NULL THEN 1
      ELSE 0
    END AS post_image_count,
    users.username AS user_username,
    users.display_name AS user_display_name,
    users.color AS user_color,
    users.pattern AS user_pattern,
    (users.avatar_data IS NOT NULL) AS user_has_avatar,
    territories.id AS territory_id,
    territories.user_id AS territory_user_id,
    territories.name AS territory_name,
    territories.district AS territory_district,
    territories.geojson AS territory_geojson,
    territories.color AS territory_color,
    territories.pattern AS territory_pattern,
    territories.area_km2 AS territory_area_km2,
    territories.newly_added_area_km2 AS territory_newly_added_area_km2,
    territories.overlap_area_km2 AS territory_overlap_area_km2,
    territories.total_area_after_km2 AS territory_total_area_after_km2,
    territories.distance_km AS territory_distance_km,
    territories.duration_seconds AS territory_duration_seconds,
    territories.active AS territory_active,
    territories.created_at AS territory_created_at,
    (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS comment_count,
    EXISTS(SELECT 1 FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked_by_me,
    EXISTS(SELECT 1 FROM saved_posts WHERE saved_posts.post_id = posts.id AND saved_posts.user_id = ?) AS saved_by_me,
    EXISTS(SELECT 1 FROM follows WHERE follows.followed_id = posts.user_id AND follows.follower_id = ?) AS followed_by_me,
    EXISTS(SELECT 1 FROM follow_requests WHERE follow_requests.target_id = posts.user_id AND follow_requests.requester_id = ?) AS requested_by_me
  FROM posts
  JOIN users ON users.id = posts.user_id
  JOIN territories ON territories.id = posts.territory_id
`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

function parseStoredMapView(value: string | null) {
  if (!value) return null;
  try { return normalizeMapCamera(JSON.parse(value)); }
  catch { return null; }
}

function rowToPost(row: FeedPostRow): RealPost {
  return {
    id: row.post_id,
    userId: row.post_user_id,
    user: {
      id: row.post_user_id,
      username: row.user_username,
      displayName: row.user_display_name,
      initials: initials(row.user_display_name),
      color: row.user_color,
      pattern: row.user_pattern,
      avatarData: row.user_has_avatar ? `/api/users/${encodeURIComponent(row.post_user_id)}/avatar` : null,
    },
    territory: {
      id: row.territory_id,
      userId: row.territory_user_id,
      ownerUsername: row.user_username,
      name: row.territory_name,
      district: row.territory_district,
      geojson: JSON.parse(row.territory_geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      color: row.territory_color,
      pattern: row.territory_pattern,
      areaKm2: row.territory_area_km2,
      newlyAddedAreaKm2: row.territory_newly_added_area_km2,
      overlapAreaKm2: row.territory_overlap_area_km2,
      totalAreaAfterKm2: row.territory_total_area_after_km2,
      distanceKm: row.territory_distance_km,
      durationSeconds: row.territory_duration_seconds,
      active: Boolean(row.territory_active),
      createdAt: row.territory_created_at,
    },
    title: row.post_title,
    body: row.post_body,
    images: Array.from(
      { length: Math.min(row.post_image_count, 6) },
      (_, index) => `/api/posts/${encodeURIComponent(row.post_id)}/images/${index}`,
    ),
    mapView: parseStoredMapView(row.post_map_view),
    likes: row.like_count,
    comments: row.comment_count,
    likedByMe: Boolean(row.liked_by_me),
    savedByMe: Boolean(row.saved_by_me),
    followedByMe: Boolean(row.followed_by_me),
    requestedByMe: Boolean(row.requested_by_me),
    createdAt: row.post_created_at,
  };
}

function assertPageLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > POST_PAGE_LIMITS.max) {
    throw new RangeError(`Gönderi sayfa limiti 1–${POST_PAGE_LIMITS.max} arasında olmalı.`);
  }
}

function modeFilter(mode: PostFeedMode, viewerId: string, ownerId?: string) {
  if (mode === "following") {
    return {
      sql: "WHERE (posts.user_id = ? OR posts.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?))",
      args: [viewerId, viewerId],
    };
  }
  if (mode === "explore") {
    return {
      sql: "WHERE users.account_visibility = 'public' AND posts.user_id != ? AND posts.user_id NOT IN (SELECT followed_id FROM follows WHERE follower_id = ?)",
      args: [viewerId, viewerId],
    };
  }
  if (mode === "mine") return { sql: "WHERE posts.user_id = ?", args: [viewerId] };
  if (mode === "saved") {
    return {
      sql: `WHERE posts.id IN (SELECT post_id FROM saved_posts WHERE user_id = ?)
        AND (posts.user_id = ? OR users.account_visibility = 'public'
          OR posts.user_id IN (SELECT followed_id FROM follows WHERE follower_id = ?))`,
      args: [viewerId, viewerId, viewerId],
    };
  }
  if (!ownerId) throw new RangeError("Kullanıcı akışı için sahip kimliği zorunlu.");
  return {
    sql: `WHERE posts.user_id = ?
      AND (posts.user_id = ? OR users.account_visibility = 'public'
        OR EXISTS(SELECT 1 FROM follows WHERE follows.follower_id = ? AND follows.followed_id = posts.user_id))`,
    args: [ownerId, viewerId, viewerId],
  };
}

export function listPostPageFromDatabase(
  database: DatabaseSync,
  input: { viewerId: string; mode: PostFeedMode; ownerId?: string; cursor: PostCursor | null; limit: number },
): PostPage {
  assertPageLimit(input.limit);
  const filter = modeFilter(input.mode, input.viewerId, input.ownerId);
  const cursorFilter = input.cursor
    ? "AND (posts.created_at < ? OR (posts.created_at = ? AND posts.id < ?))"
    : "";
  const statement = database.prepare(`
    ${FEED_POST_SELECT}
    ${filter.sql}
    ${cursorFilter}
    ORDER BY posts.created_at DESC, posts.id DESC
    LIMIT ?
  `);
  const commonArgs = [input.viewerId, input.viewerId, input.viewerId, input.viewerId, ...filter.args];
  const rows = (input.cursor
    ? statement.all(...commonArgs, input.cursor.createdAt, input.cursor.createdAt, input.cursor.id, input.limit + 1)
    : statement.all(...commonArgs, input.limit + 1)) as FeedPostRow[];
  const hasMore = rows.length > input.limit;
  const posts = rows.slice(0, input.limit).map(rowToPost);
  const last = posts.at(-1);
  const total = (database.prepare(`
    SELECT COUNT(*) AS count
    FROM posts
    JOIN users ON users.id = posts.user_id
    ${filter.sql}
  `).get(...filter.args) as { count: number }).count;
  return {
    posts,
    nextCursor: hasMore && last ? encodePostCursor({ createdAt: last.createdAt, id: last.id }) : null,
    total,
  };
}

export function getPostFromDatabase(database: DatabaseSync, viewerId: string, postId: string) {
  const row = database.prepare(`${FEED_POST_SELECT} WHERE posts.id = ? LIMIT 1`)
    .get(viewerId, viewerId, viewerId, viewerId, postId) as FeedPostRow | undefined;
  return row ? rowToPost(row) : null;
}

export function getPostImageDataFromDatabase(database: DatabaseSync, postId: string, index: number) {
  const stored = database.prepare(`
    SELECT image_data FROM post_images
    WHERE post_id = ? AND sort_order = ?
  `).get(postId, index) as { image_data: string } | undefined;
  if (stored) return stored.image_data;
  if (index !== 0) return null;
  const legacy = database.prepare(`
    SELECT image_data FROM posts
    WHERE id = ? AND NOT EXISTS(SELECT 1 FROM post_images WHERE post_images.post_id = posts.id)
  `).get(postId) as { image_data: string | null } | undefined;
  return legacy?.image_data ?? null;
}
