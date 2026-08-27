import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeConnectionCursor } from "@/lib/connection-cursor";
import { getLeaderboardFromDatabase, listConnectionPageFromDatabase, searchPlayersFromDatabase } from "@/lib/social-discovery-store";
import { buildUserSearchKey } from "@/lib/user-search";

let database: DatabaseSync;

function insertUser(id: string, username: string, displayName: string, avatarData: string | null = null, cityId = "tr-istanbul") {
  database.prepare(`
    INSERT INTO users (id, username, display_name, search_key, color, pattern, city_id, city, account_visibility, avatar_data, created_at)
    VALUES (?, ?, ?, ?, '#0D8BFF', 0, ?, 'İstanbul', 'public', ?, ?)
  `).run(id, username, displayName, buildUserSearchKey(username, displayName), cityId, avatarData, `2026-01-${String(Number(id.replace(/\D/g, "")) % 27 + 1).padStart(2, "0")} 10:00:00`);
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      search_key TEXT NOT NULL,
      color TEXT NOT NULL,
      pattern INTEGER NOT NULL,
      city_id TEXT NOT NULL,
      city TEXT NOT NULL,
      account_visibility TEXT NOT NULL,
      avatar_data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE follows (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL, PRIMARY KEY (follower_id, followed_id));
    CREATE TABLE follow_requests (requester_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY (requester_id, target_id));
    CREATE TABLE territories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE current_territories (user_id TEXT PRIMARY KEY, area_m2 REAL NOT NULL);
  `);
  insertUser("viewer-1", "izleyici", "İzleyici");
  insertUser("player-1", "cayan", "Çayan Akın", `data:image/jpeg;base64,${"A".repeat(20_000)}`);
  insertUser("player-2", "ipek", "İpek Işık");
  insertUser("player-3", "yuzde", "Yüzde % Oyuncu");
  database.exec(`
    INSERT INTO follows (follower_id, followed_id) VALUES ('viewer-1', 'player-1');
    INSERT INTO current_territories (user_id, area_m2) VALUES ('player-1', 2500000), ('player-2', 1000000);
    INSERT INTO territories (id, user_id) VALUES ('t1', 'player-1'), ('t2', 'player-1'), ('t3', 'player-2');
  `);
});

afterEach(() => database.close());

describe("kompakt kullanıcı araması", () => {
  it.each(["cayan", "ÇAYAN", "çayan"])("%s sorgusuyla Çayan sonucunu bulur", (query) => {
    const result = searchPlayersFromDatabase(database, "viewer-1", query);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ username: "cayan", relation: "following", followers: 1, routes: 2 });
    expect(result[0].avatarData).toBe("/api/users/player-1/avatar");
    expect(JSON.stringify(result[0])).not.toContain("base64");
    expect(result[0]).not.toHaveProperty("bio");
    expect(result[0]).not.toHaveProperty("coverData");
  });

  it("dotted/dotless I ve Türkçe harfleri katlayarak arar", () => {
    expect(searchPlayersFromDatabase(database, "viewer-1", "ISIK").map((player) => player.username)).toEqual(["ipek"]);
  });

  it("LIKE jokerini joker olarak değil literal kullanıcı girdisi olarak ele alır", () => {
    expect(searchPlayersFromDatabase(database, "viewer-1", "%").map((player) => player.username)).toEqual(["yuzde"]);
  });
});

describe("cursor'lı kompakt bağlantı listesi", () => {
  beforeEach(() => {
    insertUser("owner-1", "sahip", "Sahip");
    for (let index = 0; index < 25; index += 1) {
      const id = `follower-${String(index).padStart(2, "0")}`;
      insertUser(id, `oyuncu_${String(index).padStart(2, "0")}`, `Kişi ${String(index).padStart(2, "0")}`, index === 0 ? "data:image/jpeg;base64,AAAA" : null);
      database.prepare("INSERT INTO follows (follower_id, followed_id) VALUES (?, 'owner-1')").run(id);
    }
  });

  it("listeyi sabit sırayla sayfalar, toplamı korur ve blob döndürmez", () => {
    const first = listConnectionPageFromDatabase(database, { userId: "owner-1", viewerId: "viewer-1", type: "followers", cursor: null, limit: 10 });
    expect(first.connections).toHaveLength(10);
    expect(first.total).toBe(25);
    expect(first.nextCursor).toBeTruthy();
    expect(first.connections[0].user.avatarData).toBe("/api/users/follower-00/avatar");
    expect(JSON.stringify(first)).not.toContain("base64");

    const cursor = decodeConnectionCursor(first.nextCursor!);
    const second = listConnectionPageFromDatabase(database, { userId: "owner-1", viewerId: "viewer-1", type: "followers", cursor, limit: 10 });
    expect(second.connections).toHaveLength(10);
    expect(new Set([...first.connections, ...second.connections].map(({ user }) => user.id)).size).toBe(20);
  });
});

describe("kompakt sıralama", () => {
  it("deterministik sıra numarası ve avatar URL'si üretir", () => {
    const entries = getLeaderboardFromDatabase(database, undefined, 4);
    expect(entries.slice(0, 2).map((entry) => [entry.username, entry.rank])).toEqual([["cayan", 1], ["ipek", 2]]);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(entries[0].avatarData).toBe("/api/users/player-1/avatar");
    expect(JSON.stringify(entries)).not.toContain("base64");
  });
});
