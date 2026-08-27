import type { DatabaseSync } from "node:sqlite";
import { CONNECTION_PAGE_LIMITS, LEADERBOARD_LIMIT, PLAYER_SEARCH_LIMITS } from "@/lib/content-limits";
import { encodeConnectionCursor } from "@/lib/connection-cursor";
import type { ConnectionCursor, ConnectionPage, LeaderboardEntry, PlayerSearchResult, SocialConnection, UserListPlayer } from "@/lib/models";
import { escapeSqlLike, normalizeUserSearchText } from "@/lib/user-search";

type CompactUserRow = {
  id: string;
  username: string;
  display_name: string;
  color: string;
  pattern: number;
  city: string;
  account_visibility: UserListPlayer["accountVisibility"];
  user_has_avatar: number;
  search_key: string;
};

const COMPACT_USER_SELECT = `
  users.id,
  users.username,
  users.display_name,
  users.color,
  users.pattern,
  users.city,
  users.account_visibility,
  (users.avatar_data IS NOT NULL) AS user_has_avatar,
  users.search_key
`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

function compactPlayer(row: CompactUserRow): UserListPlayer {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    initials: initials(row.display_name),
    color: row.color,
    pattern: row.pattern,
    city: row.city,
    accountVisibility: row.account_visibility,
    avatarData: row.user_has_avatar ? `/api/users/${encodeURIComponent(row.id)}/avatar` : null,
  };
}

function assertLimit(limit: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`${label} 1–${maximum} arasında olmalı.`);
  }
}

export function searchPlayersFromDatabase(
  database: DatabaseSync,
  viewerId: string,
  query = "",
  limit = PLAYER_SEARCH_LIMITS.results,
): PlayerSearchResult[] {
  assertLimit(limit, PLAYER_SEARCH_LIMITS.results, "Arama sonucu limiti");
  const normalizedQuery = normalizeUserSearchText(query).slice(0, PLAYER_SEARCH_LIMITS.queryMax);
  const contains = `%${escapeSqlLike(normalizedQuery)}%`;
  const usernamePrefix = `${escapeSqlLike(normalizedQuery)}%`;
  const filter = normalizedQuery ? "AND users.search_key LIKE ? ESCAPE '\\'" : "";
  const rows = database.prepare(`
    SELECT ${COMPACT_USER_SELECT},
      (SELECT COUNT(*) FROM follows WHERE follows.followed_id = users.id) AS follower_count,
      (SELECT COUNT(*) FROM territories WHERE territories.user_id = users.id) AS route_count,
      COALESCE((SELECT area_m2 FROM current_territories WHERE current_territories.user_id = users.id), 0) / 1000000.0 AS area_total,
      EXISTS(SELECT 1 FROM follows WHERE follows.follower_id = ? AND follows.followed_id = users.id) AS is_following,
      EXISTS(SELECT 1 FROM follow_requests WHERE follow_requests.requester_id = ? AND follow_requests.target_id = users.id) AS is_requested
    FROM users
    WHERE users.id != ? ${filter}
    ORDER BY
      ${normalizedQuery ? "CASE WHEN users.search_key LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END," : ""}
      follower_count DESC,
      users.created_at DESC,
      users.id ASC
    LIMIT ?
  `).all(...(normalizedQuery
    ? [viewerId, viewerId, viewerId, contains, usernamePrefix, limit]
    : [viewerId, viewerId, viewerId, limit])) as Array<CompactUserRow & {
      follower_count: number;
      route_count: number;
      area_total: number;
      is_following: number;
      is_requested: number;
    }>;

  return rows.map((row) => ({
    ...compactPlayer(row),
    followers: row.follower_count,
    routes: row.route_count,
    areaKm2: row.area_total,
    relation: row.is_following ? "following" : row.is_requested ? "requested" : "none",
  }));
}

