import type { DatabaseSync } from "node:sqlite";

export type UserStats = {
  area: number;
  closed_area: number;
  distance: number;
  routes: number;
  duration: number;
  followers: number;
  following: number;
};

export function queryUserStats(database: DatabaseSync, userId: string): UserStats {
  const territory = database.prepare(`
    SELECT
      COALESCE((SELECT area_m2 / 1000000.0 FROM current_territories WHERE user_id = ?), 0) AS area,
      COALESCE(SUM(area_km2), 0) AS closed_area,
      COUNT(*) AS routes
    FROM territories WHERE user_id = ?
  `).get(userId, userId) as Pick<UserStats, "area" | "closed_area" | "routes">;
  const activity = database.prepare(`
    SELECT
      COALESCE(SUM(distance_m), 0) / 1000.0 AS distance,
      COALESCE(SUM(duration_seconds), 0) AS duration
    FROM route_sessions WHERE user_id = ?
  `).get(userId) as Pick<UserStats, "distance" | "duration">;
  const social = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id = ?) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following
  `).get(userId, userId) as Pick<UserStats, "followers" | "following">;
  return { ...territory, ...activity, ...social };
}
