import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePostCursor } from "@/lib/post-cursor";
import { getPostImageDataFromDatabase, listPostPageFromDatabase } from "@/lib/post-feed-store";

let database: DatabaseSync;

const geometry = JSON.stringify({
  type: "Polygon",
  coordinates: [[[29, 41], [29.001, 41], [29.001, 41.001], [29, 41.001], [29, 41]]],
});

function insertUser(id: string, visibility: "public" | "private" = "public") {
  database.prepare(`
    INSERT INTO users (id, username, display_name, color, pattern, account_visibility, avatar_data, cover_data)
    VALUES (?, ?, ?, '#0D8BFF', 0, ?, ?, ?)
  `).run(id, id, `Oyuncu ${id}`, visibility, `data:image/jpeg;base64,avatar-${id}`, `data:image/jpeg;base64,cover-${id}`);
  database.prepare(`
    INSERT INTO territories (
      id, user_id, name, district, geojson, color, pattern, area_km2, newly_added_area_km2,
      overlap_area_km2, total_area_after_km2, distance_km, duration_seconds, map_snapshot, active, created_at
    ) VALUES (?, ?, 'Sahil rotası', 'Kadıköy, İstanbul', ?, '#0D8BFF', 0, .1, .08, .02, .2, 2.4, 900, ?, 1, '2026-08-01 09:00:00')
  `).run(`territory-${id}`, id, geometry, `data:image/jpeg;base64,snapshot-${id}`);
}

