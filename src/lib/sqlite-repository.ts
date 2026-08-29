import "server-only";

import { randomUUID } from "node:crypto";
import turfArea from "@turf/area";
import { feature } from "@turf/helpers";
import { CONNECTION_PAGE_LIMITS, CONTENT_LIMITS, MEDIA_LIMITS, POST_PAGE_LIMITS } from "@/lib/content-limits";
import { findActivePasswordResetUserId, findActiveSessionUserId, removeExpiredSessions, removeUnavailablePasswordResetTokens } from "@/lib/auth-expiry-store";
import { database } from "@/lib/database";
import { normalizeMapCamera, type MapCameraState } from "@/lib/map-preview";
import type { AppUser, ConnectionCursor, CurrentTerritory, PlayerSearchResult, PostCursor, PostableTerritory, PublicPlayer, ScopedLeaderboardQuery, StoredTerritory, TerritoryClaimResult, TerritoryMapState, TerritoryPaint, UserListPlayer } from "@/lib/models";
import { updateNotificationActorUsername } from "@/lib/notification-identity-store";
import { insertPostInteractionNotification, listNotificationsFromDatabase } from "@/lib/notification-store";
import { getRouteSessionTotalsFromDatabase, listRouteSessionsFromDatabase, recordRouteSessionInDatabase, type RecordRouteSessionInput } from "@/lib/route-session-store";
import { canViewConnectionList } from "@/lib/social-access";
import { territoryEngine, type TerritoryGeometry } from "@/lib/territory/territory-engine";
import { queryUserStats } from "@/lib/user-stats";
import { normalizeEmail, normalizeUsername } from "@/lib/validation";
import { queryLeaderboardRank } from "@/lib/leaderboard-rank-store";
import { sanitizeImageDataUrl, sanitizeImageDataUrls } from "@/server/http/media-validation";
import { deleteAccountFromDatabase } from "@/lib/account-deletion-store";
import { addPostCommentToDatabase, listPostCommentsFromDatabase } from "@/lib/post-comment-store";
import type { PostCommentCursor } from "@/lib/models";
import { getPostFromDatabase, getPostImageDataFromDatabase, listPostPageFromDatabase, type PostFeedMode } from "@/lib/post-feed-store";
import { getLeaderboardFromDatabase, getScopedLeaderboardFromDatabase, listConnectionPageFromDatabase, searchPlayersFromDatabase } from "@/lib/social-discovery-store";
import { buildUserSearchKey } from "@/lib/user-search";
import { createMutationPayloadHash, findPostIdempotencyReplay, IDEMPOTENCY_KEY_PATTERN } from "@/lib/mutation-idempotency-store";
import { listPostLikeActorsFromDatabase } from "@/lib/post-like-store";
import { userMediaReference } from "@/lib/user-media-reference";
import { UserIdentityConflictError, type UserRow } from "@/lib/repository-contract";

const postImageMimeTypes = new Set(["image/jpeg"] as const);
const mapSnapshotMimeTypes = new Set(["image/jpeg", "image/png"] as const);

export { UserIdentityConflictError } from "@/lib/repository-contract";
export type { UserRow } from "@/lib/repository-contract";

const userIdentityProjection = `
  id, email, username, display_name, password_hash, password_salt, color, pattern,
  country_code, city_id, country, city, bio, birth_date, account_visibility,
  location_visibility, created_at,
  (avatar_data IS NOT NULL) AS user_has_avatar,
  (cover_data IS NOT NULL) AS user_has_cover
`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

export function toPublicUser(row: UserRow): AppUser {
  const hasAvatar = Boolean(row.user_has_avatar ?? row.avatar_data);
  const hasCover = Boolean(row.user_has_cover ?? row.cover_data);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    initials: initials(row.display_name),
    color: row.color,
    pattern: row.pattern,
    countryCode: row.country_code,
    cityId: row.city_id,
    country: row.country,
    city: row.city,
    bio: row.bio,
    birthDate: row.birth_date,
    accountVisibility: row.account_visibility,
    locationVisibility: row.location_visibility,
    avatarData: userMediaReference(row.id, "avatar", hasAvatar),
    coverData: userMediaReference(row.id, "cover", hasCover),
    createdAt: row.created_at,
  };
}

