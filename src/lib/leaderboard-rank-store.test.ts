import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryLeaderboardRank } from "@/lib/leaderboard-rank-store";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      city_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE current_territories (
      user_id TEXT PRIMARY KEY,
      area_m2 REAL NOT NULL
    );
    CREATE TABLE territories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    );
  `);
});

afterEach(() => database.close());

describe("liderlik sırası", () => {
  it("ilk 100 dışında kalan oyuncunun gerçek sırasını döndürür", () => {
    const insertUser = database.prepare("INSERT INTO users (id, city_id, created_at) VALUES (?, 'tr-istanbul', ?)");
    const insertArea = database.prepare("INSERT INTO current_territories (user_id, area_m2) VALUES (?, ?)");
    for (let index = 0; index < 105; index += 1) {
      const id = `u-${String(index).padStart(3, "0")}`;
      insertUser.run(id, `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`);
      insertArea.run(id, 105 - index);
    }

    expect(queryLeaderboardRank(database, "u-104")).toBe(105);
  });

  it("şehir filtresini ve deterministik eşitlik sırasını uygular", () => {
    database.exec(`
      INSERT INTO users (id, city_id, created_at) VALUES
        ('a', 'tr-istanbul', '2026-01-01T00:00:00.000Z'),
        ('b', 'tr-istanbul', '2026-01-01T00:00:00.000Z'),
        ('c', 'tr-ankara', '2025-01-01T00:00:00.000Z');
      INSERT INTO current_territories (user_id, area_m2) VALUES
        ('a', 10), ('b', 10), ('c', 100);
    `);

    expect(queryLeaderboardRank(database, "b", "tr-istanbul")).toBe(2);
    expect(queryLeaderboardRank(database, "c", "tr-istanbul")).toBeNull();
  });
});