function insertPost(id: string, userId: string, createdAt: string, legacyImage: string | null = null) {
  database.prepare(`
    INSERT INTO posts (id, user_id, territory_id, title, body, image_data, map_snapshot, map_view_json, created_at)
    VALUES (?, ?, ?, ?, 'Rota hikâyesi', ?, ?, ?, ?)
  `).run(
    id,
    userId,
    `territory-${userId}`,
    `Gönderi ${id}`,
    legacyImage,
    `data:image/jpeg;base64,post-snapshot-${id}`,
    JSON.stringify({ center: [29, 41], zoom: 14, bearing: 0, pitch: 0 }),
    createdAt,
  );
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL, color TEXT NOT NULL,
      pattern INTEGER NOT NULL, account_visibility TEXT NOT NULL, avatar_data TEXT, cover_data TEXT
    );
    CREATE TABLE territories (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, district TEXT NOT NULL,
      geojson TEXT NOT NULL, color TEXT NOT NULL, pattern INTEGER NOT NULL, area_km2 REAL NOT NULL,
      newly_added_area_km2 REAL NOT NULL, overlap_area_km2 REAL NOT NULL, total_area_after_km2 REAL NOT NULL,
      distance_km REAL NOT NULL, duration_seconds INTEGER NOT NULL, map_snapshot TEXT, active INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, territory_id TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, image_data TEXT, map_snapshot TEXT, map_view_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE post_images (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, image_data TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE likes (user_id TEXT NOT NULL, post_id TEXT NOT NULL);
    CREATE TABLE comments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id TEXT NOT NULL);
    CREATE TABLE saved_posts (user_id TEXT NOT NULL, post_id TEXT NOT NULL);
    CREATE TABLE follows (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL);
    CREATE TABLE follow_requests (requester_id TEXT NOT NULL, target_id TEXT NOT NULL);
    CREATE INDEX idx_posts_page ON posts(created_at DESC, id DESC);
  `);
  insertUser("viewer");
  insertUser("public-player");
  insertUser("private-player", "private");
});

afterEach(() => database.close());

describe("gönderi feed SQLite store", () => {
  it("aynı zaman damgasında id eşitlik bozucusuyla eksiksiz keyset sayfalar", () => {
    for (const id of ["post-a", "post-b", "post-c", "post-d", "post-e"]) {
      insertPost(id, "viewer", "2026-08-27 10:00:00");
    }

    const first = listPostPageFromDatabase(database, { viewerId: "viewer", mode: "mine", cursor: null, limit: 2 });
    expect(first.posts.map((post) => post.id)).toEqual(["post-e", "post-d"]);
    expect(first.total).toBe(5);
    expect(first.nextCursor).not.toBeNull();

    const cursor = decodePostCursor(first.nextCursor!);
    expect(cursor).not.toBeNull();
    const second = listPostPageFromDatabase(database, { viewerId: "viewer", mode: "mine", cursor: cursor!, limit: 2 });
    const thirdCursor = decodePostCursor(second.nextCursor!);
    const third = listPostPageFromDatabase(database, { viewerId: "viewer", mode: "mine", cursor: thirdCursor!, limit: 2 });
    const ids = [...first.posts, ...second.posts, ...third.posts].map((post) => post.id);
    expect(ids).toEqual(["post-e", "post-d", "post-c", "post-b", "post-a"]);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it("base64 gönderi medyası ile kullanılmayan kapak/snapshot alanlarını feed DTO'suna taşımaz", () => {
    insertPost("post-media", "viewer", "2026-08-27 10:00:00", "data:image/jpeg;base64,legacy");
    database.prepare("INSERT INTO post_images (id, post_id, image_data, sort_order) VALUES ('image-1', 'post-media', 'data:image/jpeg;base64,one', 0)").run();
    database.prepare("INSERT INTO post_images (id, post_id, image_data, sort_order) VALUES ('image-2', 'post-media', 'data:image/jpeg;base64,two', 1)").run();

    const page = listPostPageFromDatabase(database, { viewerId: "viewer", mode: "mine", cursor: null, limit: 6 });
    expect(page.posts[0].images).toEqual([
      "/api/posts/post-media/images/0",
      "/api/posts/post-media/images/1",
    ]);
    expect(JSON.stringify(page)).not.toContain("base64,one");
    expect(JSON.stringify(page)).not.toContain("post-snapshot");
    expect(JSON.stringify(page)).not.toContain("cover-viewer");
    expect(JSON.stringify(page)).not.toContain("avatar-viewer");
    expect(page.posts[0].user.avatarData).toBe("/api/users/viewer/avatar");
  });

  it("keşfet, kayıtlı ve profil görünürlüğü kurallarını cursor sorgusunda korur", () => {
    insertPost("public-post", "public-player", "2026-08-27 10:02:00");
    insertPost("private-post", "private-player", "2026-08-27 10:01:00");
    database.prepare("INSERT INTO saved_posts (user_id, post_id) VALUES ('viewer', 'public-post'), ('viewer', 'private-post')").run();

    expect(listPostPageFromDatabase(database, { viewerId: "viewer", mode: "explore", cursor: null, limit: 6 }).posts.map((post) => post.id))
      .toEqual(["public-post"]);
    expect(listPostPageFromDatabase(database, { viewerId: "viewer", mode: "saved", cursor: null, limit: 6 }).posts.map((post) => post.id))
      .toEqual(["public-post"]);
    expect(listPostPageFromDatabase(database, { viewerId: "viewer", ownerId: "private-player", mode: "user", cursor: null, limit: 6 }).posts)
      .toEqual([]);

    database.prepare("INSERT INTO follows (follower_id, followed_id) VALUES ('viewer', 'private-player')").run();
    expect(listPostPageFromDatabase(database, { viewerId: "viewer", ownerId: "private-player", mode: "user", cursor: null, limit: 6 }).posts.map((post) => post.id))
      .toEqual(["private-post"]);
  });

  it("limit sınırını store katmanında uygular ve medya sırasını güvenli okur", () => {
    expect(() => listPostPageFromDatabase(database, { viewerId: "viewer", mode: "mine", cursor: null, limit: 13 })).toThrow(RangeError);
    insertPost("post-image", "viewer", "2026-08-27 10:00:00", "data:image/jpeg;base64,legacy");
    expect(getPostImageDataFromDatabase(database, "post-image", 0)).toBe("data:image/jpeg;base64,legacy");
    expect(getPostImageDataFromDatabase(database, "post-image", 1)).toBeNull();
    database.prepare("INSERT INTO post_images (id, post_id, image_data, sort_order) VALUES ('stored-1', 'post-image', 'data:image/jpeg;base64,new', 0)").run();
    expect(getPostImageDataFromDatabase(database, "post-image", 0)).toBe("data:image/jpeg;base64,new");
  });
});
