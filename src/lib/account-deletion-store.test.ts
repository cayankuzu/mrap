import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteAccountFromDatabase } from "@/lib/account-deletion-store";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE territories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL
    );
    CREATE TABLE world_state (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
    CREATE TABLE territory_cells (
      world_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (world_id, cell_id)
    );
    CREATE TABLE world_regions (
      world_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, region_id)
    );
    CREATE TABLE realtime_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      previous_version INTEGER NOT NULL,
      version INTEGER NOT NULL,
      claim_event_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dispatched_at TEXT
    );
    CREATE TABLE claim_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE claim_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      result_json TEXT
    );
    INSERT INTO world_state (id, version) VALUES (1, 7);
    INSERT INTO users (id, username) VALUES ('user-1', 'deleted_user'), ('user-2', 'remaining_user');
    INSERT INTO sessions (id, user_id) VALUES ('session-1', 'user-1');
    INSERT INTO territories (id, user_id) VALUES ('territory-1', 'user-1');
    INSERT INTO posts (id, user_id, territory_id) VALUES ('post-1', 'user-1', 'territory-1');
    INSERT INTO comments (id, user_id, post_id) VALUES ('comment-1', 'user-2', 'post-1');
    INSERT INTO notifications (id, user_id, actor_id, body) VALUES
      ('notification-owned', 'user-1', NULL, 'Kendi bildirimi'),
      ('notification-actor', 'user-2', 'user-1', 'Bir kaşif alan paylaşımını beğendi.'),
      ('notification-mention', 'user-2', NULL, '@deleted_user seni takip etmeye başladı.'),
      ('notification-unrelated-mention', 'user-2', NULL, 'Bir rota @deleted_user adını açıklamasında kullanıyor.'),
      ('notification-safe', 'user-2', NULL, 'Alanında yeni bir değişiklik var.');
  `);
});

afterEach(() => database.close());

describe("hesap verilerini kalıcı silme", () => {
  it("kök kullanıcıyı ve tüm ilişkili verileri atomik olarak kaldırır", () => {
    expect(deleteAccountFromDatabase(database, "user-1")).toBe(true);

    expect(database.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'user-1'").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM territories").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM posts").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM comments").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT id FROM notifications ORDER BY id").all()).toEqual([
      { id: "notification-safe" },
      { id: "notification-unrelated-mention" },
    ]);
    expect(database.prepare("SELECT version FROM world_state WHERE id = 1").get()).toEqual({ version: 8 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'user-2'").get()).toEqual({ count: 1 });
  });

  it("olmayan kullanıcı için dünya sürümünü değiştirmez", () => {
    expect(deleteAccountFromDatabase(database, "missing-user")).toBe(false);
    expect(database.prepare("SELECT version FROM world_state WHERE id = 1").get()).toEqual({ version: 7 });
  });

  it("kök kullanıcı silinemezse önceki temizlemeleri de rollback eder", () => {
    database.exec(`
      CREATE TRIGGER prevent_test_account_deletion
      BEFORE DELETE ON users
      WHEN OLD.id = 'user-1'
      BEGIN
        SELECT RAISE(ABORT, 'test deletion failure');
      END;
    `);

    expect(() => deleteAccountFromDatabase(database, "user-1")).toThrow("test deletion failure");
    expect(database.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'user-1'").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM notifications").get()).toEqual({ count: 5 });
    expect(database.prepare("SELECT version FROM world_state WHERE id = 1").get()).toEqual({ version: 7 });
  });

  it("silinen sahiplik hücrelerini region version ve realtime invalidation ile kaldırır", () => {
    database.exec(`
      INSERT INTO world_regions (world_id, region_id, version) VALUES ('world-main', '14/9500/6100', 4);
      INSERT INTO territory_cells (world_id, region_id, cell_id, owner_id)
      VALUES ('world-main', '14/9500/6100', '22/2432000/1561600', 'user-1');
    `);

    expect(deleteAccountFromDatabase(database, "user-1")).toBe(true);

    expect(database.prepare("SELECT COUNT(*) AS count FROM territory_cells").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT version FROM world_regions WHERE world_id = 'world-main' AND region_id = '14/9500/6100'").get()).toEqual({ version: 5 });
    const outbox = database.prepare("SELECT previous_version, version, payload_json FROM realtime_outbox").get() as {
      previous_version: number;
      version: number;
      payload_json: string;
    };
    expect(outbox.previous_version).toBe(4);
    expect(outbox.version).toBe(5);
    expect(JSON.parse(outbox.payload_json)).toMatchObject({
      type: "region_patch",
      changedCells: [{ cellId: "22/2432000/1561600", ownerId: null, paintColorId: null }],
    });
  });

  it("rakibin idempotent claim sonucundan silinen kullanıcı referansını redakte eder", () => {
    database.prepare("INSERT INTO claim_events (id, user_id) VALUES ('event-deleted', 'user-1')").run();
    database.prepare("INSERT INTO claim_commands (id, user_id, result_json) VALUES (?, ?, ?)").run(
      "command-surviving",
      "user-2",
      JSON.stringify({
        status: "accepted",
        finalTerritoryAreaM2: 420,
        capturedFrom: [
          { userId: "user-1", areaM2: 120 },
          { userId: "user-2", areaM2: 40 },
        ],
      }),
    );
    database.prepare("INSERT INTO claim_commands (id, user_id, result_json) VALUES ('command-deleted', 'user-1', '{}')").run();

    expect(deleteAccountFromDatabase(database, "user-1")).toBe(true);

    const surviving = database.prepare("SELECT result_json FROM claim_commands WHERE id = 'command-surviving'").get() as { result_json: string };
    expect(JSON.parse(surviving.result_json)).toEqual({
      status: "accepted",
      finalTerritoryAreaM2: 420,
      capturedFrom: [{ userId: "user-2", areaM2: 40 }],
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM claim_commands WHERE id = 'command-deleted'").get()).toEqual({ count: 0 });
    expect(surviving.result_json).not.toContain("user-1");
  });

  it("rakibin immutable hücre geçmişindeki eski sahip referansını silerek hesap silmeyi engellemez", () => {
    database.exec(`
      CREATE TABLE claim_cell_changes (
        claim_event_id TEXT NOT NULL REFERENCES claim_events(id) ON DELETE CASCADE,
        cell_id TEXT NOT NULL,
        old_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        new_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (claim_event_id, cell_id)
      );
      CREATE TRIGGER trg_claim_cell_changes_immutable_update
        BEFORE UPDATE ON claim_cell_changes
        BEGIN SELECT RAISE(ABORT, 'claim cell changes are immutable'); END;
      INSERT INTO claim_events (id, user_id) VALUES ('event-surviving', 'user-2');
      INSERT INTO claim_cell_changes (claim_event_id, cell_id, old_owner_id, new_owner_id)
      VALUES ('event-surviving', '22/2432000/1561600', 'user-1', 'user-2');
    `);

    expect(deleteAccountFromDatabase(database, "user-1")).toBe(true);

    expect(database.prepare("SELECT COUNT(*) AS count FROM users WHERE id = 'user-1'").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM claim_cell_changes").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM claim_events WHERE id = 'event-surviving'").get()).toEqual({ count: 1 });
  });
});
