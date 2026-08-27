import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeCommentCursor, encodeCommentCursor } from "@/lib/comment-cursor";
import { addPostCommentToDatabase, listPostCommentsFromDatabase } from "@/lib/post-comment-store";

let database: DatabaseSync;

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
    INSERT INTO users (
      id, username, display_name, color, pattern, country_code, city_id, country, city,
      bio, account_visibility, created_at
    ) VALUES (
      'user-1', 'oyuncu', 'Ada Yılmaz', '#0D8BFF', 0, 'TR', 'tr-istanbul', 'Türkiye', 'İstanbul',
      '', 'public', '2026-08-01 09:00:00'
    );
    INSERT INTO posts (id) VALUES ('post-1');
  `);
});

afterEach(() => database.close());

describe("yorum cursor sınırları", () => {
  it("encode aşamasında geçersiz tarih veya kimliği reddeder", () => {
    expect(() => encodeCommentCursor({ createdAt: "geçersiz", id: "comment-1" })).toThrow(RangeError);
    expect(() => encodeCommentCursor({ createdAt: "2026-08-27 12:00:00", id: "../comment" })).toThrow(RangeError);
  });

  it.each([null, [], "metin"])("JSON %s değerini cursor nesnesi kabul etmez", (value) => {
    const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

    expect(decodeCommentCursor(encoded)).toBeNull();
  });
});

describe("yorum store hata sınırları", () => {
  it.each([0, 51, 1.5])("geçersiz sayfa limitini sorgudan önce reddeder: %s", (limit) => {
    expect(() => listPostCommentsFromDatabase(database, "post-1", { cursor: null, limit }))
      .toThrow(RangeError);
  });

  it("insert sonrası satır okunamazsa transactionı rollback eder", () => {
    database.exec(`
      CREATE TRIGGER remove_inserted_comment
      AFTER INSERT ON comments
      BEGIN
        DELETE FROM comments WHERE id = NEW.id;
      END;
    `);

    expect(() => addPostCommentToDatabase(database, "user-1", "post-1", "Geçerli yorum"))
      .toThrow("Eklenen yorum okunamadı.");
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 0 });
  });

  it("aynı transaction içindeki yan etki başarısızsa yorumu da rollback eder", () => {
    expect(() => addPostCommentToDatabase(
      database,
      "user-1",
      "post-1",
      "Geçerli yorum",
      "comment-attempt-12345678",
      () => { throw new Error("notification unavailable"); },
    )).toThrow("notification unavailable");
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 0 });
  });
});
