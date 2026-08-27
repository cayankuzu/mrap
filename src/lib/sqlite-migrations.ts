import type { DatabaseSync } from "node:sqlite";
import { CONTENT_LIMITS, DEFAULT_POST_TITLE } from "@/lib/content-limits";
import { buildUserSearchKey } from "@/lib/user-search";

export function ensureLatestSchema(database: DatabaseSync) {
  database.exec(`
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
  `);
  const userColumns = new Set((database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!userColumns.has("location_visibility")) database.exec("ALTER TABLE users ADD COLUMN location_visibility TEXT NOT NULL DEFAULT 'private'");
  if (!userColumns.has("search_key")) database.exec("ALTER TABLE users ADD COLUMN search_key TEXT NOT NULL DEFAULT ''");
  const hasDisplayName = userColumns.has("display_name");
  const users = database.prepare(`SELECT id, username${hasDisplayName ? ", display_name" : ""}, search_key FROM users`).all() as Array<{
    id: string;
    username: string;
    display_name?: string;
    search_key: string;
  }>;
  const updateSearchKey = database.prepare("UPDATE users SET search_key = ? WHERE id = ?");
  for (const user of users) {
    const searchKey = buildUserSearchKey(user.username, user.display_name ?? "");
    if (user.search_key !== searchKey) updateSearchKey.run(searchKey, user.id);
  }
  const postColumns = new Set((database.prepare("PRAGMA table_info(posts)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!postColumns.has("title")) database.exec("ALTER TABLE posts ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  if (!postColumns.has("map_view_json")) database.exec("ALTER TABLE posts ADD COLUMN map_view_json TEXT");
  if (!postColumns.has("idempotency_key")) database.exec("ALTER TABLE posts ADD COLUMN idempotency_key TEXT");
  if (!postColumns.has("payload_hash")) database.exec("ALTER TABLE posts ADD COLUMN payload_hash TEXT");
  if (postColumns.has("created_at")) database.exec("CREATE INDEX IF NOT EXISTS idx_posts_page ON posts(created_at DESC, id DESC)");
  if (postColumns.has("user_id")) database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_user_idempotency
      ON posts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_posts_idempotency_insert
    BEFORE INSERT ON posts
    WHEN (NEW.idempotency_key IS NULL) <> (NEW.payload_hash IS NULL)
      OR (NEW.idempotency_key IS NOT NULL AND length(NEW.idempotency_key) NOT BETWEEN 16 AND 100)
      OR (NEW.payload_hash IS NOT NULL AND length(NEW.payload_hash) <> 64)
    BEGIN
      SELECT RAISE(ABORT, 'invalid post idempotency metadata');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posts_idempotency_update
    BEFORE UPDATE OF idempotency_key, payload_hash ON posts
    WHEN (NEW.idempotency_key IS NULL) <> (NEW.payload_hash IS NULL)
      OR (NEW.idempotency_key IS NOT NULL AND length(NEW.idempotency_key) NOT BETWEEN 16 AND 100)
      OR (NEW.payload_hash IS NOT NULL AND length(NEW.payload_hash) <> 64)
    BEGIN
      SELECT RAISE(ABORT, 'invalid post idempotency metadata');
    END;
  `);
  const notificationTableExists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get());
  if (notificationTableExists) {
    const notificationColumns = new Set((database.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!notificationColumns.has("actor_id")) database.exec("ALTER TABLE notifications ADD COLUMN actor_id TEXT REFERENCES users(id) ON DELETE CASCADE");
    if (!notificationColumns.has("resource_type")) database.exec("ALTER TABLE notifications ADD COLUMN resource_type TEXT");
    if (!notificationColumns.has("resource_id")) database.exec("ALTER TABLE notifications ADD COLUMN resource_id TEXT");
    database.exec(`
      UPDATE notifications
      SET actor_id = (
        SELECT users.id FROM users
        WHERE substr(notifications.body, 1, length('@' || users.username || ' ')) = '@' || users.username || ' '
        LIMIT 1
      )
      WHERE actor_id IS NULL AND substr(notifications.body, 1, 1) = '@';
      CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_resource
        ON notifications(user_id, resource_type, resource_id, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_notifications_resource_insert
      BEFORE INSERT ON notifications
      WHEN (NEW.resource_type IS NULL) <> (NEW.resource_id IS NULL)
        OR (NEW.resource_type IS NOT NULL AND NEW.resource_type NOT IN ('post', 'claim', 'territory'))
        OR (NEW.resource_id IS NOT NULL AND (length(NEW.resource_id) NOT BETWEEN 1 AND 128 OR NEW.resource_id GLOB '*[^A-Za-z0-9_-]*'))
      BEGIN
        SELECT RAISE(ABORT, 'invalid notification resource');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_notifications_resource_update
      BEFORE UPDATE OF resource_type, resource_id ON notifications
      WHEN (NEW.resource_type IS NULL) <> (NEW.resource_id IS NULL)
        OR (NEW.resource_type IS NOT NULL AND NEW.resource_type NOT IN ('post', 'claim', 'territory'))
        OR (NEW.resource_id IS NOT NULL AND (length(NEW.resource_id) NOT BETWEEN 1 AND 128 OR NEW.resource_id GLOB '*[^A-Za-z0-9_-]*'))
      BEGIN
        SELECT RAISE(ABORT, 'invalid notification resource');
      END;
    `);
  }
  const commentTableExists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'comments'").get());
  if (commentTableExists) {
    const commentColumns = new Set((database.prepare("PRAGMA table_info(comments)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!commentColumns.has("idempotency_key")) database.exec("ALTER TABLE comments ADD COLUMN idempotency_key TEXT");
    if (!commentColumns.has("payload_hash")) database.exec("ALTER TABLE comments ADD COLUMN payload_hash TEXT");
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_comments_post_page
        ON comments(post_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_user_post_idempotency
        ON comments(user_id, post_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TRIGGER IF NOT EXISTS trg_comments_idempotency_insert
      BEFORE INSERT ON comments
      WHEN (NEW.idempotency_key IS NULL) <> (NEW.payload_hash IS NULL)
        OR (NEW.idempotency_key IS NOT NULL AND length(NEW.idempotency_key) NOT BETWEEN 16 AND 100)
        OR (NEW.payload_hash IS NOT NULL AND length(NEW.payload_hash) <> 64)
      BEGIN
        SELECT RAISE(ABORT, 'invalid comment idempotency metadata');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_comments_idempotency_update
      BEFORE UPDATE OF idempotency_key, payload_hash ON comments
      WHEN (NEW.idempotency_key IS NULL) <> (NEW.payload_hash IS NULL)
        OR (NEW.idempotency_key IS NOT NULL AND length(NEW.idempotency_key) NOT BETWEEN 16 AND 100)
        OR (NEW.payload_hash IS NOT NULL AND length(NEW.payload_hash) <> 64)
      BEGIN
        SELECT RAISE(ABORT, 'invalid comment idempotency metadata');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_comments_content_insert
      BEFORE INSERT ON comments
      WHEN length(trim(NEW.body)) < ${CONTENT_LIMITS.commentBody.min}
        OR length(NEW.body) > ${CONTENT_LIMITS.commentBody.max}
      BEGIN
        SELECT RAISE(ABORT, 'invalid comment content length');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_comments_content_update
      BEFORE UPDATE OF body ON comments
      WHEN length(trim(NEW.body)) < ${CONTENT_LIMITS.commentBody.min}
        OR length(NEW.body) > ${CONTENT_LIMITS.commentBody.max}
      BEGIN
        SELECT RAISE(ABORT, 'invalid comment content length');
      END;
    `);
  }
  database.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_route_sessions_user_ended
      ON route_sessions(user_id, ended_at DESC);
    UPDATE posts
    SET title = CASE
      WHEN length(trim(body)) > 0 THEN substr(trim(body), 1, ${CONTENT_LIMITS.postTitle.max})
      ELSE '${DEFAULT_POST_TITLE}'
    END
    WHERE length(trim(title)) = 0;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase ON users(email COLLATE NOCASE);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_users_search_key ON users(search_key, id);

    UPDATE users SET location_visibility = 'private' WHERE location_visibility <> 'private';

    CREATE TRIGGER IF NOT EXISTS trg_users_location_visibility_insert
    BEFORE INSERT ON users
    WHEN NEW.location_visibility <> 'private'
    BEGIN
      SELECT RAISE(ABORT, 'location visibility must remain private');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_location_visibility_update
    BEFORE UPDATE OF location_visibility ON users
    WHEN NEW.location_visibility <> 'private'
    BEGIN
      SELECT RAISE(ABORT, 'location visibility must remain private');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_identity_insert
    BEFORE INSERT ON users
    WHEN length(NEW.username) < ${CONTENT_LIMITS.username.min}
      OR length(NEW.username) > ${CONTENT_LIMITS.username.max}
      OR length(NEW.email) > ${CONTENT_LIMITS.email.max}
    BEGIN
      SELECT RAISE(ABORT, 'invalid user identity length');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_users_identity_update
    BEFORE UPDATE OF username, email ON users
    WHEN length(NEW.username) < ${CONTENT_LIMITS.username.min}
      OR length(NEW.username) > ${CONTENT_LIMITS.username.max}
      OR length(NEW.email) > ${CONTENT_LIMITS.email.max}
    BEGIN
      SELECT RAISE(ABORT, 'invalid user identity length');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posts_content_insert
    BEFORE INSERT ON posts
    WHEN length(trim(NEW.title)) < ${CONTENT_LIMITS.postTitle.min}
      OR length(NEW.title) > ${CONTENT_LIMITS.postTitle.max}
      OR length(NEW.body) > ${CONTENT_LIMITS.postBody.max}
    BEGIN
      SELECT RAISE(ABORT, 'invalid post content length');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posts_content_update
    BEFORE UPDATE OF title, body ON posts
    WHEN length(trim(NEW.title)) < ${CONTENT_LIMITS.postTitle.min}
      OR length(NEW.title) > ${CONTENT_LIMITS.postTitle.max}
      OR length(NEW.body) > ${CONTENT_LIMITS.postBody.max}
    BEGIN
      SELECT RAISE(ABORT, 'invalid post content length');
    END;
  `);
}
