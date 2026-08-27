import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateNotificationActorUsername } from "@/lib/notification-identity-store";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE notifications (id TEXT PRIMARY KEY, actor_id TEXT, body TEXT NOT NULL);
    INSERT INTO notifications (id, actor_id, body) VALUES
      ('owned-prefix', 'user-1', '@eski seni takip etmeye başladı.'),
      ('legacy-prefix', NULL, '@eski seni takip etmek istiyor.'),
      ('unrelated-middle', NULL, 'Bir rota @eski adını açıklamasında kullanıyor.'),
      ('different-actor', 'user-2', '@eski metni başka bir olaya ait.');
  `);
});

afterEach(() => database.close());

describe("bildirim aktörü kullanıcı adı değişimi", () => {
  it("yalnız doğrulanmış aktör veya legacy başlangıç önekini değiştirir", () => {
    const result = updateNotificationActorUsername(database, "user-1", "eski", "yeni");

    expect(result.changes).toBe(2);
    expect(database.prepare("SELECT id, body FROM notifications ORDER BY id").all()).toEqual([
      { id: "different-actor", body: "@eski metni başka bir olaya ait." },
      { id: "legacy-prefix", body: "@yeni seni takip etmek istiyor." },
      { id: "owned-prefix", body: "@yeni seni takip etmeye başladı." },
      { id: "unrelated-middle", body: "Bir rota @eski adını açıklamasında kullanıyor." },
    ]);
  });
});
