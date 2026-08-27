import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("SQLite uygulama migration sınırları", () => {
  it("notification actorünü geriye dönük doldurur ve tekrar çalıştırıldığında sonucu değiştirmez", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL,
        location_visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        map_view_json TEXT
      );
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, email, username, location_visibility)
      VALUES ('actor-1', 'actor@example.com', 'mrap_oyuncu', 'approximate');
      INSERT INTO notifications (id, user_id, type, body)
      VALUES
        ('notification-1', 'actor-1', 'follow', '@mrap_oyuncu seni takip etti'),
        ('notification-2', 'actor-1', 'system', 'Bir rota @mrap_oyuncu adını içeriyor');
    `);

    ensureLatestSchema(database);
    ensureLatestSchema(database);

    expect(database.prepare("SELECT actor_id FROM notifications WHERE id = 'notification-1'").get())
      .toEqual({ actor_id: "actor-1" });
    expect(database.prepare("SELECT actor_id FROM notifications WHERE id = 'notification-2'").get())
      .toEqual({ actor_id: null });
    expect(database.prepare("SELECT location_visibility FROM users WHERE id = 'actor-1'").get())
      .toEqual({ location_visibility: "private" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notifications_actor'").get())
      .toEqual({ name: "idx_notifications_actor" });
    const notificationColumns = (database.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(notificationColumns).toEqual(expect.arrayContaining(["actor_id", "resource_type", "resource_id"]));
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notifications_resource'").get())
      .toEqual({ name: "idx_notifications_resource" });
    expect(() => database!.prepare("INSERT INTO notifications (id, user_id, type, body, resource_type, resource_id) VALUES ('invalid-resource', 'actor-1', 'social', 'Bozuk', 'post', '../settings')").run()).toThrow();
    expect(() => database!.prepare("INSERT INTO notifications (id, user_id, type, body, resource_type, resource_id) VALUES ('valid-resource', 'actor-1', 'social', 'Güvenli', 'post', 'post-42')").run()).not.toThrow();
  });

  it("update işlemlerinde kullanıcı ve gönderi karakter sınırlarını veritabanında da uygular", () => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        username TEXT NOT NULL,
        location_visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, map_view_json TEXT);
      INSERT INTO users (id, email, username) VALUES ('user-1', 'user@example.com', 'oyuncu');
      INSERT INTO posts (id, title, body) VALUES ('post-1', 'Geçerli başlık', 'Geçerli açıklama');
    `);
    ensureLatestSchema(database);

    expect(() => database!.prepare("UPDATE users SET username = 'ab' WHERE id = 'user-1'").run()).toThrow();
    expect(() => database!.prepare("UPDATE users SET email = ? WHERE id = 'user-1'").run(`${"x".repeat(250)}@mail.com`)).toThrow();
    expect(() => database!.prepare("UPDATE posts SET title = '   ' WHERE id = 'post-1'").run()).toThrow();
    expect(() => database!.prepare("UPDATE posts SET body = ? WHERE id = 'post-1'").run("x".repeat(501))).toThrow();
    expect(() => database!.prepare("UPDATE posts SET title = 'Yeni başlık', body = 'Yeni açıklama' WHERE id = 'post-1'").run())
      .not.toThrow();
  });
});
