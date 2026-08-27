import "server-only";

import type { DatabaseSync } from "node:sqlite";

export function ensureAuthoritativeGameSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS game_worlds (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('production', 'development')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS world_regions (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      region_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, region_id)
    );

    CREATE TABLE IF NOT EXISTS competitive_route_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE RESTRICT,
      mode TEXT NOT NULL CHECK (mode IN ('real_gps', 'development_simulation')),
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'closing', 'completed', 'expired', 'revoked')),
      server_nonce_hash TEXT NOT NULL CHECK (length(server_nonce_hash) = 64),
      last_received_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_received_sequence >= 0),
      last_accepted_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_accepted_sequence >= 0),
      accepted_point_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_point_count >= 0),
      suspicious_point_count INTEGER NOT NULL DEFAULT 0 CHECK (suspicious_point_count >= 0),
      accepted_distance_m REAL NOT NULL DEFAULT 0 CHECK (accepted_distance_m >= 0),
      current_segment_index INTEGER NOT NULL DEFAULT 0 CHECK (current_segment_index >= 0),
      risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
      lease_expires_at TEXT NOT NULL,
      started_at_server TEXT NOT NULL,
      finished_at_server TEXT,
      revoked_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_competitive_session
      ON competitive_route_sessions(user_id, world_id)
      WHERE status IN ('active', 'paused', 'closing');
    CREATE INDEX IF NOT EXISTS idx_competitive_sessions_lease
      ON competitive_route_sessions(status, lease_expires_at);

    CREATE TABLE IF NOT EXISTS route_point_batches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES competitive_route_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      first_sequence INTEGER NOT NULL,
      last_sequence INTEGER NOT NULL,
      accepted_count INTEGER NOT NULL DEFAULT 0,
      ignored_count INTEGER NOT NULL DEFAULT 0,
      suspicious_count INTEGER NOT NULL DEFAULT 0,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (session_id, idempotency_key),
      CHECK (first_sequence > 0 AND last_sequence >= first_sequence)
    );

    CREATE TABLE IF NOT EXISTS route_points (
      session_id TEXT NOT NULL REFERENCES competitive_route_sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      latitude REAL NOT NULL CHECK (latitude BETWEEN -85.05112878 AND 85.05112878),
      longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      accuracy_m REAL NOT NULL CHECK (accuracy_m >= 0),
      altitude_m REAL,
      speed_mps REAL,
      heading REAL,
      client_observed_at TEXT,
      received_at_server TEXT NOT NULL,
      classification TEXT NOT NULL CHECK (classification IN ('ACCEPTED', 'IGNORED_LOW_ACCURACY', 'IGNORED_OUTLIER', 'SUSPICIOUS', 'REJECTED')),
      classification_reason TEXT,
      segment_index INTEGER NOT NULL DEFAULT 0 CHECK (segment_index >= 0),
      point_hash TEXT NOT NULL CHECK (length(point_hash) = 64),
      PRIMARY KEY (session_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_route_points_accepted
      ON route_points(session_id, classification, sequence);

    CREATE TABLE IF NOT EXISTS loop_candidates (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES competitive_route_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_sequence INTEGER NOT NULL,
      end_sequence INTEGER NOT NULL,
      source_segment_index INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('ACTIVE_ROUTE', 'OWN_TERRITORY')),
      coordinates_hash TEXT NOT NULL CHECK (length(coordinates_hash) = 64),
      polygon_json TEXT NOT NULL,
      estimated_area_m2 REAL NOT NULL CHECK (estimated_area_m2 >= 0),
      route_length_m REAL NOT NULL CHECK (route_length_m >= 0),
      status TEXT NOT NULL CHECK (status IN ('available', 'accepted', 'continued', 'expired', 'invalid')),
      detected_at_server TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_loop_candidates_session
      ON loop_candidates(session_id, end_sequence DESC);

    CREATE TABLE IF NOT EXISTS claim_commands (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE RESTRICT,
      session_id TEXT NOT NULL REFERENCES competitive_route_sessions(id) ON DELETE RESTRICT,
      candidate_id TEXT NOT NULL REFERENCES loop_candidates(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      status TEXT NOT NULL,
      result_json TEXT,
      error_code TEXT,
      pipeline_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      UNIQUE (user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_claim_commands_session ON claim_commands(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS territory_cells (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      cell_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      paint_color_id TEXT NOT NULL,
      area_m2 REAL NOT NULL CHECK (area_m2 > 0),
      ownership_version INTEGER NOT NULL DEFAULT 1 CHECK (ownership_version >= 1),
      paint_version INTEGER NOT NULL DEFAULT 1 CHECK (paint_version >= 1),
      owner_changed_at TEXT NOT NULL,
      paint_changed_at TEXT NOT NULL,
      claim_event_id TEXT NOT NULL,
      PRIMARY KEY (world_id, cell_id)
    );
    CREATE INDEX IF NOT EXISTS idx_territory_cells_owner ON territory_cells(world_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_territory_cells_region ON territory_cells(world_id, region_id, cell_id);

    CREATE TABLE IF NOT EXISTS player_scores (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      unique_owned_area_m2 REAL NOT NULL DEFAULT 0 CHECK (unique_owned_area_m2 >= 0),
      owned_cell_count INTEGER NOT NULL DEFAULT 0 CHECK (owned_cell_count >= 0),
      claim_count INTEGER NOT NULL DEFAULT 0 CHECK (claim_count >= 0),
      captured_area_m2 REAL NOT NULL DEFAULT 0 CHECK (captured_area_m2 >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS claim_events (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES competitive_route_sessions(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES loop_candidates(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL UNIQUE REFERENCES claim_commands(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'partially_accepted', 'rejected')),
      selected_color_id TEXT NOT NULL,
      raw_polygon_json TEXT NOT NULL,
      newly_claimed_area_m2 REAL NOT NULL DEFAULT 0,
      captured_from_others_area_m2 REAL NOT NULL DEFAULT 0,
      already_owned_area_m2 REAL NOT NULL DEFAULT 0,
      restricted_area_m2 REAL NOT NULL DEFAULT 0,
      total_loop_area_m2 REAL NOT NULL DEFAULT 0,
      total_area_after_m2 REAL NOT NULL DEFAULT 0,
      concurrent_recalculation INTEGER NOT NULL DEFAULT 0 CHECK (concurrent_recalculation IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claim_cell_changes (
      claim_event_id TEXT NOT NULL REFERENCES claim_events(id) ON DELETE CASCADE,
      cell_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      old_owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      new_owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_paint_color_id TEXT,
      new_paint_color_id TEXT NOT NULL,
      area_m2 REAL NOT NULL CHECK (area_m2 > 0),
      PRIMARY KEY (claim_event_id, cell_id)
    );

    CREATE TABLE IF NOT EXISTS authoritative_saved_routes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES competitive_route_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE RESTRICT,
      distance_m REAL NOT NULL CHECK (distance_m >= 0),
      duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
      accepted_point_count INTEGER NOT NULL CHECK (accepted_point_count >= 0),
      closed_claim_count INTEGER NOT NULL DEFAULT 0 CHECK (closed_claim_count >= 0),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'followers', 'public')),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS realtime_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      region_id TEXT NOT NULL,
      previous_version INTEGER NOT NULL,
      version INTEGER NOT NULL,
      claim_event_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dispatched_at TEXT,
      CHECK (version = previous_version + 1)
    );
    CREATE INDEX IF NOT EXISTS idx_realtime_outbox_region
      ON realtime_outbox(world_id, region_id, sequence);

    CREATE TABLE IF NOT EXISTS restricted_regions (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      cell_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, cell_id)
    );

    CREATE TABLE IF NOT EXISTS moderation_reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('claim_event', 'paint', 'territory', 'post')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_moderation_reports_queue ON moderation_reports(status, created_at);

    CREATE TABLE IF NOT EXISTS region_moderation_queue (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      region_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, region_id)
    );

    CREATE TABLE IF NOT EXISTS masked_paints (
      world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
      cell_id TEXT NOT NULL,
      claim_event_id TEXT REFERENCES claim_events(id) ON DELETE SET NULL,
      moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (world_id, cell_id)
    );

    CREATE TABLE IF NOT EXISTS blocked_players (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (blocker_id, blocked_id),
      CHECK (blocker_id <> blocked_id)
    );

    CREATE TABLE IF NOT EXISTS admin_game_actions (
      id TEXT PRIMARY KEY,
      admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      world_id TEXT REFERENCES game_worlds(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      previous_state_json TEXT NOT NULL,
      next_state_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      session_id TEXT REFERENCES competitive_route_sessions(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      safe_context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      safe_context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_rate_limits (
      scope_key TEXT PRIMARY KEY,
      window_started_at_ms INTEGER NOT NULL,
      hit_count INTEGER NOT NULL CHECK (hit_count >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_metrics (
      metric_key TEXT PRIMARY KEY,
      metric_value INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TRIGGER IF NOT EXISTS trg_claim_events_immutable_update
      BEFORE UPDATE ON claim_events BEGIN SELECT RAISE(ABORT, 'claim events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS trg_claim_cell_changes_immutable_update
      BEFORE UPDATE ON claim_cell_changes BEGIN SELECT RAISE(ABORT, 'claim cell changes are immutable'); END;

    INSERT OR IGNORE INTO game_worlds (id, kind) VALUES ('world-main', 'production');
    INSERT OR IGNORE INTO game_worlds (id, kind) VALUES ('development-sandbox', 'development');

    DROP TRIGGER IF EXISTS trg_claim_events_immutable_delete;
    DROP TRIGGER IF EXISTS trg_claim_cell_changes_immutable_delete;
  `);

  const notificationColumns = new Set(
    (database.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!notificationColumns.has("source_event_id")) database.exec("ALTER TABLE notifications ADD COLUMN source_event_id TEXT");
  if (!notificationColumns.has("resource_type")) database.exec("ALTER TABLE notifications ADD COLUMN resource_type TEXT");
  if (!notificationColumns.has("resource_id")) database.exec("ALTER TABLE notifications ADD COLUMN resource_id TEXT");
  const territoryCellColumns = new Set(
    (database.prepare("PRAGMA table_info(territory_cells)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!territoryCellColumns.has("area_m2")) {
    database.exec("ALTER TABLE territory_cells ADD COLUMN area_m2 REAL NOT NULL DEFAULT 1 CHECK (area_m2 > 0)");
  }
  if (!territoryCellColumns.has("ownership_version")) {
    database.exec("ALTER TABLE territory_cells ADD COLUMN ownership_version INTEGER NOT NULL DEFAULT 1 CHECK (ownership_version >= 1)");
  }
  if (!territoryCellColumns.has("paint_version")) {
    database.exec("ALTER TABLE territory_cells ADD COLUMN paint_version INTEGER NOT NULL DEFAULT 1 CHECK (paint_version >= 1)");
  }
  const competitiveSessionColumns = new Set(
    (database.prepare("PRAGMA table_info(competitive_route_sessions)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!competitiveSessionColumns.has("risk_score")) {
    database.exec("ALTER TABLE competitive_route_sessions ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0)");
  }
  if (!competitiveSessionColumns.has("accepted_distance_m")) {
    database.exec("ALTER TABLE competitive_route_sessions ADD COLUMN accepted_distance_m REAL NOT NULL DEFAULT 0 CHECK (accepted_distance_m >= 0)");
  }
  if (!competitiveSessionColumns.has("current_segment_index")) {
    database.exec("ALTER TABLE competitive_route_sessions ADD COLUMN current_segment_index INTEGER NOT NULL DEFAULT 0 CHECK (current_segment_index >= 0)");
  }
  const routePointColumns = new Set(
    (database.prepare("PRAGMA table_info(route_points)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!routePointColumns.has("segment_index")) {
    database.exec("ALTER TABLE route_points ADD COLUMN segment_index INTEGER NOT NULL DEFAULT 0 CHECK (segment_index >= 0)");
  }
  const savedRouteColumns = new Set(
    (database.prepare("PRAGMA table_info(authoritative_saved_routes)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!savedRouteColumns.has("visibility")) {
    database.exec("ALTER TABLE authoritative_saved_routes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'followers', 'public'))");
  }
  const claimCommandColumns = new Set(
    (database.prepare("PRAGMA table_info(claim_commands)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!claimCommandColumns.has("pipeline_json")) {
    database.exec("ALTER TABLE claim_commands ADD COLUMN pipeline_json TEXT NOT NULL DEFAULT '[]'");
  }
  const outboxForeignKeys = database.prepare("PRAGMA foreign_key_list(realtime_outbox)").all() as Array<{ table: string; from: string }>;
  if (outboxForeignKeys.some((foreignKey) => foreignKey.table === "claim_events" && foreignKey.from === "claim_event_id")) {
    // System invalidations (for example account deletion) also need the durable outbox.
    // Rebuild once so source IDs remain logical references rather than a claim-only FK.
    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE realtime_outbox RENAME TO realtime_outbox_claim_only;
        CREATE TABLE realtime_outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          world_id TEXT NOT NULL REFERENCES game_worlds(id) ON DELETE CASCADE,
          region_id TEXT NOT NULL,
          previous_version INTEGER NOT NULL,
          version INTEGER NOT NULL,
          claim_event_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          dispatched_at TEXT,
          CHECK (version = previous_version + 1)
        );
        INSERT INTO realtime_outbox
          (sequence, event_id, world_id, region_id, previous_version, version, claim_event_id, payload_json, created_at, dispatched_at)
        SELECT sequence, event_id, world_id, region_id, previous_version, version, claim_event_id, payload_json, created_at, dispatched_at
        FROM realtime_outbox_claim_only;
        DROP TABLE realtime_outbox_claim_only;
        CREATE INDEX idx_realtime_outbox_region ON realtime_outbox(world_id, region_id, sequence);
        COMMIT;
      `);
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* no active migration transaction */ }
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_source_dedupe
      ON notifications(user_id, source_event_id, type)
      WHERE source_event_id IS NOT NULL;
  `);
}
