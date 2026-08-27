import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("SQLite geriye uyumlu migration", () => {
  it("başlığı backfill eder ve hesap kimliklerini büyük/küçük harften bağımsız tekilleştirir", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT NOT NULL, location_visibility TEXT NOT NULL DEFAULT 'private');
      CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO users (id, email, username) VALUES ('u1', 'User@Example.com', 'PlayerOne');
      INSERT INTO posts (id, body) VALUES ('p1', '  Akşam rotasının hikâyesi  ');
    `);

    ensureLatestSchema(database);

    expect(database.prepare("SELECT title FROM posts WHERE id = 'p1'").get()).toEqual({ title: "Akşam rotasının hikâyesi" });
    expect(() => database!.prepare("INSERT INTO users (id, email, username) VALUES ('u2', 'user@example.COM', 'other')").run()).toThrow();
    expect(() => database!.prepare("INSERT INTO users (id, email, username) VALUES ('u3', 'other@example.com', 'PLAYERONE')").run()).toThrow();
    expect(() => database!.prepare("INSERT INTO users (id, email, username) VALUES ('u4', 'short@example.com', 'ab')").run()).toThrow();
    expect(() => database!.prepare("UPDATE users SET location_visibility = 'approximate' WHERE id = 'u1'").run()).toThrow();
    expect(() => database!.prepare("INSERT INTO posts (id, title, body) VALUES ('p2', '', 'gövde')").run()).toThrow();
  });

  it("yorum uzunluğunu veritabanında da korur ve keyset indeksini kurar", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, username TEXT NOT NULL, location_visibility TEXT NOT NULL DEFAULT 'private');
      CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE comments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    ensureLatestSchema(database);

    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_comments_post_page'").get())
      .toEqual({ name: "idx_comments_post_page" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_posts_page'").get())
      .toEqual({ name: "idx_posts_page" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_posts_user_idempotency'").get())
      .toEqual({ name: "idx_posts_user_idempotency" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_comments_user_post_idempotency'").get())
      .toEqual({ name: "idx_comments_user_post_idempotency" });
    expect(() => database!.prepare("INSERT INTO comments (id, user_id, post_id, body) VALUES ('c1', 'u1', 'p1', '   ')").run()).toThrow();
    expect(() => database!.prepare("INSERT INTO comments (id, user_id, post_id, body) VALUES ('c2', 'u1', 'p1', ?)").run("x".repeat(301))).toThrow();
    expect(() => database!.prepare("INSERT INTO comments (id, user_id, post_id, body) VALUES ('c3', 'u1', 'p1', 'Geçerli yorum')").run()).not.toThrow();
    expect(() => database!.prepare("INSERT INTO comments (id, user_id, post_id, body, idempotency_key, payload_hash) VALUES ('c4', 'u1', 'p1', 'Geçerli', 'kısa', ?)").run("a".repeat(64))).toThrow();
    expect(() => database!.prepare("INSERT INTO posts (id, user_id, title, body, idempotency_key, payload_hash) VALUES ('p2', 'u1', 'Başlık', '', 'post-attempt-12345678', NULL)").run()).toThrow();
    database.prepare("INSERT INTO posts (id, user_id, title, body, idempotency_key, payload_hash) VALUES ('p3', 'u1', 'Başlık', '', 'post-attempt-12345678', ?)").run("a".repeat(64));
    expect(() => database!.prepare("INSERT INTO posts (id, user_id, title, body, idempotency_key, payload_hash) VALUES ('p4', 'u1', 'Başlık', '', 'post-attempt-12345678', ?)").run("a".repeat(64))).toThrow();
    database.prepare("INSERT INTO comments (id, user_id, post_id, body, idempotency_key, payload_hash) VALUES ('c5', 'u1', 'p1', 'Geçerli', 'comment-attempt-12345678', ?)").run("b".repeat(64));
    expect(() => database!.prepare("INSERT INTO comments (id, user_id, post_id, body, idempotency_key, payload_hash) VALUES ('c6', 'u1', 'p1', 'Geçerli', 'comment-attempt-12345678', ?)").run("b".repeat(64))).toThrow();
  });
});
