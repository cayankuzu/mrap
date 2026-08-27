import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordRouteSessionInDatabase, RouteSessionIdempotencyConflictError } from "@/lib/route-session-store";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT NOT NULL);
    CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
  `);
  ensureLatestSchema(database);
  database.prepare("INSERT INTO users (id, email, username) VALUES (?, ?, ?)").run("u1", "one@example.com", "userone");
});

afterEach(() => database.close());

describe("idempotent rota oturumu kaydı", () => {
  const input = {
    idempotencyKey: "route-session-0001",
    payloadHash: "a".repeat(64),
    locationMode: "real" as const,
    distanceM: 351,
    durationSeconds: 240,
    pointCount: 72,
    startedAt: "2026-08-26T15:00:00.000Z",
    endedAt: "2026-08-26T15:04:00.000Z",
  };

  it("aynı payload tekrarlandığında ikinci mesafe yazmadan ilk kaydı döndürür", () => {
    const first = recordRouteSessionInDatabase(database, "u1", input);
    const replay = recordRouteSessionInDatabase(database, "u1", input);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.session.id).toBe(first.session.id);
    expect(database.prepare("SELECT COUNT(*) AS count, SUM(distance_m) AS distance FROM route_sessions").get())
      .toEqual({ count: 1, distance: 351 });
  });

  it("aynı işlem anahtarının farklı payload ile kullanılmasını reddeder", () => {
    recordRouteSessionInDatabase(database, "u1", input);
    expect(() => recordRouteSessionInDatabase(database, "u1", { ...input, payloadHash: "b".repeat(64), distanceM: 500 }))
      .toThrow(RouteSessionIdempotencyConflictError);
  });
});
