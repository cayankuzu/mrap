import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("kullanıcı arama anahtarı migration'ı", () => {
  it("eski kullanıcıları Türkçe uyumlu biçimde backfill eder ve tekrar çalıştırılabilir", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        location_visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        map_view_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, email, username, display_name)
      VALUES ('u1', 'cayan@example.com', 'cayan', 'Çayan Işık');
    `);

    ensureLatestSchema(database);
    ensureLatestSchema(database);

    expect(database.prepare("SELECT search_key FROM users WHERE id = 'u1'").get()).toEqual({ search_key: "cayan cayan isik" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_search_key'").get())
      .toEqual({ name: "idx_users_search_key" });
  });

  it("bozulmuş veya eski anahtarı sonraki güvenli başlangıçta düzeltir", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        search_key TEXT NOT NULL DEFAULT '',
        location_visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, map_view_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO users (id, email, username, display_name, search_key)
      VALUES ('u1', 'ipek@example.com', 'ipek', 'İpek Şule', 'eski-değer');
    `);

    ensureLatestSchema(database);

    expect(database.prepare("SELECT search_key FROM users WHERE id = 'u1'").get()).toEqual({ search_key: "ipek ipek sule" });
  });
});
