import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeConnectionCursor } from "@/lib/connection-cursor";
import { getLeaderboardFromDatabase, getScopedLeaderboardFromDatabase, listConnectionPageFromDatabase, searchPlayersFromDatabase } from "@/lib/social-discovery-store";
import { buildUserSearchKey } from "@/lib/user-search";

let database: DatabaseSync;

function insertUser(id: string, username: string, displayName: string, avatarData: string | null = null, cityId = "tr-istanbul") {
  database.prepare(`
    INSERT INTO users (id, username, display_name, search_key, color, pattern, country_code, city_id, country, city, account_visibility, avatar_data, created_at)
    VALUES (?, ?, ?, ?, '#0D8BFF', 0, 'TR', ?, 'Türkiye', 'İstanbul', 'public', ?, ?)
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
      country_code TEXT NOT NULL,
      city_id TEXT NOT NULL,
      country TEXT NOT NULL,
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
    expect(entries[0]).toMatchObject({ countryCode: "TR", cityId: "tr-istanbul", country: "Türkiye", city: "İstanbul" });
    expect(entries[0].avatarData).toBe("/api/users/player-1/avatar");
    expect(JSON.stringify(entries)).not.toContain("base64");
  });

  it("global ilk 100 dışında kalan oyuncuyu seçili şehrin sıralamasında kaybetmez", () => {
    insertUser("izmir-low", "izmirli", "İzmirli Oyuncu");
    database.prepare("UPDATE users SET city_id = 'tr-izmir', city = 'İzmir' WHERE id = 'izmir-low'").run();

    for (let index = 0; index < 105; index += 1) {
      const id = `world-high-${String(index).padStart(3, "0")}`;
      insertUser(id, `dunya_${index}`, `Dünya ${index}`);
      database.prepare("UPDATE users SET city_id = 'tr-ankara', city = 'Ankara' WHERE id = ?").run(id);
      database.prepare("INSERT INTO current_territories (user_id, area_m2) VALUES (?, ?)").run(id, 20_000_000 - index);
    }

    expect(getLeaderboardFromDatabase(database, undefined, 100).some((entry) => entry.id === "izmir-low")).toBe(false);
    const city = getScopedLeaderboardFromDatabase(database, {
      scope: "city",
      viewerId: "viewer-1",
      cities: [{ countryCode: "TR", city: "İzmir" }],
      limit: 100,
    });
    expect(city.map((entry) => entry.id)).toEqual(["izmir-low"]);
    expect(city[0].rank).toBe(1);
  });

  it("global ilk 100 dışında kalan takip edilen oyuncuyu arkadaşlar kapsamında döndürür", () => {
    insertUser("friend-low", "uzakarkadas", "Uzak Arkadaş");
    database.prepare("INSERT INTO follows (follower_id, followed_id) VALUES ('viewer-1', 'friend-low')").run();

    for (let index = 0; index < 105; index += 1) {
      const id = `leader-${String(index).padStart(3, "0")}`;
      insertUser(id, `lider_${index}`, `Lider ${index}`);
      database.prepare("INSERT INTO current_territories (user_id, area_m2) VALUES (?, ?)").run(id, 30_000_000 - index);
    }

    expect(getLeaderboardFromDatabase(database, undefined, 100).some((entry) => entry.id === "friend-low")).toBe(false);
    const friends = getScopedLeaderboardFromDatabase(database, {
      scope: "friends",
      viewerId: "viewer-1",
      limit: 100,
    });
    expect(new Set(friends.map((entry) => entry.id))).toEqual(new Set(["viewer-1", "player-1", "friend-low"]));
    expect(friends).toHaveLength(3);
  });

  it("birden fazla şehir ve ülkeyi kapsam içinde OR mantığıyla birleştirir", () => {
    database.prepare("UPDATE users SET country_code = 'DE', country = 'Almanya', city_id = 'de-berlin', city = 'Berlin' WHERE id = 'player-2'").run();
    database.prepare("UPDATE users SET country_code = 'FR', country = 'Fransa', city_id = 'fr-paris', city = 'Paris' WHERE id = 'player-3'").run();

    const cities = getScopedLeaderboardFromDatabase(database, {
      scope: "city",
      viewerId: "viewer-1",
      cities: [
        { countryCode: "TR", city: "İstanbul" },
        { countryCode: "DE", city: "Berlin" },
      ],
      limit: 100,
    });
    expect(cities.map((entry) => entry.id)).toEqual(["player-1", "player-2", "viewer-1"]);

    const countries = getScopedLeaderboardFromDatabase(database, {
      scope: "country",
      viewerId: "viewer-1",
      countryCodes: ["TR", "DE"],
      limit: 100,
    });
    expect(countries.map((entry) => entry.id)).toEqual(["player-1", "player-2", "viewer-1"]);
  });

  it("legacy ve canonical id kullanan aynı şehri tek şehir kapsamına alır", () => {
    insertUser("canonical-istanbul", "canonical", "Canonical İstanbul", null, "csc:TR:34:153786");
    database.prepare("INSERT INTO current_territories (user_id, area_m2) VALUES ('canonical-istanbul', 3000000)").run();

    const city = getScopedLeaderboardFromDatabase(database, {
      scope: "city",
      cities: [{ countryCode: "tr", city: "ISTANBUL" }],
      limit: 4,
    });

    expect(city.map((entry) => [entry.id, entry.cityId])).toEqual([
      ["canonical-istanbul", "csc:TR:34:153786"],
      ["player-1", "tr-istanbul"],
      ["player-2", "tr-istanbul"],
      ["viewer-1", "tr-istanbul"],
    ]);
  });
});