export function toPublicPlayer(row: UserRow): PublicPlayer {
  const user = toPublicUser(row);
  return { id: user.id, username: user.username, displayName: user.displayName, initials: user.initials, color: user.color, pattern: user.pattern, countryCode: user.countryCode, cityId: user.cityId, country: user.country, city: user.city, bio: user.bio, accountVisibility: user.accountVisibility, avatarData: user.avatarData, coverData: user.coverData, createdAt: user.createdAt };
}

export function findUserRowByEmail(email: string) {
  return database.prepare(`SELECT ${userIdentityProjection} FROM users WHERE email = ? COLLATE NOCASE`).get(normalizeEmail(email)) as UserRow | undefined;
}

export function findUserRowByUsername(username: string) {
  return database.prepare(`SELECT ${userIdentityProjection} FROM users WHERE username = ? COLLATE NOCASE`).get(normalizeUsername(username)) as UserRow | undefined;
}

export function findUserRowById(id: string) {
  return database.prepare(`SELECT ${userIdentityProjection} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

function getUserMediaData(userId: string) {
  return database.prepare("SELECT avatar_data, cover_data FROM users WHERE id = ?").get(userId) as {
    avatar_data: string | null;
    cover_data: string | null;
  } | undefined;
}

export function getUserAvatarData(userId: string) {
  return getUserMediaData(userId)?.avatar_data ?? null;
}

export function getUserCoverData(userId: string) {
  return getUserMediaData(userId)?.cover_data ?? null;
}

export function deleteUserAccount(userId: string) {
  return deleteAccountFromDatabase(database, userId);
}

export function createUser(input: {
  email: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  color: string;
  birthDate: string;
  countryCode: string;
  cityId: string;
  country: string;
  city: string;
  legalConsent: { termsVersion: string; privacyVersion: string };
}) {
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);
  database.exec("BEGIN IMMEDIATE");
  try {
    if (findUserRowByEmail(email)) throw new UserIdentityConflictError("email");
    if (findUserRowByUsername(username)) throw new UserIdentityConflictError("username");
    const count = (database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
    database.prepare(`
      INSERT INTO users (id, email, username, display_name, search_key, password_hash, password_salt, color, pattern, birth_date, country_code, city_id, country, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, username, input.displayName, buildUserSearchKey(username, input.displayName), input.passwordHash, input.passwordSalt, input.color, count % 4, input.birthDate, input.countryCode, input.cityId, input.country, input.city);
    database.prepare(`
      INSERT INTO legal_consents (id, user_id, terms_version, privacy_version)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), id, input.legalConsent.termsVersion, input.legalConsent.privacyVersion);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return toPublicUser(findUserRowById(id)!);
}

export function updateUser(userId: string, input: { username?: string; displayName?: string; color?: string; bio?: string; countryCode?: string; cityId?: string; country?: string; city?: string; birthDate?: string; accountVisibility?: AppUser["accountVisibility"]; locationVisibility?: AppUser["locationVisibility"]; avatarData?: string | null; coverData?: string | null }) {
  const current = findUserRowById(userId);
  if (!current) return null;
  const currentMedia = getUserMediaData(userId);
  const username = normalizeUsername(input.username || current.username);
  const displayName = input.displayName?.trim() || current.display_name;
  database.exec("BEGIN IMMEDIATE");
  try {
    const usernameOwner = findUserRowByUsername(username);
    if (usernameOwner && usernameOwner.id !== userId) throw new UserIdentityConflictError("username");
    database.prepare(`
      UPDATE users SET username = ?, display_name = ?, search_key = ?, color = ?, bio = ?, country_code = ?, city_id = ?, country = ?, city = ?, birth_date = ?, account_visibility = ?, location_visibility = ?, avatar_data = ?, cover_data = ? WHERE id = ?
    `).run(
      username,
      displayName,
      buildUserSearchKey(username, displayName),
      input.color || current.color,
      input.bio?.trim().slice(0, CONTENT_LIMITS.bio.max) ?? current.bio,
      input.countryCode || current.country_code,
      input.cityId || current.city_id,
      input.country?.trim().slice(0, 80) || current.country,
      input.city?.trim().slice(0, 80) || current.city,
      input.birthDate || current.birth_date,
      input.accountVisibility || current.account_visibility,
      input.locationVisibility || current.location_visibility,
      input.avatarData === undefined ? currentMedia?.avatar_data ?? null : input.avatarData,
      input.coverData === undefined ? currentMedia?.cover_data ?? null : input.coverData,
      userId,
    );
    if (username !== current.username) {
      updateNotificationActorUsername(database, userId, current.username, username);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return toPublicUser(findUserRowById(userId)!);
}

export function updatePassword(userId: string, passwordHash: string, passwordSalt: string) {
  database.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(passwordHash, passwordSalt, userId);
}

export function createPasswordResetToken(tokenHash: string, userId: string, expiresAt: string) {
  removeUnavailablePasswordResetTokens(database, userId);
  database.prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function resetPasswordWithToken(tokenHash: string, passwordHash: string, passwordSalt: string) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const userId = findActivePasswordResetUserId(database, tokenHash);
    if (!userId) {
      database.exec("ROLLBACK");
      return false;
    }
    database.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(passwordHash, passwordSalt, userId);
    database.prepare("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ?").run(tokenHash);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function createSessionRecord(tokenHash: string, userId: string, expiresAt: string) {
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function deleteSessionRecord(tokenHash: string) {
  database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function findUserBySession(tokenHash: string) {
  removeExpiredSessions(database);
  const userId = findActiveSessionUserId(database, tokenHash);
  const row = userId ? findUserRowById(userId) : null;
  return row ? toPublicUser(row) : null;
}

type TerritoryRow = {
  id: string; user_id: string; name: string; district: string; geojson: string; color: string; pattern: number;
  area_km2: number; newly_added_area_km2: number; overlap_area_km2: number; total_area_after_km2: number;
  distance_km: number; duration_seconds: number; map_snapshot: string | null; active: number; created_at: string;
  owner_username?: string;
};

function toTerritory(row: TerritoryRow): StoredTerritory {
  return {
    id: row.id, userId: row.user_id, ownerUsername: row.owner_username || "oyuncu", name: row.name, district: row.district,
    geojson: JSON.parse(row.geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon, color: row.color, pattern: row.pattern,
    areaKm2: row.area_km2, newlyAddedAreaKm2: row.newly_added_area_km2, overlapAreaKm2: row.overlap_area_km2, totalAreaAfterKm2: row.total_area_after_km2,
    distanceKm: row.distance_km, durationSeconds: row.duration_seconds,
    mapSnapshot: row.map_snapshot, active: Boolean(row.active), createdAt: row.created_at,
  };
}

type TerritoryClaimInput = {
  idempotencyKey: string;
  name: string;
  district: string;
  geojson: GeoJSON.Polygon;
  color: string;
  distanceKm: number;
  durationSeconds: number;
  mapSnapshot: string | null;
};

type CurrentTerritoryRow = {
  user_id: string;
  geojson: string;
  area_m2: number;
  updated_at: string;
  owner_username: string;
  owner_color: string;
  owner_pattern: number;
};

type TerritoryPaintRow = { id: string; user_id: string; geojson: string; color: string; updated_at: string };

function toCurrentTerritory(row: CurrentTerritoryRow): CurrentTerritory {
  return {
    userId: row.user_id,
    ownerUsername: row.owner_username,
    geometry: JSON.parse(row.geojson) as TerritoryGeometry,
    areaM2: row.area_m2,
    color: row.owner_color,
    pattern: row.owner_pattern,
    updatedAt: row.updated_at,
  };
}

function toTerritoryPaint(row: TerritoryPaintRow): TerritoryPaint {
  return { id: row.id, userId: row.user_id, geometry: JSON.parse(row.geojson) as TerritoryGeometry, color: row.color, updatedAt: row.updated_at };
}

export function claimTerritory(user: AppUser, input: TerritoryClaimInput): TerritoryClaimResult {
  const id = randomUUID();
  const paintId = randomUUID();

  database.exec("BEGIN IMMEDIATE");
  try {
    const previousRow = database.prepare(`
      SELECT territories.*, users.username AS owner_username FROM territories
      JOIN users ON users.id = territories.user_id
      WHERE territories.user_id = ? AND territories.idempotency_key = ?
    `).get(user.id, input.idempotencyKey) as TerritoryRow | undefined;
    if (previousRow) {
      const previous = toTerritory(previousRow);
      const current = getCurrentTerritory(user.id);
      if (!current) throw new Error("Idempotent claim territory is missing.");
      database.exec("COMMIT");
      return { claim: previous, currentTerritory: current, newlyAddedAreaM2: previous.newlyAddedAreaKm2 * 1_000_000, overlapAreaM2: previous.overlapAreaKm2 * 1_000_000, totalAreaAfterM2: previous.totalAreaAfterKm2 * 1_000_000 };
    }
    const existingOwn = getCurrentTerritory(user.id);
    const ownership = territoryEngine.calculateUniqueArea(existingOwn?.geometry ?? null, input.geojson);
    const overlapAreaM2 = territoryEngine.calculateOverlap(existingOwn?.geometry ?? null, input.geojson);
    const incomingAreaM2 = turfArea(feature(input.geojson));
    const capturedOwners = new Set<string>();

    for (const enemy of listCurrentTerritories()) {
      if (enemy.userId === user.id) continue;
      const remaining = territoryEngine.applyEnemyCapture(enemy.geometry, input.geojson);
      if (remaining === enemy.geometry) continue;
      capturedOwners.add(enemy.userId);
      if (!remaining) database.prepare("DELETE FROM current_territories WHERE user_id = ?").run(enemy.userId);
      else database.prepare("UPDATE current_territories SET geojson = ?, area_m2 = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?")
        .run(JSON.stringify(remaining), turfArea(feature(remaining)), enemy.userId);
    }

    for (const paint of listTerritoryPaints()) {
      const remaining = territoryEngine.subtractPaint(paint.geometry, input.geojson);
      if (remaining === paint.geometry) continue;
      if (!remaining) database.prepare("DELETE FROM territory_paints WHERE id = ?").run(paint.id);
      else database.prepare("UPDATE territory_paints SET geojson = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(remaining), paint.id);
    }

    database.prepare(`
      INSERT INTO current_territories (user_id, geojson, area_m2, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET geojson = excluded.geojson, area_m2 = excluded.area_m2, updated_at = CURRENT_TIMESTAMP
    `).run(user.id, JSON.stringify(ownership.geometry), ownership.afterM2);
    database.prepare("INSERT INTO territory_paints (id, user_id, geojson, color) VALUES (?, ?, ?, ?)")
      .run(paintId, user.id, JSON.stringify(input.geojson), input.color);
    database.prepare(`
      INSERT INTO territories (
        id, user_id, idempotency_key, name, district, geojson, color, pattern, area_km2,
        newly_added_area_km2, overlap_area_km2, total_area_after_km2,
        distance_km, duration_seconds, map_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, user.id, input.idempotencyKey, input.name, input.district, JSON.stringify(input.geojson), input.color, user.pattern,
      incomingAreaM2 / 1_000_000, ownership.newlyAddedAreaM2 / 1_000_000, overlapAreaM2 / 1_000_000, ownership.afterM2 / 1_000_000,
      input.distanceKm, input.durationSeconds, input.mapSnapshot,
    );
    database.prepare("UPDATE users SET color = ? WHERE id = ?").run(input.color, user.id);
    database.prepare("UPDATE world_state SET version = version + 1 WHERE id = 1").run();
    database.prepare("INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id) VALUES (?, ?, 'territory', ?, ?, 'territory', ?)")
      .run(randomUUID(), user.id, capturedOwners.size ? "Alan ele geçirme tamamlandı" : "Alan güncellendi", `${input.name} · +${(ownership.newlyAddedAreaM2 / 1_000_000).toFixed(4)} km² benzersiz alan`, id);
    for (const ownerId of capturedOwners) database.prepare("INSERT INTO notifications (id, user_id, actor_id, type, title, body, resource_type, resource_id) VALUES (?, ?, ?, 'territory', 'Alan sınırın değişti', ?, 'territory', ?)")
      .run(randomUUID(), ownerId, user.id, `@${user.username} alanının bir bölümünü ele geçirdi.`, id);
    database.exec("COMMIT");

    return {
      claim: getTerritory(id)!,
      currentTerritory: getCurrentTerritory(user.id)!,
      newlyAddedAreaM2: ownership.newlyAddedAreaM2,
      overlapAreaM2,
      totalAreaAfterM2: ownership.afterM2,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getCurrentTerritory(userId: string) {
  const row = database.prepare(`
    SELECT current_territories.*, users.username AS owner_username, users.color AS owner_color, users.pattern AS owner_pattern
    FROM current_territories JOIN users ON users.id = current_territories.user_id
    WHERE current_territories.user_id = ?
  `).get(userId) as CurrentTerritoryRow | undefined;
  return row ? toCurrentTerritory(row) : null;
}

export function listCurrentTerritories() {
  const rows = database.prepare(`
    SELECT current_territories.*, users.username AS owner_username, users.color AS owner_color, users.pattern AS owner_pattern
    FROM current_territories JOIN users ON users.id = current_territories.user_id
    ORDER BY current_territories.updated_at ASC
  `).all() as CurrentTerritoryRow[];
  return rows.map(toCurrentTerritory);
}

export function listTerritoryPaints() {
  return (database.prepare("SELECT * FROM territory_paints ORDER BY updated_at ASC, id ASC").all() as TerritoryPaintRow[]).map(toTerritoryPaint);
}

export function getTerritoryMapState(): TerritoryMapState {
  return { territories: listCurrentTerritories(), paints: listTerritoryPaints() };
}

export function getWorldVersion() {
  return (database.prepare("SELECT version FROM world_state WHERE id = 1").get() as { version: number }).version;
}

export function getTerritory(id: string) {
  const row = database.prepare(`
    SELECT territories.*, users.username AS owner_username
    FROM territories JOIN users ON users.id = territories.user_id
    WHERE territories.id = ?
  `).get(id) as TerritoryRow | undefined;
  return row ? toTerritory(row) : null;
}

export function recordRouteSession(userId: string, input: RecordRouteSessionInput) {
  return recordRouteSessionInDatabase(database, userId, input);
}

export function listRouteSessions(userId: string, limit = 20) {
  return listRouteSessionsFromDatabase(database, userId, limit);
}

export function getRouteSessionTotals(userId: string) {
  return getRouteSessionTotalsFromDatabase(database, userId);
}

export function listTerritories(userId?: string) {
  const rows = userId
    ? database.prepare(`
        SELECT territories.*, users.username AS owner_username
        FROM territories JOIN users ON users.id = territories.user_id
        WHERE territories.user_id = ? AND territories.active = 1 ORDER BY territories.created_at DESC
      `).all(userId)
    : database.prepare(`
        SELECT territories.*, users.username AS owner_username
        FROM territories JOIN users ON users.id = territories.user_id
        WHERE territories.active = 1 ORDER BY territories.created_at DESC
      `).all();
  return (rows as TerritoryRow[]).map(toTerritory);
}

export function listPostableTerritories(userId: string, limit = 30): PostableTerritory[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Paylaşılabilir alan limiti 1–50 arasında olmalı.");
  const rows = database.prepare(`
    SELECT
      territories.id, territories.user_id, territories.name, territories.district, territories.geojson,
      territories.color, territories.pattern, territories.area_km2, territories.newly_added_area_km2,
      territories.overlap_area_km2, territories.total_area_after_km2, territories.distance_km,
      territories.duration_seconds, NULL AS map_snapshot, territories.active, territories.created_at,
      users.username AS owner_username
    FROM territories
    JOIN users ON users.id = territories.user_id
    WHERE territories.user_id = ? AND territories.active = 1
    ORDER BY territories.created_at DESC, territories.id DESC
    LIMIT ?
  `).all(userId, limit) as TerritoryRow[];
  return rows.map((row) => {
    const territory = toTerritory(row);
    return {
      id: territory.id,
      userId: territory.userId,
      ownerUsername: territory.ownerUsername,
      name: territory.name,
      district: territory.district,
      geojson: territory.geojson,
      color: territory.color,
      pattern: territory.pattern,
      areaKm2: territory.areaKm2,
      newlyAddedAreaKm2: territory.newlyAddedAreaKm2,
      overlapAreaKm2: territory.overlapAreaKm2,
      totalAreaAfterKm2: territory.totalAreaAfterKm2,
      distanceKm: territory.distanceKm,
      durationSeconds: territory.durationSeconds,
      active: territory.active,
      createdAt: territory.createdAt,
    };
  });
}

export function listTerritoryArchive(userId: string) {
  const rows = database.prepare(`
    SELECT territories.*, users.username AS owner_username
    FROM territories JOIN users ON users.id = territories.user_id
    WHERE territories.user_id = ? ORDER BY territories.created_at DESC
  `).all(userId) as TerritoryRow[];
  return rows.map(toTerritory);
}

type PostPageOptions = { cursor?: PostCursor | null; limit?: number };

export function listPostPage(userId: string, mode: Exclude<PostFeedMode, "saved" | "user">, options: PostPageOptions = {}) {
  return listPostPageFromDatabase(database, {
    viewerId: userId,
    mode,
    cursor: options.cursor ?? null,
    limit: options.limit ?? POST_PAGE_LIMITS.default,
  });
}

export function listSavedPostPage(userId: string, options: PostPageOptions = {}) {
  return listPostPageFromDatabase(database, {
    viewerId: userId,
    mode: "saved",
    cursor: options.cursor ?? null,
    limit: options.limit ?? POST_PAGE_LIMITS.default,
  });
}

export function listUserPostPage(viewerId: string, ownerId: string, options: PostPageOptions = {}) {
  return listPostPageFromDatabase(database, {
    viewerId,
    ownerId,
    mode: "user",
    cursor: options.cursor ?? null,
    limit: options.limit ?? POST_PAGE_LIMITS.default,
  });
}

/** @deprecated Yeni akışlarda cursor bilgisi için listPostPage kullan. */
export function listPosts(userId: string, mode: "following" | "explore" | "mine") {
  return listPostPage(userId, mode).posts;
}

/** @deprecated Yeni akışlarda cursor bilgisi için listUserPostPage kullan. */
export function listUserPosts(viewerId: string, ownerId: string) {
  return listUserPostPage(viewerId, ownerId).posts;
}

/** @deprecated Yeni akışlarda cursor bilgisi için listSavedPostPage kullan. */
export function listSavedPosts(userId: string) {
  return listSavedPostPage(userId).posts;
}

export function createPostRecord(userId: string, input: { territoryId: string; title: string; body: string; images?: string[]; mapSnapshot?: string | null; mapView?: MapCameraState | null; idempotencyKey?: string }) {
  const territory = getTerritory(input.territoryId);
  if (!territory || territory.userId !== userId) return null;
  const title = input.title.trim();
  const body = input.body.trim();
  const rawImages = input.images ?? [];
  const mapView = input.mapView ? normalizeMapCamera(input.mapView) : null;
  if (input.mapView && !mapView) throw new RangeError("Harita kadrajı geçersiz.");
  if (title.length < CONTENT_LIMITS.postTitle.min || title.length > CONTENT_LIMITS.postTitle.max) throw new RangeError("Gönderi başlığı sınır dışında.");
  if (body.length > CONTENT_LIMITS.postBody.max) throw new RangeError("Gönderi metni sınır dışında.");
  const images = sanitizeImageDataUrls(rawImages, { allowedMimeTypes: postImageMimeTypes, ...MEDIA_LIMITS.postImages });
  if (!images) throw new RangeError("Gönderi fotoğrafları geçersiz.");
  const mapSnapshot = input.mapSnapshot
    ? sanitizeImageDataUrl(input.mapSnapshot, { allowedMimeTypes: mapSnapshotMimeTypes, maxDataUrlLength: MEDIA_LIMITS.postMapSnapshot.maxDataUrlLength })
    : null;
  if (input.mapSnapshot && !mapSnapshot) throw new RangeError("Harita görseli geçersiz.");
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new RangeError("Gönderim anahtarı geçersiz.");
  const payloadHash = idempotencyKey
    ? createMutationPayloadHash({ territoryId: input.territoryId, title, body, images, mapSnapshot, mapView })
    : null;
  const id = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (idempotencyKey && payloadHash) {
      const replayId = findPostIdempotencyReplay(database, userId, idempotencyKey, payloadHash);
      if (replayId) {
        database.exec("COMMIT");
        return replayId;
      }
    }
    database.prepare("INSERT INTO posts (id, user_id, territory_id, title, body, image_data, map_snapshot, map_view_json, idempotency_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, input.territoryId, title, body, images[0] ?? null, mapSnapshot ?? territory.mapSnapshot, mapView ? JSON.stringify(mapView) : null, idempotencyKey, payloadHash);
    const insertImage = database.prepare("INSERT INTO post_images (id, post_id, image_data, sort_order) VALUES (?, ?, ?, ?)");
    images.forEach((image, index) => insertImage.run(randomUUID(), id, image, index));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return id;
}

export function getPostForViewer(viewerId: string, postId: string) {
  if (!canViewPost(viewerId, postId)) return null;
  return getPostFromDatabase(database, viewerId, postId);
}

export function getPostImageForViewer(viewerId: string, postId: string, index: number) {
  if (!canViewPost(viewerId, postId)) return null;
  return getPostImageDataFromDatabase(database, postId, index);
}

export function canViewPost(viewerId: string, postId: string) {
  const post = database.prepare(`
    SELECT posts.user_id, users.account_visibility,
      EXISTS(SELECT 1 FROM follows WHERE follows.follower_id = ? AND follows.followed_id = posts.user_id) AS is_following
    FROM posts JOIN users ON users.id = posts.user_id WHERE posts.id = ?
  `).get(viewerId, postId) as { user_id: string; account_visibility: AppUser["accountVisibility"]; is_following: number } | undefined;
  return Boolean(post && (post.user_id === viewerId || post.account_visibility === "public" || post.is_following));
}

export function setLikeState(userId: string, postId: string, desired: boolean) {
  if (!canViewPost(userId, postId)) return null;
  database.exec("BEGIN IMMEDIATE");
  try {
    const exists = Boolean(database.prepare("SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?").get(userId, postId));
    if (!desired && exists) database.prepare("DELETE FROM likes WHERE user_id = ? AND post_id = ?").run(userId, postId);
    else if (desired && !exists) {
      const inserted = database.prepare("INSERT OR IGNORE INTO likes (user_id, post_id) VALUES (?, ?)").run(userId, postId);
      const post = database.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId) as { user_id: string } | undefined;
      if (inserted.changes && post) insertPostInteractionNotification(database, { recipientId: post.user_id, actorId: userId, postId, type: "post_like" });
    }
    const count = (database.prepare("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?").get(postId) as { count: number }).count;
    database.exec("COMMIT");
    return { liked: desired, count };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listPostLikers(viewerId: string, postId: string) {
  if (!canViewPost(viewerId, postId)) return null;
  const users = listPostLikeActorsFromDatabase(database, postId);
  const total = (database.prepare("SELECT COUNT(*) AS count FROM likes WHERE post_id = ?").get(postId) as { count: number }).count;
  return { users, total };
}

export function setSaveState(userId: string, postId: string, desired: boolean) {
  if (!canViewPost(userId, postId)) return null;
  if (desired) database.prepare("INSERT OR IGNORE INTO saved_posts (user_id, post_id) VALUES (?, ?)").run(userId, postId);
  else database.prepare("DELETE FROM saved_posts WHERE user_id = ? AND post_id = ?").run(userId, postId);
  return { saved: desired };
}

export function listPostComments(userId: string, postId: string, options: { cursor: PostCommentCursor | null; limit: number }) {
  if (!canViewPost(userId, postId)) return null;
  return listPostCommentsFromDatabase(database, postId, options);
}

export function addComment(userId: string, postId: string, body: string, idempotencyKey?: string) {
  if (!canViewPost(userId, postId)) return null;
  const post = database.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId) as { user_id: string } | undefined;
  return addPostCommentToDatabase(database, userId, postId, body, idempotencyKey, () => {
    if (post) insertPostInteractionNotification(database, { recipientId: post.user_id, actorId: userId, postId, type: "post_comment" });
  });
}

export function getFollowRelation(viewerId: string, targetId: string): "none" | "following" | "requested" {
  if (database.prepare("SELECT 1 FROM follows WHERE follower_id = ? AND followed_id = ?").get(viewerId, targetId)) return "following";
  if (database.prepare("SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?").get(viewerId, targetId)) return "requested";
  return "none";
}

export function setFollowState(followerId: string, followedId: string, desired: boolean) {
  if (followerId === followedId) return { status: "none" as const };
  database.exec("BEGIN IMMEDIATE");
  try {
    const target = findUserRowById(followedId);
    if (!target) {
      database.exec("ROLLBACK");
      return null;
    }
    const relation = getFollowRelation(followerId, followedId);
    if (!desired) {
      if (relation === "following") database.prepare("DELETE FROM follows WHERE follower_id = ? AND followed_id = ?").run(followerId, followedId);
      if (relation === "requested") database.prepare("DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?").run(followerId, followedId);
      database.exec("COMMIT");
      return { status: "none" as const };
    }
    if (relation !== "none") {
      database.exec("COMMIT");
      return { status: relation };
    }
    const follower = findUserRowById(followerId);
    if (target.account_visibility === "private") {
      const inserted = database.prepare("INSERT OR IGNORE INTO follow_requests (requester_id, target_id) VALUES (?, ?)").run(followerId, followedId);
      if (inserted.changes && follower) database.prepare("INSERT INTO notifications (id, user_id, actor_id, type, title, body) VALUES (?, ?, ?, 'follow_request', ?, ?)").run(randomUUID(), followedId, followerId, "Yeni takip isteği", `@${follower.username} seni takip etmek istiyor.`);
      database.exec("COMMIT");
      return { status: "requested" as const };
    }
    const inserted = database.prepare("INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)").run(followerId, followedId);
    if (inserted.changes && follower) database.prepare("INSERT INTO notifications (id, user_id, actor_id, type, title, body) VALUES (?, ?, ?, 'social', ?, ?)").run(randomUUID(), followedId, followerId, "Yeni takipçin var", `@${follower.username} seni takip etmeye başladı.`);
    database.exec("COMMIT");
    return { status: "following" as const };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listFollowRequests(targetId: string) {
  const rows = database.prepare(`
    SELECT users.id, users.username, users.display_name, users.color, users.pattern,
      users.city, users.account_visibility,
      (users.avatar_data IS NOT NULL) AS user_has_avatar,
      follow_requests.created_at AS requested_at
    FROM follow_requests JOIN users ON users.id = follow_requests.requester_id
    WHERE follow_requests.target_id = ? ORDER BY follow_requests.created_at DESC
    LIMIT ?
  `).all(targetId, CONNECTION_PAGE_LIMITS.max) as Array<{
    id: string;
    username: string;
    display_name: string;
    color: string;
    pattern: number;
    city: string;
    account_visibility: UserListPlayer["accountVisibility"];
    user_has_avatar: number;
    requested_at: string;
  }>;
  return rows.map((row) => ({
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      initials: initials(row.display_name),
      color: row.color,
      pattern: row.pattern,
      city: row.city,
      accountVisibility: row.account_visibility,
      avatarData: row.user_has_avatar ? `/api/users/${encodeURIComponent(row.id)}/avatar` : null,
    } satisfies UserListPlayer,
    requestedAt: row.requested_at,
  }));
}

export function resolveFollowRequest(targetId: string, requesterId: string, action: "accept" | "reject") {
  database.exec("BEGIN IMMEDIATE");
  try {
    const exists = database.prepare("SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?").get(requesterId, targetId);
    if (!exists) {
      database.exec("ROLLBACK");
      return false;
    }
    if (action === "accept") {
      const inserted = database.prepare("INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)").run(requesterId, targetId);
      if (inserted.changes) database.prepare("INSERT INTO notifications (id, user_id, actor_id, type, title, body) VALUES (?, ?, ?, 'social', 'Takip isteğin kabul edildi', 'Artık bu gizli hesabın paylaşımlarını görebilirsin.')").run(randomUUID(), requesterId, targetId);
    }
    database.prepare("DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?").run(requesterId, targetId);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function searchPlayers(viewerId: string, query = ""): PlayerSearchResult[] {
  return searchPlayersFromDatabase(database, viewerId, query);
}

export function getPlayerProfile(username: string, viewerId: string) {
  const row = findUserRowByUsername(username);
  if (!row) return null;
  const relation = row.id === viewerId ? "following" : getFollowRelation(viewerId, row.id);
  return { user: toPublicPlayer(row), relation, canView: row.account_visibility === "public" || row.id === viewerId || relation === "following", stats: getUserStats(row.id) };
}

export function getConnectionListAccess(userId: string, viewerId: string): "allowed" | "forbidden" | "not_found" {
  const owner = findUserRowById(userId);
  if (!owner) return "not_found";
  const viewerFollowsOwner = owner.id !== viewerId && getFollowRelation(viewerId, owner.id) === "following";
  return canViewConnectionList({
    accountVisibility: owner.account_visibility,
    ownerId: owner.id,
    viewerId,
    viewerFollowsOwner,
  }) ? "allowed" : "forbidden";
}

export function listConnectionPage(userId: string, viewerId: string, type: "followers" | "following", options: { cursor: ConnectionCursor | null; limit?: number }) {
  if (getConnectionListAccess(userId, viewerId) !== "allowed") return null;
  return listConnectionPageFromDatabase(database, { userId, viewerId, type, ...options });
}

export function getUserStats(userId: string) {
  return queryUserStats(database, userId);
}

export function getLeaderboard(cityId?: string) {
  return getLeaderboardFromDatabase(database, cityId);
}

export function getScopedLeaderboard(query: ScopedLeaderboardQuery) {
  return getScopedLeaderboardFromDatabase(database, query);
}

export function getLeaderboardRank(userId: string, cityId?: string) {
  return queryLeaderboardRank(database, userId, cityId);
}

export function listNotifications(userId: string) {
  return listNotificationsFromDatabase(database, userId);
}

export function markNotificationsRead(userId: string) {
  database.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").run(userId);
}
