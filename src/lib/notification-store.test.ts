import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertPostInteractionNotification, listNotificationsFromDatabase } from "@/lib/notification-store";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      actor_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, username) VALUES ('owner', 'sahip'), ('actor', 'gezgin');
  `);
});

afterEach(() => database.close());

describe("bildirim kaynak bağlantıları", () => {
  it.each(["post_like", "post_comment"] as const)("%s kaydını tekil gönderiye bağlar", (type) => {
    expect(insertPostInteractionNotification(database, { recipientId: "owner", actorId: "actor", postId: "post-42", type })).toBe(true);
    const [notification] = listNotificationsFromDatabase(database, "owner");
    expect(notification.type).toBe(type);
    expect(notification.href).toBe("/posts/post-42");
  });

  it("kişinin kendi etkileşimi için gereksiz bildirim oluşturmaz", () => {
    expect(insertPostInteractionNotification(database, { recipientId: "owner", actorId: "owner", postId: "post-42", type: "post_like" })).toBe(false);
    expect(listNotificationsFromDatabase(database, "owner")).toEqual([]);
  });

  it("güvensiz kaynak kimliğini veritabanına ulaşmadan reddeder", () => {
    expect(() => insertPostInteractionNotification(database, { recipientId: "owner", actorId: "actor", postId: "../settings", type: "post_like" })).toThrow(RangeError);
    expect(listNotificationsFromDatabase(database, "owner")).toEqual([]);
  });

  it("bozuk eski kaynakta güvenli oyuncu profili fallback'ini kullanır", () => {
    database.prepare(`
      INSERT INTO notifications (id, user_id, actor_id, type, title, body, resource_type, resource_id)
      VALUES ('legacy', 'owner', 'actor', 'post_like', 'Eski bildirim', 'İçerik', 'post', '../settings')
    `).run();
    expect(listNotificationsFromDatabase(database, "owner")[0].href).toBe("/users/gezgin");
  });
});
