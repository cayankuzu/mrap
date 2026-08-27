import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";
import { queryUserStats } from "@/lib/user-stats";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT NOT NULL);
    CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE current_territories (user_id TEXT PRIMARY KEY, area_m2 REAL NOT NULL);
    CREATE TABLE territories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, area_km2 REAL NOT NULL, distance_km REAL NOT NULL, duration_seconds INTEGER NOT NULL);
    CREATE TABLE follows (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL, PRIMARY KEY (follower_id, followed_id));
  `);
  ensureLatestSchema(database);
  database.exec(`
    INSERT INTO users (id, email, username) VALUES ('u1', 'one@example.com', 'userone');
    INSERT INTO current_territories (user_id, area_m2) VALUES ('u1', 1500);
    INSERT INTO territories (id, user_id, area_km2, distance_km, duration_seconds)
      VALUES ('claim1', 'u1', 0.002, 0.10, 60);
    INSERT INTO route_sessions (
      id, user_id, idempotency_key, payload_hash, location_mode, distance_m,
      duration_seconds, point_count, started_at, ended_at
    ) VALUES (
      'session1', 'u1', 'route-session-0001', '${"a".repeat(64)}', 'real', 351,
      240, 72, '2026-08-26T15:00:00.000Z', '2026-08-26T15:04:00.000Z'
    );
  `);
});

afterEach(() => database.close());

describe("profil istatistik kaynakları", () => {
  it("toplam mesafeyi claim döngüsünden değil tam rota oturumundan alır", () => {
    const stats = queryUserStats(database, "u1");

    expect(stats.distance).toBe(0.351);
    expect(stats.distance).not.toBe(0.10);
    expect(stats.duration).toBe(240);
    expect(stats.closed_area).toBe(0.002);
    expect(stats.area).toBe(0.0015);
    expect(stats.routes).toBe(1);
  });
});
