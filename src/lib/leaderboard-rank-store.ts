import type { DatabaseSync } from "node:sqlite";

/**
 * Returns the authoritative one-based leaderboard position without relying on
 * the UI's bounded top-100 list. The final id tie-breaker keeps the result
 * deterministic when area, claim count and creation time are equal.
 */
export function queryLeaderboardRank(database: DatabaseSync, userId: string, cityId?: string): number | null {
  const cityFilter = cityId ? "WHERE users.city_id = ?" : "";
  const row = database.prepare(`
    WITH candidates AS (
      SELECT
        users.id,
        COALESCE(current_territories.area_m2, 0) AS area_m2,
        (SELECT COUNT(*) FROM territories WHERE territories.user_id = users.id) AS routes,
        users.created_at
      FROM users
      LEFT JOIN current_territories ON current_territories.user_id = users.id
      ${cityFilter}
    ), ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          ORDER BY area_m2 DESC, routes DESC, created_at ASC, id ASC
        ) AS position
      FROM candidates
    )
    SELECT position FROM ranked WHERE id = ?
  `).get(...(cityId ? [cityId, userId] : [userId])) as { position: number } | undefined;

  return row ? Number(row.position) : null;
}
