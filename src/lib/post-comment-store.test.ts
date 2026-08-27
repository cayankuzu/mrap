import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeCommentCursor } from "@/lib/comment-cursor";
import { addPostCommentToDatabase, listPostCommentsFromDatabase } from "@/lib/post-comment-store";
import { IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";

let database: DatabaseSync;

function insertUser(id: string, username: string, displayName: string) {
  database.prepare(`
    INSERT INTO users (
      id, username, display_name, color, pattern, country_code, city_id, country, city,
      bio, account_visibility, avatar_data, cover_data, created_at
    ) VALUES (?, ?, ?, '#0D8BFF', 0, 'TR', 'tr-istanbul', 'Türkiye', 'İstanbul', '', 'public', NULL, NULL, ?)
  `).run(id, username, displayName, "2026-08-01 09:00:00");
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      color TEXT NOT NULL,
      pattern INTEGER NOT NULL,
      country_code TEXT NOT NULL,
      city_id TEXT NOT NULL,
      country TEXT NOT NULL,
      city TEXT NOT NULL,
      bio TEXT NOT NULL,
      account_visibility TEXT NOT NULL,
      avatar_data TEXT,
      cover_data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE posts (id TEXT PRIMARY KEY);
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      idempotency_key TEXT,
      payload_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_comments_post_page ON comments(post_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX idx_comments_user_post_idempotency
      ON comments(user_id, post_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    INSERT INTO posts (id) VALUES ('post-1');
  `);
  insertUser("user-1", "cayan", "Cayan Akın");
  insertUser("user-2", "gezgin", "Ada Yılmaz");
});

afterEach(() => database.close());

describe("yorum SQLite store", () => {
  it("aynı zaman damgasında id eşitlik bozucusuyla eksiksiz keyset sayfalar", () => {
    const insert = database.prepare("INSERT INTO comments (id, user_id, post_id, body, created_at) VALUES (?, ?, 'post-1', ?, ?)");
    insert.run("comment-a", "user-1", "İlk", "2026-08-27 10:00:00");
    insert.run("comment-b", "user-2", "İkinci", "2026-08-27 10:00:00");
    insert.run("comment-c", "user-1", "En yeni", "2026-08-27 10:01:00");

    const first = listPostCommentsFromDatabase(database, "post-1", { cursor: null, limit: 2 });
    expect(first.comments.map((comment) => comment.id)).toEqual(["comment-c", "comment-b"]);
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();

    const cursor = decodeCommentCursor(first.nextCursor!);
    expect(cursor).not.toBeNull();
    const second = listPostCommentsFromDatabase(database, "post-1", { cursor: cursor!, limit: 2 });
    expect(second.comments.map((comment) => comment.id)).toEqual(["comment-a"]);
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(3);
    expect(new Set([...first.comments, ...second.comments].map((comment) => comment.id)).size).toBe(3);
  });

  it("ekleme sonucunda kompakt yorum DTO'su ile güncel toplamı döndürür", () => {
    const result = addPostCommentToDatabase(database, "user-1", "post-1", "  Harika bir rota!  ");

    expect(result.total).toBe(1);
    expect(result.comment).toMatchObject({
      id: expect.any(String),
      postId: "post-1",
      body: "Harika bir rota!",
      createdAt: expect.any(String),
      user: {
        id: "user-1",
        username: "cayan",
        displayName: "Cayan Akın",
        initials: "CA",
        avatarData: null,
      },
    });
    expect(Object.keys(result.comment.user).sort()).toEqual(["avatarData", "color", "displayName", "id", "initials", "username"]);
  });

  it("yorum payload'ına biyografi, konum, kapak veya base64 avatar taşımaz", () => {
    database.prepare(`
      UPDATE users SET
        bio = 'PAYLOAD_SECRET_BIO', country = 'PAYLOAD_SECRET_COUNTRY', city = 'PAYLOAD_SECRET_CITY',
        avatar_data = 'data:image/jpeg;base64,/9j/2Q==', cover_data = 'PAYLOAD_SECRET_COVER'
      WHERE id = 'user-1'
    `).run();
    const result = addPostCommentToDatabase(database, "user-1", "post-1", "Kompakt yorum");
    const serialized = JSON.stringify(result.comment);

    expect(result.comment.user.avatarData).toBe("/api/users/user-1/avatar");
    expect(serialized).not.toMatch(/PAYLOAD_SECRET|base64/i);
    expect(serialized.length).toBeLessThan(500);
  });

  it("doğrudan store kullanımında da boş ve 300 karakteri aşan yorumu reddeder", () => {
    expect(() => addPostCommentToDatabase(database, "user-1", "post-1", "   ")).toThrow(RangeError);
    expect(() => addPostCommentToDatabase(database, "user-1", "post-1", "x".repeat(301))).toThrow(RangeError);
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 0 });
  });

  it("yanıt kaybı retry'ında aynı yorumu yeniden eklemeden aynı sonucu replay eder", () => {
    const key = "comment-attempt-12345678";
    const first = addPostCommentToDatabase(database, "user-1", "post-1", "Tek kez yaz", key);
    const replay = addPostCommentToDatabase(database, "user-1", "post-1", "Tek kez yaz", key);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.comment.id).toBe(first.comment.id);
    expect(replay.total).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments WHERE post_id = 'post-1'").get()).toEqual({ count: 1 });
  });

  it("aynı yorum anahtarının farklı payload ile yeniden kullanımını reddeder", () => {
    const key = "comment-attempt-12345678";
    addPostCommentToDatabase(database, "user-1", "post-1", "İlk metin", key);

    expect(() => addPostCommentToDatabase(database, "user-1", "post-1", "Değişen metin", key))
      .toThrow(IdempotencyPayloadConflictError);
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 1 });
  });

  it("bildirim callback'i başarısızsa yorumu geri alır ve replay sırasında callback'i tekrarlamaz", () => {
    const failedKey = "comment-failed-12345678";
    expect(() => addPostCommentToDatabase(database, "user-1", "post-1", "Atomik yorum", failedKey, () => {
      throw new Error("Bildirim yazılamadı");
    })).toThrow("Bildirim yazılamadı");
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 0 });

    const key = "comment-created-12345678";
    let callbackCount = 0;
    const first = addPostCommentToDatabase(database, "user-1", "post-1", "Tek bildirim", key, () => { callbackCount += 1; });
    const replay = addPostCommentToDatabase(database, "user-1", "post-1", "Tek bildirim", key, () => { callbackCount += 1; });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(callbackCount).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 1 });
  });
});
