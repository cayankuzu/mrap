import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureAuthoritativeGameSchema } from "@/server/game/schema";

vi.mock("server-only", () => ({}));

let database: DatabaseSync | undefined;

function baseDatabase() {
  database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return database;
}

function columnsOf(db: DatabaseSync, table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name);
}

function replaceCurrentTablesWithLegacyVersions(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = OFF;

    DROP TABLE territory_cells;
    CREATE TABLE territory_cells (
      world_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      paint_color_id TEXT NOT NULL,
      owner_changed_at TEXT NOT NULL,
      paint_changed_at TEXT NOT NULL,
      claim_event_id TEXT NOT NULL,
      PRIMARY KEY (world_id, cell_id)
    );

    DROP TABLE competitive_route_sessions;
    CREATE TABLE competitive_route_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL
    );

    DROP TABLE authoritative_saved_routes;
    CREATE TABLE authoritative_saved_routes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL
    );

    DROP TABLE claim_commands;
    CREATE TABLE claim_commands (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    DROP TABLE realtime_outbox;
    CREATE TABLE realtime_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      region_id TEXT NOT NULL,
      previous_version INTEGER NOT NULL,
      version INTEGER NOT NULL,
      claim_event_id TEXT NOT NULL REFERENCES claim_events(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dispatched_at TEXT,
      CHECK (version = previous_version + 1)
    );

    PRAGMA foreign_keys = ON;
  `);
}

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("authoritative SQLite şeması", () => {
  it("fresh kurulumda dünyaları, güvenlik kısıtlarını ve gerekli indeksleri idempotent kurar", () => {
    const db = baseDatabase();

    ensureAuthoritativeGameSchema(db);
    ensureAuthoritativeGameSchema(db);

    expect(db.prepare("SELECT id, kind FROM game_worlds ORDER BY id").all()).toEqual([
      { id: "development-sandbox", kind: "development" },
      { id: "world-main", kind: "production" },
    ]);
    expect(columnsOf(db, "notifications")).toContain("source_event_id");
    expect(columnsOf(db, "notifications")).toEqual(expect.arrayContaining(["resource_type", "resource_id"]));
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'trg_claim_events_immutable_update',
        'trg_claim_cell_changes_immutable_update'
      ) ORDER BY name
    `).all()).toEqual([
      { name: "trg_claim_cell_changes_immutable_update" },
      { name: "trg_claim_events_immutable_update" },
    ]);

    expect(() => db.prepare(`
      INSERT INTO realtime_outbox
        (event_id, world_id, region_id, previous_version, version, claim_event_id, payload_json, created_at)
      VALUES ('event-invalid', 'world-main', 'region-1', 0, 2, 'claim-1', '{}', CURRENT_TIMESTAMP)
    `).run()).toThrow();
  });

  it("legacy kolonlarını yükseltir ve claim-only outbox foreign key'ini veri modelinden kaldırır", () => {
    const db = baseDatabase();
    ensureAuthoritativeGameSchema(db);
    replaceCurrentTablesWithLegacyVersions(db);

    ensureAuthoritativeGameSchema(db);
    ensureAuthoritativeGameSchema(db);

    expect(columnsOf(db, "territory_cells")).toEqual(expect.arrayContaining([
      "area_m2",
      "ownership_version",
      "paint_version",
    ]));
    expect(columnsOf(db, "competitive_route_sessions")).toContain("risk_score");
    expect(columnsOf(db, "competitive_route_sessions")).toEqual(expect.arrayContaining([
      "accepted_distance_m",
      "current_segment_index",
    ]));
    expect(columnsOf(db, "route_points")).toContain("segment_index");
    expect(columnsOf(db, "authoritative_saved_routes")).toContain("visibility");
    expect(columnsOf(db, "claim_commands")).toContain("pipeline_json");
    expect(db.prepare("PRAGMA foreign_key_list(realtime_outbox)").all())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ table: "claim_events", from: "claim_event_id" })]));
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("outbox rebuild başarısızlığında transactionı geri alıp foreign key denetimini yeniden açar", () => {
    const db = baseDatabase();
    ensureAuthoritativeGameSchema(db);
    replaceCurrentTablesWithLegacyVersions(db);
    db.exec("CREATE TABLE realtime_outbox_claim_only (id TEXT PRIMARY KEY)");

    expect(() => ensureAuthoritativeGameSchema(db)).toThrow();
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'realtime_outbox'").get())
      .toEqual({ name: "realtime_outbox" });
  });
});
