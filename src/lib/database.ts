import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensureLatestSchema } from "@/lib/sqlite-migrations";
import { ensureAuthoritativeGameSchema } from "@/server/game/schema";

const dataProvider = process.env.MRAP_DATA_PROVIDER ?? "sqlite";

if (process.env.VERCEL === "1" && dataProvider === "sqlite") {
  throw new Error(
    "MRAP_DATA_PROVIDER=sqlite Vercel'de kullanılamaz. Kalıcı ve ortak dünya için Supabase/PostGIS adapter'ini yapılandırın.",
  );
}

if (dataProvider !== "sqlite") {
  throw new Error(
    `MRAP_DATA_PROVIDER=${dataProvider} seçildi ancak production data adapter'i henüz bağlanmadı. SQLite'a sessiz fallback yapılmadı.`,
  );
}

const globalDatabase = globalThis as typeof globalThis & {
  mrapDatabase?: DatabaseSync;
};

function createDatabase() {
  const configuredFilename = process.env.MRAP_SQLITE_FILENAME?.trim() || "mrap.sqlite";
  if (
    configuredFilename === "." ||
    configuredFilename === ".." ||
    configuredFilename !== path.basename(configuredFilename)
  ) {
    throw new Error("MRAP_SQLITE_FILENAME yalnızca bir dosya adı olabilir; SQLite verisi data/ dizininde tutulur.");
  }

  const databasePath = path.join(process.cwd(), "data", configuredFilename);
  const dataDirectory = path.dirname(databasePath);
  mkdirSync(dataDirectory, { recursive: true });
  const database = new DatabaseSync(databasePath);

  // Next.js build/dev workers can initialize the local adapter concurrently.
  // Wait for the schema writer instead of failing immediately with SQLITE_BUSY.
  database.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
  const journalMode = database.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  if (journalMode.journal_mode.toLowerCase() !== "wal") database.exec("PRAGMA journal_mode = WAL;");

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      search_key TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0D8BFF',
      pattern INTEGER NOT NULL DEFAULT 0,
      country_code TEXT NOT NULL DEFAULT 'TR',
      city_id TEXT NOT NULL DEFAULT 'tr-istanbul',
      country TEXT NOT NULL DEFAULT 'Türkiye',
      city TEXT NOT NULL DEFAULT 'İstanbul',
      bio TEXT NOT NULL DEFAULT '',
      birth_date TEXT NOT NULL DEFAULT '2000-01-01',
      account_visibility TEXT NOT NULL DEFAULT 'public',
      location_visibility TEXT NOT NULL DEFAULT 'private',
      avatar_data TEXT,
      cover_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS legal_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 40),
      privacy_version TEXT NOT NULL CHECK (length(privacy_version) BETWEEN 1 AND 40),
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, terms_version, privacy_version)
    );

    CREATE TABLE IF NOT EXISTS api_rate_limits (
      scope_hash TEXT PRIMARY KEY CHECK (length(scope_hash) = 64),
      hit_count INTEGER NOT NULL CHECK (hit_count >= 1),
      reset_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(reset_at_ms);

    CREATE TABLE IF NOT EXISTS territories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT,
      name TEXT NOT NULL,
      district TEXT NOT NULL,
      geojson TEXT NOT NULL,
      color TEXT NOT NULL,
      pattern INTEGER NOT NULL DEFAULT 0,
      area_km2 REAL NOT NULL,
      newly_added_area_km2 REAL NOT NULL DEFAULT 0,
      overlap_area_km2 REAL NOT NULL DEFAULT 0,
      total_area_after_km2 REAL NOT NULL DEFAULT 0,
      distance_km REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      map_snapshot TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS route_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      location_mode TEXT NOT NULL CHECK (location_mode IN ('real', 'simulation')),
      distance_m REAL NOT NULL CHECK (distance_m >= 0 AND distance_m <= 250000),
      duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0 AND duration_seconds <= 86400),
      point_count INTEGER NOT NULL CHECK (point_count >= 1 AND point_count <= 10000),
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, idempotency_key),
      CHECK (length(idempotency_key) BETWEEN 16 AND 100),
      CHECK (started_at <= ended_at)
    );

    CREATE TABLE IF NOT EXISTS current_territories (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      geojson TEXT NOT NULL,
      area_m2 REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS territory_paints (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      geojson TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      territory_id TEXT NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      image_data TEXT,
      map_snapshot TEXT,
      map_view_json TEXT,
      idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 100),
      payload_hash TEXT CHECK (payload_hash IS NULL OR length(payload_hash) = 64),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_images (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, sort_order)
    );

    CREATE TABLE IF NOT EXISTS saved_posts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, followed_id)
    );

    CREATE TABLE IF NOT EXISTS follow_requests (
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (requester_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 16 AND 100),
      payload_hash TEXT CHECK (payload_hash IS NULL OR length(payload_hash) = 64),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      resource_type TEXT CHECK (resource_type IS NULL OR resource_type IN ('post', 'claim', 'territory')),
      resource_id TEXT CHECK (resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 128),
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((resource_type IS NULL) = (resource_id IS NULL))
    );

    CREATE TABLE IF NOT EXISTS world_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO world_state (id, version) VALUES (1, 0);

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_territories_user ON territories(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_route_sessions_user_ended ON route_sessions(user_id, ended_at DESC);
    CREATE INDEX IF NOT EXISTS idx_territory_paints_user ON territory_paints(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_page ON posts(created_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_user_idempotency
      ON posts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images(post_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_page ON comments(post_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_user_post_idempotency
      ON comments(user_id, post_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_resource ON notifications(user_id, resource_type, resource_id, created_at DESC);
  `);

  const userColumns = new Set((database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!userColumns.has("country_code")) database.exec("ALTER TABLE users ADD COLUMN country_code TEXT NOT NULL DEFAULT 'TR'");
  if (!userColumns.has("city_id")) database.exec("ALTER TABLE users ADD COLUMN city_id TEXT NOT NULL DEFAULT 'tr-istanbul'");
  if (!userColumns.has("country")) database.exec("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT 'Türkiye'");
  if (!userColumns.has("birth_date")) database.exec("ALTER TABLE users ADD COLUMN birth_date TEXT NOT NULL DEFAULT '2000-01-01'");
  if (!userColumns.has("account_visibility")) database.exec("ALTER TABLE users ADD COLUMN account_visibility TEXT NOT NULL DEFAULT 'public'");
  if (!userColumns.has("location_visibility")) database.exec("ALTER TABLE users ADD COLUMN location_visibility TEXT NOT NULL DEFAULT 'private'");
  if (!userColumns.has("avatar_data")) database.exec("ALTER TABLE users ADD COLUMN avatar_data TEXT");
  if (!userColumns.has("cover_data")) database.exec("ALTER TABLE users ADD COLUMN cover_data TEXT");
  const territoryColumns = new Set((database.prepare("PRAGMA table_info(territories)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!territoryColumns.has("idempotency_key")) database.exec("ALTER TABLE territories ADD COLUMN idempotency_key TEXT");
  if (!territoryColumns.has("active")) database.exec("ALTER TABLE territories ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  if (!territoryColumns.has("newly_added_area_km2")) database.exec("ALTER TABLE territories ADD COLUMN newly_added_area_km2 REAL NOT NULL DEFAULT 0");
  if (!territoryColumns.has("overlap_area_km2")) database.exec("ALTER TABLE territories ADD COLUMN overlap_area_km2 REAL NOT NULL DEFAULT 0");
  if (!territoryColumns.has("total_area_after_km2")) database.exec("ALTER TABLE territories ADD COLUMN total_area_after_km2 REAL NOT NULL DEFAULT 0");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_territories_idempotency ON territories(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS follow_requests (
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (requester_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS current_territories (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      geojson TEXT NOT NULL,
      area_m2 REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS territory_paints (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      geojson TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_territory_paints_user ON territory_paints(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS post_images (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(post_id, sort_order)
    );
    CREATE TABLE IF NOT EXISTS saved_posts (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_images_post ON post_images(post_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
  `);

  return database;
}

export const database = globalDatabase.mrapDatabase ?? createDatabase();

ensureLatestSchema(database);
ensureAuthoritativeGameSchema(database);

if (process.env.NODE_ENV !== "production") {
  globalDatabase.mrapDatabase = database;
}