export function listConnectionPageFromDatabase(
  database: DatabaseSync,
  input: { userId: string; viewerId: string; type: "followers" | "following"; cursor: ConnectionCursor | null; limit?: number },
): ConnectionPage {
  const limit = input.limit ?? CONNECTION_PAGE_LIMITS.default;
  assertLimit(limit, CONNECTION_PAGE_LIMITS.max, "Bağlantı sayfa limiti");
  const join = input.type === "followers"
    ? "JOIN follows ON follows.follower_id = users.id WHERE follows.followed_id = ?"
    : "JOIN follows ON follows.followed_id = users.id WHERE follows.follower_id = ?";
  const cursorFilter = input.cursor
    ? "AND (users.search_key > ? OR (users.search_key = ? AND users.id > ?))"
    : "";
  const statement = database.prepare(`
    SELECT ${COMPACT_USER_SELECT},
      EXISTS(SELECT 1 FROM follows mine WHERE mine.follower_id = ? AND mine.followed_id = users.id) AS is_following,
      EXISTS(SELECT 1 FROM follow_requests mine_requests WHERE mine_requests.requester_id = ? AND mine_requests.target_id = users.id) AS is_requested
    FROM users ${join}
    ${cursorFilter}
    ORDER BY users.search_key ASC, users.id ASC
    LIMIT ?
  `);
  const rows = (input.cursor
    ? statement.all(input.viewerId, input.viewerId, input.userId, input.cursor.searchKey, input.cursor.searchKey, input.cursor.id, limit + 1)
    : statement.all(input.viewerId, input.viewerId, input.userId, limit + 1)) as Array<CompactUserRow & { is_following: number; is_requested: number }>;
  const hasMore = rows.length > limit;
  const visibleRows = rows.slice(0, limit);
  const connections: SocialConnection[] = visibleRows.map((row) => ({
    user: compactPlayer(row),
    relation: row.id === input.viewerId || row.is_following ? "following" : row.is_requested ? "requested" : "none",
  }));
  const last = visibleRows.at(-1);
  const countWhere = input.type === "followers" ? "followed_id" : "follower_id";
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM follows WHERE ${countWhere} = ?`).get(input.userId) as { count: number }).count;
  return {
    connections,
    nextCursor: hasMore && last ? encodeConnectionCursor({ searchKey: last.search_key, id: last.id }) : null,
    total,
  };
}

export function getLeaderboardFromDatabase(database: DatabaseSync, cityId?: string, limit = LEADERBOARD_LIMIT): LeaderboardEntry[] {
  assertLimit(limit, LEADERBOARD_LIMIT, "Sıralama limiti");
  const cityFilter = cityId ? "WHERE users.city_id = ?" : "";
  const rows = database.prepare(`
    SELECT
      users.id,
      users.username,
      users.display_name,
      users.color,
      users.pattern,
      users.city,
      (users.avatar_data IS NOT NULL) AS user_has_avatar,
      COALESCE(current_territories.area_m2 / 1000000.0, 0) AS area,
      (SELECT COUNT(*) FROM territories WHERE territories.user_id = users.id) AS routes
    FROM users
    LEFT JOIN current_territories ON current_territories.user_id = users.id
    ${cityFilter}
    ORDER BY area DESC, routes DESC, users.created_at ASC, users.id ASC
    LIMIT ?
  `).all(...(cityId ? [cityId, limit] : [limit])) as Array<{
    id: string;
    username: string;
    display_name: string;
    color: string;
    pattern: number;
    city: string;
    user_has_avatar: number;
    area: number;
    routes: number;
  }>;

  return rows.map((row, index) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    initials: initials(row.display_name),
    color: row.color,
    pattern: row.pattern,
    city: row.city,
    avatarData: row.user_has_avatar ? `/api/users/${encodeURIComponent(row.id)}/avatar` : null,
    areaKm2: row.area,
    routes: row.routes,
    rank: index + 1,
  }));
}
