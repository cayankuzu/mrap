import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { MultiPolygon, Polygon } from "geojson";
import { CONNECTION_PAGE_LIMITS, CONTENT_LIMITS, LEADERBOARD_LIMIT, MEDIA_LIMITS, PLAYER_SEARCH_LIMITS, POST_PAGE_LIMITS } from "@/lib/content-limits";
import { encodeCommentCursor } from "@/lib/comment-cursor";
import { encodeConnectionCursor } from "@/lib/connection-cursor";
import { normalizeMapCamera, type MapCameraState } from "@/lib/map-preview";
import type {
  AddPostCommentResult,
  AppUser,
  ConnectionCursor,
  ConnectionPage,
  CurrentTerritory,
  LeaderboardEntry,
  PlayerSearchResult,
  PostComment,
  PostCommentCursor,
  PostCommentPage,
  PostCursor,
  PostPage,
  PostableTerritory,
  PublicPlayer,
  RealPost,
  RouteSession,
  SocialConnection,
  StoredTerritory,
  TerritoryClaimResult,
  TerritoryMapState,
  TerritoryPaint,
  UserListPlayer,
} from "@/lib/models";
import { createMutationPayloadHash, IDEMPOTENCY_KEY_PATTERN, IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";
import { notificationHref } from "@/lib/notification-presentation";
import { encodePostCursor } from "@/lib/post-cursor";
import { UserIdentityConflictError, type UserRow } from "@/lib/repository-contract";
import type { RecordRouteSessionInput } from "@/lib/route-session-store";
import { canViewConnectionList } from "@/lib/social-access";
import { createMrapSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { ensureSupabaseLocationCatalog } from "@/lib/supabase/location-catalog";
import { resolveSupabaseMediaBucket } from "@/lib/supabase/server-config";
import { normalizeEmail, normalizeUsername } from "@/lib/validation";
import { escapeSqlLike, normalizeUserSearchText } from "@/lib/user-search";
import { userMediaReference } from "@/lib/user-media-reference";
import { PROFILE_IMAGE_DATA_URL_MAX_LENGTH } from "@/server/http/api-security";
import { decodeSanitizedImageDataUrl, sanitizeImageDataUrl, sanitizeImageDataUrls } from "@/server/http/media-validation";

const MEDIA_BUCKET = resolveSupabaseMediaBucket();
const PRODUCTION_WORLD_SLUG = "world-main";
const postImageMimeTypes = new Set(["image/jpeg"] as const);
const mapSnapshotMimeTypes = new Set(["image/jpeg", "image/png"] as const);
const profileImageMimeTypes = new Set(["image/jpeg"] as const);
const SUPABASE_PAGE_SIZE = 1_000;
const SUPABASE_IN_FILTER_CHUNK = 200;

type JsonObject = Record<string, unknown>;
type Geometry = Polygon | MultiPolygon;

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  country_code: string;
  city_id: string;
  bio: string;
  color: string;
  pattern: number;
  account_visibility: AppUser["accountVisibility"];
  avatar_object_key: string | null;
  cover_object_key: string | null;
  created_at: string;
};

type PrivateProfileRow = {
  user_id: string;
  birth_date: string;
  location_visibility: AppUser["locationVisibility"];
};

type ClaimEventRow = {
  id: string;
  user_id: string;
  route_session_id: string;
  raw_polygon: unknown;
  newly_claimed_area_m2: number | string;
  already_owned_area_m2: number | string;
  total_loop_area_m2: number | string;
  final_territory_area_m2: number | string;
  selected_color_id: string;
  committed_at_server: string;
};

type RouteSessionRow = {
  id: string;
  player_id: string;
  location_mode: "real_gps" | "development_simulation";
  distance_m: number | string;
  duration_seconds: number;
  point_count: number;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("tr-TR")).join("");
}

function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function geometry(value: unknown): Geometry {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object") throw new Error("Supabase geometry verisi geçersiz.");
  const candidate = parsed as { type?: unknown; coordinates?: unknown };
  if ((candidate.type !== "Polygon" && candidate.type !== "MultiPolygon") || !Array.isArray(candidate.coordinates)) {
    throw new Error("Supabase geometry türü desteklenmiyor.");
  }
  return candidate as Geometry;
}

function sanitizedStorageError(context: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  return new Error(`${context} tamamlanamadı (${code}).`);
}

function assertNoError(error: unknown, context: string) {
  if (error) throw sanitizedStorageError(context, error);
}

function publicPlayer(row: UserRow): PublicPlayer {
  const user = toPublicUser(row);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    initials: user.initials,
    color: user.color,
    pattern: user.pattern,
    countryCode: user.countryCode,
    cityId: user.cityId,
    country: user.country,
    city: user.city,
    bio: user.bio,
    accountVisibility: user.accountVisibility,
    avatarData: user.avatarData,
    coverData: user.coverData,
    createdAt: user.createdAt,
  };
}

function compactPlayer(row: UserRow): UserListPlayer {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    initials: initials(row.display_name),
    color: row.color,
    pattern: row.pattern,
    city: row.city,
    accountVisibility: row.account_visibility,
    avatarData: userMediaReference(row.id, "avatar", Boolean(row.avatar_object_key)),
  };
}

async function profileLocation(profile: ProfileRow) {
  const admin = createMrapSupabaseAdminClient();
  const [countryResult, cityResult] = await Promise.all([
    admin.from("countries").select("name_tr").eq("code", profile.country_code).maybeSingle(),
    admin.from("cities").select("name_tr").eq("id", profile.city_id).maybeSingle(),
  ]);
  assertNoError(countryResult.error, "Ülke okuma");
  assertNoError(cityResult.error, "Şehir okuma");
  return {
    country: String(countryResult.data?.name_tr ?? profile.country_code),
    city: String(cityResult.data?.name_tr ?? profile.city_id),
  };
}

async function hydrateUserRow(userId: string, knownEmail?: string | null): Promise<UserRow | undefined> {
  const admin = createMrapSupabaseAdminClient();
  const [profileResult, privateResult, authResult] = await Promise.all([
    admin.from("profiles").select("id,username,display_name,country_code,city_id,bio,color,pattern,account_visibility,avatar_object_key,cover_object_key,created_at").eq("id", userId).maybeSingle(),
    admin.from("profile_private").select("user_id,birth_date,location_visibility").eq("user_id", userId).maybeSingle(),
    knownEmail === undefined ? admin.auth.admin.getUserById(userId) : Promise.resolve(null),
  ]);
  assertNoError(profileResult.error, "Profil okuma");
  assertNoError(privateResult.error, "Özel profil okuma");
  if (!profileResult.data || !privateResult.data) return undefined;
  if (authResult?.error) throw sanitizedStorageError("Kimlik okuma", authResult.error);
  const profile = profileResult.data as ProfileRow;
  const privateProfile = privateResult.data as PrivateProfileRow;
  const location = await profileLocation(profile);
  return {
    id: profile.id,
    email: normalizeEmail(knownEmail ?? authResult?.data.user.email ?? ""),
    username: profile.username,
    display_name: profile.display_name,
    password_hash: "",
    password_salt: "",
    color: profile.color,
    pattern: profile.pattern,
    country_code: profile.country_code,
    city_id: profile.city_id,
    country: location.country,
    city: location.city,
    bio: profile.bio,
    birth_date: privateProfile.birth_date,
    account_visibility: profile.account_visibility,
    location_visibility: "private",
    user_has_avatar: profile.avatar_object_key ? 1 : 0,
    user_has_cover: profile.cover_object_key ? 1 : 0,
    avatar_object_key: profile.avatar_object_key,
    cover_object_key: profile.cover_object_key,
    created_at: profile.created_at,
  };
}

async function hydratePublicRows(userIds: readonly string[]) {
  const ids = [...new Set(userIds)].filter(Boolean);
  const rows = new Map<string, UserRow>();
  if (!ids.length) return rows;
  const admin = createMrapSupabaseAdminClient();
  const profiles: ProfileRow[] = [];
  for (let index = 0; index < ids.length; index += SUPABASE_IN_FILTER_CHUNK) {
    const { data, error } = await admin.from("profiles")
      .select("id,username,display_name,country_code,city_id,bio,color,pattern,account_visibility,avatar_object_key,cover_object_key,created_at")
      .in("id", ids.slice(index, index + SUPABASE_IN_FILTER_CHUNK));
    assertNoError(error, "Profil listesi okuma");
    profiles.push(...((data ?? []) as ProfileRow[]));
  }
  const cityIds = [...new Set(profiles.map((row) => row.city_id))];
  const countryCodes = [...new Set(profiles.map((row) => row.country_code))];
  const cityRows: Array<{ id: string; name_tr: string }> = [];
  const countryRows: Array<{ code: string; name_tr: string }> = [];
  await Promise.all([
    (async () => {
      for (let index = 0; index < cityIds.length; index += SUPABASE_IN_FILTER_CHUNK) {
        const result = await admin.from("cities").select("id,name_tr")
          .in("id", cityIds.slice(index, index + SUPABASE_IN_FILTER_CHUNK));
        assertNoError(result.error, "Şehir listesi okuma");
        cityRows.push(...((result.data ?? []) as typeof cityRows));
      }
    })(),
    (async () => {
      for (let index = 0; index < countryCodes.length; index += SUPABASE_IN_FILTER_CHUNK) {
        const result = await admin.from("countries").select("code,name_tr")
          .in("code", countryCodes.slice(index, index + SUPABASE_IN_FILTER_CHUNK));
        assertNoError(result.error, "Ülke listesi okuma");
        countryRows.push(...((result.data ?? []) as typeof countryRows));
      }
    })(),
  ]);
  const cities = new Map(cityRows.map((row) => [String(row.id), String(row.name_tr)]));
  const countries = new Map(countryRows.map((row) => [String(row.code), String(row.name_tr)]));
  for (const profile of profiles) {
    rows.set(profile.id, {
      id: profile.id,
      email: "",
      username: profile.username,
      display_name: profile.display_name,
      password_hash: "",
      password_salt: "",
      color: profile.color,
      pattern: profile.pattern,
      country_code: profile.country_code,
      city_id: profile.city_id,
      country: countries.get(profile.country_code) ?? profile.country_code,
      city: cities.get(profile.city_id) ?? profile.city_id,
      bio: profile.bio,
      birth_date: "",
      account_visibility: profile.account_visibility,
      location_visibility: "private",
      user_has_avatar: profile.avatar_object_key ? 1 : 0,
      user_has_cover: profile.cover_object_key ? 1 : 0,
      avatar_object_key: profile.avatar_object_key,
      cover_object_key: profile.cover_object_key,
      created_at: profile.created_at,
    });
  }
  return rows;
}

async function identityUserId(input: { email?: string; username?: string }) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.rpc("mrap_identity_user_id", {
    p_email: input.email ?? null,
    p_username: input.username ?? null,
  });
  assertNoError(error, "Kimlik sorgusu");
  return typeof data === "string" ? data : null;
}

export function toPublicUser(row: UserRow): AppUser {
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
    locationVisibility: "private",
    avatarData: userMediaReference(row.id, "avatar", Boolean(row.avatar_object_key ?? row.user_has_avatar)),
    coverData: userMediaReference(row.id, "cover", Boolean(row.cover_object_key ?? row.user_has_cover)),
    createdAt: row.created_at,
  };
}

export function toPublicPlayer(row: UserRow) {
  return publicPlayer(row);
}

export async function findUserRowByEmail(email: string) {
  const normalized = normalizeEmail(email);
  const id = await identityUserId({ email: normalized });
  return id ? hydrateUserRow(id, normalized) : undefined;
}

export async function findUserRowByUsername(username: string) {
  const id = await identityUserId({ username: normalizeUsername(username) });
  return id ? hydrateUserRow(id) : undefined;
}

export async function findUserRowById(id: string) {
  return hydrateUserRow(id);
}

async function downloadDataUrl(objectKey: string | null | undefined) {
  if (!objectKey) return null;
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).download(objectKey);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return `data:${data.type || "image/jpeg"};base64,${bytes.toString("base64")}`;
}

export async function getUserAvatarData(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("profiles").select("avatar_object_key").eq("id", userId).maybeSingle();
  assertNoError(error, "Profil fotoğrafı okuma");
  return downloadDataUrl(data?.avatar_object_key);
}

export async function getUserCoverData(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("profiles").select("cover_object_key").eq("id", userId).maybeSingle();
  assertNoError(error, "Kapak fotoğrafı okuma");
  return downloadDataUrl(data?.cover_object_key);
}

async function listStorageKeys(prefix: string) {
  const admin = createMrapSupabaseAdminClient();
  const keys: string[] = [];
  const visit = async (path: string): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(path, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      assertNoError(error, "Medya listesi okuma");
      const entries = data ?? [];
      for (const entry of entries) {
        const key = path ? `${path}/${entry.name}` : entry.name;
        if (entry.id) keys.push(key);
        else await visit(key);
      }
      if (entries.length < 100) break;
    }
  };
  await visit(prefix);
  return keys;
}

export async function deleteUserAccount(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const keys = await listStorageKeys(userId);
  for (let index = 0; index < keys.length; index += 100) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(keys.slice(index, index + 100));
    assertNoError(error, "Medya silme");
  }
  const { data, error } = await admin.rpc("mrap_delete_account", { p_user_id: userId });
  assertNoError(error, "Hesap silme");
  return data === true;
}

export async function createUser() {
  throw new Error("Supabase hesapları Supabase Auth kayıt sınırından oluşturulmalı.");
}

async function uploadProfileImage(userId: string, kind: "avatar" | "cover", value: string) {
  const decoded = decodeSanitizedImageDataUrl(value, {
    allowedMimeTypes: profileImageMimeTypes,
    maxDataUrlLength: PROFILE_IMAGE_DATA_URL_MAX_LENGTH,
  });
  if (!decoded) throw new RangeError("Profil görseli geçersiz.");
  const key = `${userId}/profile/${kind}/${randomUUID()}.jpg`;
  const admin = createMrapSupabaseAdminClient();
  const { error } = await admin.storage.from(MEDIA_BUCKET).upload(key, decoded.bytes, {
    contentType: decoded.mimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  assertNoError(error, "Profil görseli yükleme");
  return key;
}

export async function updateUser(userId: string, input: { username?: string; displayName?: string; color?: string; bio?: string; countryCode?: string; cityId?: string; country?: string; city?: string; birthDate?: string; accountVisibility?: AppUser["accountVisibility"]; locationVisibility?: AppUser["locationVisibility"]; avatarData?: string | null; coverData?: string | null }) {
  const current = await hydrateUserRow(userId);
  if (!current) return null;
  if (input.countryCode && input.cityId && input.country && input.city) {
    await ensureSupabaseLocationCatalog({
      countryCode: input.countryCode,
      country: input.country,
      cityId: input.cityId,
      city: input.city,
    });
  }
  const admin = createMrapSupabaseAdminClient();
  const uploaded: string[] = [];
  let uploadedMediaCanBeRemoved = true;
  let avatarKey = current.avatar_object_key ?? null;
  let coverKey = current.cover_object_key ?? null;
  try {
    if (typeof input.avatarData === "string") {
      avatarKey = await uploadProfileImage(userId, "avatar", input.avatarData);
      uploaded.push(avatarKey);
    } else if (input.avatarData === null) avatarKey = null;
    if (typeof input.coverData === "string") {
      coverKey = await uploadProfileImage(userId, "cover", input.coverData);
      uploaded.push(coverKey);
    } else if (input.coverData === null) coverKey = null;

    const username = normalizeUsername(input.username ?? current.username);
    const profileResult = await admin.from("profiles").update({
      username,
      display_name: input.displayName?.trim() ?? current.display_name,
      color: input.color ?? current.color,
      bio: input.bio?.trim().slice(0, CONTENT_LIMITS.bio.max) ?? current.bio,
      country_code: input.countryCode ?? current.country_code,
      city_id: input.cityId ?? current.city_id,
      account_visibility: input.accountVisibility ?? current.account_visibility,
      avatar_object_key: avatarKey,
      cover_object_key: coverKey,
    }).eq("id", userId);
    if (profileResult.error) {
      if (profileResult.error.code === "23505") throw new UserIdentityConflictError("username");
      throw sanitizedStorageError("Profil güncelleme", profileResult.error);
    }
    const privateResult = await admin.from("profile_private").update({
      birth_date: input.birthDate ?? current.birth_date,
      location_visibility: "private",
    }).eq("user_id", userId);
    if (privateResult.error) {
      const rollback = await admin.from("profiles").update({
        username: current.username,
        display_name: current.display_name,
        color: current.color,
        bio: current.bio,
        country_code: current.country_code,
        city_id: current.city_id,
        account_visibility: current.account_visibility,
        avatar_object_key: current.avatar_object_key ?? null,
        cover_object_key: current.cover_object_key ?? null,
      }).eq("id", userId);
      // Compensation may fail after the public row was updated. In that case
      // keep newly referenced media instead of creating broken profile URLs.
      uploadedMediaCanBeRemoved = !rollback.error;
      assertNoError(privateResult.error, "Özel profil güncelleme");
    }
    uploadedMediaCanBeRemoved = false;

    const staleKeys = [current.avatar_object_key, current.cover_object_key]
      .filter((key): key is string => Boolean(key && key !== avatarKey && key !== coverKey));
    if (staleKeys.length) await admin.storage.from(MEDIA_BUCKET).remove(staleKeys);
    const updated = await hydrateUserRow(userId);
    return updated ? toPublicUser(updated) : null;
  } catch (error) {
    if (uploadedMediaCanBeRemoved && uploaded.length) await admin.storage.from(MEDIA_BUCKET).remove(uploaded);
    throw error;
  }
}

export async function updatePassword() {
  throw new Error("Supabase şifreleri yalnız Supabase Auth üzerinden güncellenebilir.");
}

export async function createPasswordResetToken() {
  throw new Error("Supabase parola yenileme akışı Supabase Auth tarafından yönetilir.");
}

export async function resetPasswordWithToken() {
  throw new Error("Supabase parola yenileme akışı Supabase Auth tarafından yönetilir.");
}

export async function createSessionRecord() {
  throw new Error("Supabase oturumları Supabase Auth tarafından yönetilir.");
}

export async function deleteSessionRecord() {
  throw new Error("Supabase oturumları Supabase Auth tarafından yönetilir.");
}

export async function findUserBySession() {
  throw new Error("Supabase oturumları Supabase Auth tarafından yönetilir.");
}

export async function claimTerritory(): Promise<TerritoryClaimResult> {
  throw new Error("Supabase claim işlemi yalnız authoritative game RPC üzerinden yapılabilir.");
}

async function productionWorld() {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("worlds").select("id,current_version").eq("slug", PRODUCTION_WORLD_SLUG).single();
  assertNoError(error, "Oyun dünyası okuma");
  return data as { id: string; current_version: number | string };
}

function cellsToGeometry(cells: Array<{ cell_geometry: unknown }>): Geometry {
  const polygons = cells.flatMap((row) => {
    const parsed = geometry(row.cell_geometry);
    return parsed.type === "Polygon" ? [parsed.coordinates] : parsed.coordinates;
  });
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

async function allOwnedCells() {
  const admin = createMrapSupabaseAdminClient();
  const world = await productionWorld();
  const rows: Array<{ owner_id: string; paint_color_id: string | null; area_m2: number | string; cell_geometry: unknown; updated_at: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("territory_cells")
      .select("owner_id,paint_color_id,area_m2,cell_geometry,updated_at")
      .eq("world_id", world.id)
      .not("owner_id", "is", null)
      .range(from, from + 999);
    assertNoError(error, "Alan hücreleri okuma");
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

export async function getTerritoryMapState(): Promise<TerritoryMapState> {
  const cells = await allOwnedCells();
  const ownerRows = await hydratePublicRows(cells.map((row) => row.owner_id));
  const ownershipGroups = new Map<string, typeof cells>();
  const paintGroups = new Map<string, typeof cells>();
  for (const cell of cells) {
    const owner = ownershipGroups.get(cell.owner_id) ?? [];
    owner.push(cell);
    ownershipGroups.set(cell.owner_id, owner);
    if (cell.paint_color_id) {
      const key = `${cell.owner_id}:${cell.paint_color_id}`;
      const paint = paintGroups.get(key) ?? [];
      paint.push(cell);
      paintGroups.set(key, paint);
    }
  }
  const territories: CurrentTerritory[] = [...ownershipGroups].map(([ownerId, rows]) => {
    const owner = ownerRows.get(ownerId);
    return {
      userId: ownerId,
      ownerUsername: owner?.username ?? "oyuncu",
      geometry: cellsToGeometry(rows),
      areaM2: rows.reduce((sum, row) => sum + numeric(row.area_m2), 0),
      color: owner?.color ?? "#0D8BFF",
      pattern: owner?.pattern ?? 0,
      updatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, rows[0]?.updated_at ?? new Date(0).toISOString()),
    };
  });
  const paints: TerritoryPaint[] = [...paintGroups].map(([key, rows]) => ({
    id: createHash("sha256").update(key).digest("hex").slice(0, 32),
    userId: rows[0].owner_id,
    geometry: cellsToGeometry(rows),
    color: rows[0].paint_color_id ?? "#0D8BFF",
    updatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, rows[0].updated_at),
  }));
  return { territories, paints };
}

export async function getCurrentTerritory(userId: string) {
  const map = await getTerritoryMapState();
  return map.territories.find((entry) => entry.userId === userId) ?? null;
}

export async function listCurrentTerritories() {
  return (await getTerritoryMapState()).territories;
}

export async function listTerritoryPaints() {
  return (await getTerritoryMapState()).paints;
}

export async function getWorldVersion() {
  return numeric((await productionWorld()).current_version);
}

async function claimEvents(userId?: string, limit = 50) {
  const admin = createMrapSupabaseAdminClient();
  let query = admin.from("claim_events")
    .select("id,user_id,route_session_id,raw_polygon,newly_claimed_area_m2,already_owned_area_m2,total_loop_area_m2,final_territory_area_m2,selected_color_id,committed_at_server")
    .eq("status", "committed")
    .order("committed_at_server", { ascending: false })
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  assertNoError(error, "Alan geçmişi okuma");
  return (data ?? []) as ClaimEventRow[];
}

async function claimsToTerritories(claims: ClaimEventRow[]): Promise<StoredTerritory[]> {
  if (!claims.length) return [];
  const admin = createMrapSupabaseAdminClient();
  const [profiles, sessionsResult] = await Promise.all([
    hydratePublicRows(claims.map((row) => row.user_id)),
    admin.from("route_sessions").select("id,player_id,location_mode,distance_m,duration_seconds,point_count,started_at,ended_at,created_at")
      .in("id", claims.map((row) => row.route_session_id)),
  ]);
  assertNoError(sessionsResult.error, "Rota toplamları okuma");
  const sessions = new Map(((sessionsResult.data ?? []) as RouteSessionRow[]).map((row) => [row.id, row]));
  return claims.map((claim) => {
    const owner = profiles.get(claim.user_id);
    const session = sessions.get(claim.route_session_id);
    return {
      id: claim.id,
      userId: claim.user_id,
      ownerUsername: owner?.username ?? "oyuncu",
      name: "Alan kaydı",
      district: owner?.city ?? "",
      geojson: geometry(claim.raw_polygon),
      color: claim.selected_color_id,
      pattern: owner?.pattern ?? 0,
      areaKm2: numeric(claim.total_loop_area_m2) / 1_000_000,
      newlyAddedAreaKm2: numeric(claim.newly_claimed_area_m2) / 1_000_000,
      overlapAreaKm2: numeric(claim.already_owned_area_m2) / 1_000_000,
      totalAreaAfterKm2: numeric(claim.final_territory_area_m2) / 1_000_000,
      distanceKm: numeric(session?.distance_m) / 1_000,
      durationSeconds: session?.duration_seconds ?? 0,
      mapSnapshot: null,
      active: true,
      createdAt: claim.committed_at_server,
    };
  });
}

function withoutMapSnapshot(territory: StoredTerritory): PostableTerritory {
  const { mapSnapshot, ...postable } = territory;
  void mapSnapshot;
  return postable;
}

export async function getTerritory(id: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("claim_events")
    .select("id,user_id,route_session_id,raw_polygon,newly_claimed_area_m2,already_owned_area_m2,total_loop_area_m2,final_territory_area_m2,selected_color_id,committed_at_server")
    .eq("id", id).eq("status", "committed").maybeSingle();
  if (error?.code === "22P02") return null;
  assertNoError(error, "Alan kaydı okuma");
  return data ? (await claimsToTerritories([data as ClaimEventRow]))[0] : null;
}

export async function listTerritories(userId?: string) {
  return claimsToTerritories(await claimEvents(userId));
}

export async function listTerritoryArchive(userId: string) {
  return listTerritories(userId);
}

export async function listPostableTerritories(userId: string, limit = 30): Promise<PostableTerritory[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Paylaşılabilir alan limiti 1–50 arasında olmalı.");
  const territories = await claimsToTerritories(await claimEvents(userId, limit));
  return territories.map(withoutMapSnapshot);
}

function routeSession(row: RouteSessionRow): RouteSession {
  return {
    id: row.id,
    userId: row.player_id,
    locationMode: row.location_mode === "development_simulation" ? "simulation" : "real",
    distanceM: numeric(row.distance_m),
    durationSeconds: row.duration_seconds,
    pointCount: row.point_count,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? row.started_at,
    createdAt: row.created_at,
  };
}

export async function recordRouteSession(_userId: string, _input: RecordRouteSessionInput) {
  void _userId;
  void _input;
  throw new Error("Supabase competitive rota toplamı yalnız authoritative game oturumu tamamlanırken yazılır.");
}

export async function listRouteSessions(userId: string, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("route_sessions")
    .select("id,player_id,location_mode,distance_m,duration_seconds,point_count,started_at,ended_at,created_at")
    .eq("player_id", userId)
    .in("status", ["completed", "expired", "revoked"])
    .order("ended_at", { ascending: false })
    .limit(safeLimit);
  assertNoError(error, "Rota oturumları okuma");
  return ((data ?? []) as RouteSessionRow[]).map(routeSession);
}

export async function getRouteSessionTotals(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const sessions: Array<{ distance_m: number | string; duration_seconds: number }> = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await admin.from("route_sessions")
      .select("distance_m,duration_seconds")
      .eq("player_id", userId)
      .in("status", ["completed", "expired", "revoked"])
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(error, "Rota toplamları okuma");
    sessions.push(...((data ?? []) as typeof sessions));
    if ((data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  return {
    distanceM: sessions.reduce((sum, row) => sum + numeric(row.distance_m), 0),
    durationSeconds: sessions.reduce((sum, row) => sum + Number(row.duration_seconds ?? 0), 0),
    sessionCount: sessions.length,
  };
}

type PostFeedMode = "following" | "explore" | "mine" | "saved" | "user";
type PostRow = {
  id: string;
  author_id: string;
  claim_id: string | null;
  claim_event_id: string | null;
  title: string;
  body: string;
  map_view: unknown;
  map_snapshot_object_key: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  created_at: string;
};

async function followedIds(viewerId: string) {
  const admin = createMrapSupabaseAdminClient();
  const ids: string[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await admin.from("follows").select("followed_id")
      .eq("follower_id", viewerId)
      .order("followed_id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(error, "Takip listesi okuma");
    ids.push(...(data ?? []).map((row) => String(row.followed_id)));
    if ((data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  return ids;
}

async function publicProfileIds() {
  const admin = createMrapSupabaseAdminClient();
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("profiles").select("id")
      .eq("account_visibility", "public")
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(error, "Açık profil listesi okuma");
    ids.push(...(data ?? []).map((row) => String(row.id)));
    if ((data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  return ids;
}

async function postScope(viewerId: string, mode: PostFeedMode, ownerId?: string) {
  const followed = await followedIds(viewerId);
  if (mode === "following") return { authorIds: [viewerId, ...followed], postIds: null as string[] | null };
  if (mode === "mine") return { authorIds: [viewerId], postIds: null as string[] | null };
  if (mode === "user") {
    if (!ownerId) throw new RangeError("Kullanıcı akışı için sahip kimliği zorunlu.");
    const owner = await hydratePublicRows([ownerId]);
    const row = owner.get(ownerId);
    const canView = Boolean(row && (row.account_visibility === "public" || ownerId === viewerId || followed.includes(ownerId)));
    return { authorIds: canView ? [ownerId] : [], postIds: null as string[] | null };
  }
  if (mode === "explore") {
    const excluded = new Set([viewerId, ...followed]);
    return { authorIds: (await publicProfileIds()).filter((id) => !excluded.has(id)), postIds: null as string[] | null };
  }
  const admin = createMrapSupabaseAdminClient();
  const savedPostIds: string[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const savedResult = await admin.from("saved_posts").select("post_id")
      .eq("user_id", viewerId)
      .order("post_id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(savedResult.error, "Kaydedilenler okuma");
    savedPostIds.push(...(savedResult.data ?? []).map((row) => String(row.post_id)));
    if ((savedResult.data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  const visible = new Set([viewerId, ...followed, ...(await publicProfileIds())]);
  return {
    authorIds: [...visible],
    postIds: savedPostIds,
  };
}

function assertPostLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > POST_PAGE_LIMITS.max) {
    throw new RangeError(`Gönderi sayfa limiti 1–${POST_PAGE_LIMITS.max} arasında olmalı.`);
  }
}

function inFilterChunks<T>(values: readonly T[]) {
  return Array.from(
    { length: Math.ceil(values.length / SUPABASE_IN_FILTER_CHUNK) },
    (_, index) => values.slice(index * SUPABASE_IN_FILTER_CHUNK, (index + 1) * SUPABASE_IN_FILTER_CHUNK),
  );
}

async function postRows(input: {
  viewerId: string;
  mode: PostFeedMode;
  ownerId?: string;
  cursor: PostCursor | null;
  limit: number;
}) {
  assertPostLimit(input.limit);
  const scope = await postScope(input.viewerId, input.mode, input.ownerId);
  if (!scope.authorIds.length || scope.postIds?.length === 0) return { rows: [] as PostRow[], total: 0 };
  const admin = createMrapSupabaseAdminClient();
  const authorChunks = inFilterChunks(scope.authorIds);
  const postIdChunks = scope.postIds ? inFilterChunks(scope.postIds) : [null];
  const candidates: PostRow[] = [];
  let total = 0;
  for (const authorIds of authorChunks) {
    for (const postIds of postIdChunks) {
      let rowsQuery = admin.from("posts")
        .select("id,author_id,claim_id,claim_event_id,title,body,map_view,map_snapshot_object_key,idempotency_key,payload_hash,created_at")
        .in("author_id", authorIds)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(input.limit + 1);
      let countQuery = admin.from("posts")
        .select("id", { count: "exact", head: true })
        .in("author_id", authorIds);
      if (postIds) {
        rowsQuery = rowsQuery.in("id", postIds);
        countQuery = countQuery.in("id", postIds);
      }
      if (input.cursor) {
        rowsQuery = rowsQuery.or(`created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`);
      }
      const [rowsResult, countResult] = await Promise.all([rowsQuery, countQuery]);
      assertNoError(rowsResult.error, "Gönderi akışı okuma");
      assertNoError(countResult.error, "Gönderi toplamı okuma");
      candidates.push(...((rowsResult.data ?? []) as PostRow[]));
      total += countResult.count ?? 0;
    }
  }
  candidates.sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
  return { rows: candidates.slice(0, input.limit + 1), total };
}

async function claimTerritoryMap(ids: readonly string[]) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const result = new Map<string, PostableTerritory>();
  if (!uniqueIds.length) return result;
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("claim_events")
    .select("id,user_id,route_session_id,raw_polygon,newly_claimed_area_m2,already_owned_area_m2,total_loop_area_m2,final_territory_area_m2,selected_color_id,committed_at_server")
    .in("id", uniqueIds).eq("status", "committed");
  assertNoError(error, "Gönderi alanları okuma");
  for (const territory of await claimsToTerritories((data ?? []) as ClaimEventRow[])) {
    result.set(territory.id, withoutMapSnapshot(territory));
  }
  return result;
}

async function interactionState(viewerId: string, postId: string, authorId: string) {
  const admin = createMrapSupabaseAdminClient();
  const [likes, comments, ownLike, ownSave] = await Promise.all([
    admin.from("likes").select("*", { count: "exact", head: true }).eq("post_id", postId),
    admin.from("comments").select("*", { count: "exact", head: true }).eq("post_id", postId),
    admin.from("likes").select("user_id").eq("post_id", postId).eq("user_id", viewerId).maybeSingle(),
    admin.from("saved_posts").select("user_id").eq("post_id", postId).eq("user_id", viewerId).maybeSingle(),
  ]);
  assertNoError(likes.error, "Beğeni sayısı okuma");
  assertNoError(comments.error, "Yorum sayısı okuma");
  assertNoError(ownLike.error, "Beğeni durumu okuma");
  assertNoError(ownSave.error, "Kaydetme durumu okuma");
  const [follow, request] = authorId === viewerId ? [{ data: null, error: null }, { data: null, error: null }] : await Promise.all([
    admin.from("follows").select("follower_id").eq("follower_id", viewerId).eq("followed_id", authorId).maybeSingle(),
    admin.from("follow_requests").select("requester_id").eq("requester_id", viewerId).eq("target_id", authorId).maybeSingle(),
  ]);
  assertNoError(follow.error, "Takip durumu okuma");
  assertNoError(request.error, "Takip isteği durumu okuma");
  return {
    likes: likes.count ?? 0,
    comments: comments.count ?? 0,
    likedByMe: Boolean(ownLike.data),
    savedByMe: Boolean(ownSave.data),
    followedByMe: Boolean(follow.data),
    requestedByMe: Boolean(request.data),
  };
}

async function rowsToPosts(viewerId: string, rows: PostRow[]): Promise<RealPost[]> {
  if (!rows.length) return [];
  const admin = createMrapSupabaseAdminClient();
  const profiles = await hydratePublicRows(rows.map((row) => row.author_id));
  const territories = await claimTerritoryMap(rows.map((row) => row.claim_event_id ?? ""));
  const { data: mediaRows, error: mediaError } = await admin.from("post_media")
    .select("post_id,sort_order").in("post_id", rows.map((row) => row.id)).order("sort_order", { ascending: true });
  assertNoError(mediaError, "Gönderi medyası okuma");
  const mediaCounts = new Map<string, number>();
  for (const media of mediaRows ?? []) mediaCounts.set(String(media.post_id), (mediaCounts.get(String(media.post_id)) ?? 0) + 1);
  const interactions = await Promise.all(rows.map((row) => interactionState(viewerId, row.id, row.author_id)));
  const posts: RealPost[] = [];
  rows.forEach((row, index) => {
    const user = profiles.get(row.author_id);
    const territory = row.claim_event_id ? territories.get(row.claim_event_id) : undefined;
    if (!user || !territory) return;
    const mediaCount = Math.min(mediaCounts.get(row.id) ?? 0, MEDIA_LIMITS.postImages.maxCount);
    posts.push({
      id: row.id,
      userId: row.author_id,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        initials: initials(user.display_name),
        color: user.color,
        pattern: user.pattern,
        avatarData: userMediaReference(user.id, "avatar", Boolean(user.avatar_object_key)),
      },
      territory,
      title: row.title,
      body: row.body,
      images: Array.from({ length: mediaCount }, (_, imageIndex) => `/api/posts/${encodeURIComponent(row.id)}/images/${imageIndex}`),
      mapView: normalizeMapCamera(row.map_view),
      ...interactions[index],
      createdAt: row.created_at,
    });
  });
  return posts;
}

type PostPageOptions = { cursor?: PostCursor | null; limit?: number };

async function pageFor(input: { viewerId: string; mode: PostFeedMode; ownerId?: string; options?: PostPageOptions }): Promise<PostPage> {
  const limit = input.options?.limit ?? POST_PAGE_LIMITS.default;
  const { rows, total } = await postRows({
    viewerId: input.viewerId,
    mode: input.mode,
    ownerId: input.ownerId,
    cursor: input.options?.cursor ?? null,
    limit,
  });
  const hasMore = rows.length > limit;
  const posts = await rowsToPosts(input.viewerId, rows.slice(0, limit));
  const last = posts.at(-1);
  return {
    posts,
    nextCursor: hasMore && last ? encodePostCursor({ createdAt: last.createdAt, id: last.id }) : null,
    total,
  };
}

export async function listPostPage(userId: string, mode: "following" | "explore" | "mine", options: PostPageOptions = {}) {
  return pageFor({ viewerId: userId, mode, options });
}

export async function listSavedPostPage(userId: string, options: PostPageOptions = {}) {
  return pageFor({ viewerId: userId, mode: "saved", options });
}

export async function listUserPostPage(viewerId: string, ownerId: string, options: PostPageOptions = {}) {
  return pageFor({ viewerId, ownerId, mode: "user", options });
}

export async function listPosts(userId: string, mode: "following" | "explore" | "mine") {
  return (await listPostPage(userId, mode)).posts;
}

export async function listUserPosts(viewerId: string, ownerId: string) {
  return (await listUserPostPage(viewerId, ownerId)).posts;
}

export async function listSavedPosts(userId: string) {
  return (await listSavedPostPage(userId)).posts;
}

function decodedUpload(value: string, allowedMimeTypes: ReadonlySet<"image/jpeg" | "image/png">, maxDataUrlLength: number) {
  const decoded = decodeSanitizedImageDataUrl(value, { allowedMimeTypes, maxDataUrlLength });
  if (!decoded) throw new RangeError("Görsel verisi geçersiz.");
  return decoded;
}

export async function createPostRecord(userId: string, input: { territoryId: string; title: string; body: string; images?: string[]; mapSnapshot?: string | null; mapView?: MapCameraState | null; idempotencyKey?: string }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < CONTENT_LIMITS.postTitle.min || title.length > CONTENT_LIMITS.postTitle.max) throw new RangeError("Gönderi başlığı sınır dışında.");
  if (body.length > CONTENT_LIMITS.postBody.max) throw new RangeError("Gönderi metni sınır dışında.");
  const images = sanitizeImageDataUrls(input.images ?? [], { allowedMimeTypes: postImageMimeTypes, ...MEDIA_LIMITS.postImages });
  if (!images) throw new RangeError("Gönderi fotoğrafları geçersiz.");
  const mapSnapshot = input.mapSnapshot
    ? sanitizeImageDataUrl(input.mapSnapshot, { allowedMimeTypes: mapSnapshotMimeTypes, maxDataUrlLength: MEDIA_LIMITS.postMapSnapshot.maxDataUrlLength })
    : null;
  if (input.mapSnapshot && !mapSnapshot) throw new RangeError("Harita görseli geçersiz.");
  const mapView = input.mapView ? normalizeMapCamera(input.mapView) : null;
  if (input.mapView && !mapView) throw new RangeError("Harita kadrajı geçersiz.");
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new RangeError("Gönderim anahtarı geçersiz.");
  const payloadHash = idempotencyKey ? createMutationPayloadHash({ territoryId: input.territoryId, title, body, images, mapSnapshot, mapView }) : null;
  const admin = createMrapSupabaseAdminClient();
  const claimResult = await admin.from("claim_events").select("id,user_id").eq("id", input.territoryId).eq("user_id", userId).eq("status", "committed").maybeSingle();
  if (claimResult.error?.code === "22P02") return null;
  assertNoError(claimResult.error, "Alan doğrulama");
  if (!claimResult.data) return null;
  if (idempotencyKey) {
    const replay = await admin.from("posts").select("id,payload_hash").eq("author_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    assertNoError(replay.error, "Gönderi tekrar kontrolü");
    if (replay.data) {
      if (replay.data.payload_hash !== payloadHash) throw new IdempotencyPayloadConflictError();
      return String(replay.data.id);
    }
  }
  const postId = randomUUID();
  const uploadedKeys: string[] = [];
  try {
    let mapSnapshotKey: string | null = null;
    if (mapSnapshot) {
      const decoded = decodedUpload(mapSnapshot, mapSnapshotMimeTypes, MEDIA_LIMITS.postMapSnapshot.maxDataUrlLength);
      const extension = decoded.mimeType === "image/png" ? "png" : "jpg";
      mapSnapshotKey = `${userId}/posts/${postId}/map.${extension}`;
      const upload = await admin.storage.from(MEDIA_BUCKET).upload(mapSnapshotKey, decoded.bytes, { contentType: decoded.mimeType, cacheControl: "31536000", upsert: false });
      assertNoError(upload.error, "Harita görseli yükleme");
      uploadedKeys.push(mapSnapshotKey);
    }
    const postInsert = await admin.from("posts").insert({
      id: postId,
      author_id: userId,
      claim_id: null,
      claim_event_id: input.territoryId,
      title,
      body,
      map_view: mapView,
      map_snapshot_object_key: mapSnapshotKey,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
    });
    if (postInsert.error?.code === "23505" && idempotencyKey) {
      const replay = await admin.from("posts").select("id,payload_hash")
        .eq("author_id", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
      assertNoError(replay.error, "Gönderi tekrar kontrolü");
      if (replay.data) {
        if (replay.data.payload_hash !== payloadHash) throw new IdempotencyPayloadConflictError();
        if (uploadedKeys.length) {
          const cleanup = await admin.storage.from(MEDIA_BUCKET).remove(uploadedKeys);
          assertNoError(cleanup.error, "Tekrarlanan gönderi medyası temizleme");
        }
        return String(replay.data.id);
      }
    }
    assertNoError(postInsert.error, "Gönderi oluşturma");
    for (const [index, image] of images.entries()) {
      const decoded = decodedUpload(image, postImageMimeTypes, MEDIA_LIMITS.postImages.maxDataUrlLength);
      const key = `${userId}/posts/${postId}/${index}.jpg`;
      const upload = await admin.storage.from(MEDIA_BUCKET).upload(key, decoded.bytes, { contentType: decoded.mimeType, cacheControl: "31536000", upsert: false });
      assertNoError(upload.error, "Gönderi fotoğrafı yükleme");
      uploadedKeys.push(key);
      const metadata = await admin.from("post_media").insert({
        post_id: postId,
        owner_id: userId,
        object_key: key,
        sort_order: index,
        mime_type: decoded.mimeType,
        byte_size: decoded.bytes.byteLength,
        width: decoded.dimensions.width,
        height: decoded.dimensions.height,
      });
      assertNoError(metadata.error, "Gönderi fotoğrafı kaydı");
    }
    return postId;
  } catch (error) {
    await admin.from("posts").delete().eq("id", postId).eq("author_id", userId);
    if (uploadedKeys.length) await admin.storage.from(MEDIA_BUCKET).remove(uploadedKeys);
    throw error;
  }
}

export async function canViewPost(viewerId: string, postId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("posts").select("author_id").eq("id", postId).maybeSingle();
  if (error?.code === "22P02") return false;
  assertNoError(error, "Gönderi erişimi okuma");
  if (!data) return false;
  const authorId = String(data.author_id);
  if (authorId === viewerId) return true;
  const profiles = await hydratePublicRows([authorId]);
  if (profiles.get(authorId)?.account_visibility === "public") return true;
  return (await getFollowRelation(viewerId, authorId)) === "following";
}

export async function getPostForViewer(viewerId: string, postId: string) {
  if (!await canViewPost(viewerId, postId)) return null;
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("posts")
    .select("id,author_id,claim_id,claim_event_id,title,body,map_view,map_snapshot_object_key,idempotency_key,payload_hash,created_at")
    .eq("id", postId).maybeSingle();
  assertNoError(error, "Gönderi okuma");
  return data ? (await rowsToPosts(viewerId, [data as PostRow]))[0] ?? null : null;
}

export async function getPostImageForViewer(viewerId: string, postId: string, index: number) {
  if (!await canViewPost(viewerId, postId)) return null;
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("post_media").select("object_key")
    .eq("post_id", postId).eq("sort_order", index).maybeSingle();
  assertNoError(error, "Gönderi fotoğrafı okuma");
  return downloadDataUrl(data?.object_key);
}

async function insertSocialNotification(input: {
  recipientId: string;
  actorId: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  title: string;
  body: string;
}) {
  if (input.recipientId === input.actorId) return;
  const admin = createMrapSupabaseAdminClient();
  const { error } = await admin.from("notifications").insert({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    event_type: input.eventType,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    payload: { title: input.title, body: input.body },
  });
  assertNoError(error, "Bildirim oluşturma");
}

export async function setLikeState(userId: string, postId: string, desired: boolean) {
  if (!await canViewPost(userId, postId)) return null;
  const admin = createMrapSupabaseAdminClient();
  if (desired) {
    const inserted = await admin.from("likes")
      .upsert({ user_id: userId, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true })
      .select("user_id")
      .maybeSingle();
    assertNoError(inserted.error, "Beğeni oluşturma");
    if (inserted.data) {
      const owner = await admin.from("posts").select("author_id").eq("id", postId).single();
      assertNoError(owner.error, "Gönderi sahibi okuma");
      if (!owner.data) throw new Error("Gönderi sahibi bulunamadı.");
      await insertSocialNotification({
        recipientId: String(owner.data.author_id), actorId: userId, eventType: "post_like",
        resourceType: "post", resourceId: postId,
        title: "Paylaşımın beğenildi", body: "Bir kaşif alan paylaşımını beğendi.",
      });
    }
  } else {
    const removed = await admin.from("likes").delete().eq("user_id", userId).eq("post_id", postId);
    assertNoError(removed.error, "Beğeni kaldırma");
  }
  const count = await admin.from("likes").select("*", { count: "exact", head: true }).eq("post_id", postId);
  assertNoError(count.error, "Beğeni sayısı okuma");
  return { liked: desired, count: count.count ?? 0 };
}

export async function listPostLikers(viewerId: string, postId: string) {
  if (!await canViewPost(viewerId, postId)) return null;
  const admin = createMrapSupabaseAdminClient();
  const { data, error, count } = await admin.from("likes")
    .select("user_id", { count: "exact" }).eq("post_id", postId)
    .order("created_at", { ascending: false }).limit(100);
  assertNoError(error, "Beğeni listesi okuma");
  const profiles = await hydratePublicRows((data ?? []).map((row) => String(row.user_id)));
  return {
    users: (data ?? []).flatMap((row) => {
      const user = profiles.get(String(row.user_id));
      return user ? [{
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        initials: initials(user.display_name),
        color: user.color,
        avatarData: userMediaReference(user.id, "avatar", Boolean(user.avatar_object_key)),
      }] : [];
    }),
    total: count ?? 0,
  };
}

export async function setSaveState(userId: string, postId: string, desired: boolean) {
  if (!await canViewPost(userId, postId)) return null;
  const admin = createMrapSupabaseAdminClient();
  const mutation = desired
    ? admin.from("saved_posts").upsert({ user_id: userId, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true })
    : admin.from("saved_posts").delete().eq("user_id", userId).eq("post_id", postId);
  const { error } = await mutation;
  assertNoError(error, desired ? "Gönderi kaydetme" : "Kayıttan kaldırma");
  return { saved: desired };
}

function commentFrom(row: { id: string; post_id: string; user_id: string; body: string; created_at: string }, user: UserRow): PostComment {
  return {
    id: row.id,
    postId: row.post_id,
    body: row.body,
    createdAt: row.created_at,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      initials: initials(user.display_name),
      color: user.color,
      avatarData: userMediaReference(user.id, "avatar", Boolean(user.avatar_object_key)),
    },
  };
}

function assertCommentLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Yorum sayfa limiti 1–50 arasında olmalı.");
}

export async function listPostComments(userId: string, postId: string, options: { cursor: PostCommentCursor | null; limit: number }): Promise<PostCommentPage | null> {
  if (!await canViewPost(userId, postId)) return null;
  assertCommentLimit(options.limit);
  const admin = createMrapSupabaseAdminClient();
  let query = admin.from("comments").select("id,post_id,user_id,body,created_at", { count: "exact" })
    .eq("post_id", postId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(options.limit + 1);
  if (options.cursor) query = query.or(`created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`);
  const { data, error, count } = await query;
  assertNoError(error, "Yorum listesi okuma");
  const rows = (data ?? []) as Array<{ id: string; post_id: string; user_id: string; body: string; created_at: string }>;
  const hasMore = rows.length > options.limit;
  const visible = rows.slice(0, options.limit);
  const profiles = await hydratePublicRows(visible.map((row) => row.user_id));
  const comments = visible.flatMap((row) => {
    const user = profiles.get(row.user_id);
    return user ? [commentFrom(row, user)] : [];
  });
  const last = comments.at(-1);
  return {
    comments,
    nextCursor: hasMore && last ? encodeCommentCursor({ createdAt: last.createdAt, id: last.id }) : null,
    total: count ?? 0,
  };
}

export async function addComment(userId: string, postId: string, body: string, idempotencyKey?: string): Promise<AddPostCommentResult | null> {
  if (!await canViewPost(userId, postId)) return null;
  const text = body.trim();
  if (text.length < CONTENT_LIMITS.commentBody.min || text.length > CONTENT_LIMITS.commentBody.max) {
    throw new RangeError(`Yorum ${CONTENT_LIMITS.commentBody.min}–${CONTENT_LIMITS.commentBody.max} karakter olmalı.`);
  }
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new RangeError("Yorum gönderim anahtarı geçersiz.");
  const payloadHash = idempotencyKey ? createMutationPayloadHash({ body: text }) : null;
  const admin = createMrapSupabaseAdminClient();
  if (idempotencyKey) {
    const replay = await admin.from("comments").select("id,post_id,user_id,body,created_at,payload_hash")
      .eq("user_id", userId).eq("post_id", postId).eq("idempotency_key", idempotencyKey).maybeSingle();
    assertNoError(replay.error, "Yorum tekrar kontrolü");
    if (replay.data) {
      if (replay.data.payload_hash !== payloadHash) throw new IdempotencyPayloadConflictError();
      const user = await hydrateUserRow(userId);
      if (!user) throw new Error("Yorum sahibi bulunamadı.");
      const count = await admin.from("comments").select("*", { count: "exact", head: true }).eq("post_id", postId);
      assertNoError(count.error, "Yorum sayısı okuma");
      return { comment: commentFrom(replay.data, user), total: count.count ?? 0, replayed: true };
    }
  }
  const id = randomUUID();
  const inserted = await admin.from("comments").insert({
    id, user_id: userId, post_id: postId, body: text,
    idempotency_key: idempotencyKey ?? null, payload_hash: payloadHash,
  }).select("id,post_id,user_id,body,created_at").single();
  if (inserted.error?.code === "23505" && idempotencyKey) {
    const replay = await admin.from("comments").select("id,post_id,user_id,body,created_at,payload_hash")
      .eq("user_id", userId).eq("post_id", postId).eq("idempotency_key", idempotencyKey).maybeSingle();
    assertNoError(replay.error, "Yorum tekrar kontrolü");
    if (replay.data) {
      if (replay.data.payload_hash !== payloadHash) throw new IdempotencyPayloadConflictError();
      const user = await hydrateUserRow(userId);
      if (!user) throw new Error("Yorum sahibi bulunamadı.");
      const count = await admin.from("comments").select("*", { count: "exact", head: true }).eq("post_id", postId);
      assertNoError(count.error, "Yorum sayısı okuma");
      return { comment: commentFrom(replay.data, user), total: count.count ?? 0, replayed: true };
    }
  }
  assertNoError(inserted.error, "Yorum oluşturma");
  const user = await hydrateUserRow(userId);
  if (!user) throw new Error("Yorum sahibi bulunamadı.");
  const owner = await admin.from("posts").select("author_id").eq("id", postId).single();
  assertNoError(owner.error, "Gönderi sahibi okuma");
  if (!owner.data) throw new Error("Gönderi sahibi bulunamadı.");
  await insertSocialNotification({
    recipientId: String(owner.data.author_id), actorId: userId, eventType: "post_comment",
    resourceType: "post", resourceId: postId,
    title: "Paylaşımına yorum yapıldı", body: "Bir kaşif alan paylaşımına yorum yaptı.",
  });
  const count = await admin.from("comments").select("*", { count: "exact", head: true }).eq("post_id", postId);
  assertNoError(count.error, "Yorum sayısı okuma");
  if (!inserted.data) throw new Error("Eklenen yorum okunamadı.");
  return { comment: commentFrom(inserted.data, user), total: count.count ?? 0, replayed: false };
}

export async function getFollowRelation(viewerId: string, targetId: string): Promise<"none" | "following" | "requested"> {
  const admin = createMrapSupabaseAdminClient();
  const [follow, request] = await Promise.all([
    admin.from("follows").select("follower_id").eq("follower_id", viewerId).eq("followed_id", targetId).maybeSingle(),
    admin.from("follow_requests").select("requester_id").eq("requester_id", viewerId).eq("target_id", targetId).maybeSingle(),
  ]);
  assertNoError(follow.error, "Takip durumu okuma");
  assertNoError(request.error, "Takip isteği okuma");
  return follow.data ? "following" : request.data ? "requested" : "none";
}

export async function setFollowState(followerId: string, followedId: string, desired: boolean) {
  if (followerId === followedId) return { status: "none" as const };
  const target = await hydrateUserRow(followedId);
  if (!target) return null;
  const admin = createMrapSupabaseAdminClient();
  const relation = await getFollowRelation(followerId, followedId);
  if (!desired) {
    const [followDelete, requestDelete] = await Promise.all([
      admin.from("follows").delete().eq("follower_id", followerId).eq("followed_id", followedId),
      admin.from("follow_requests").delete().eq("requester_id", followerId).eq("target_id", followedId),
    ]);
    assertNoError(followDelete.error, "Takipten çıkma");
    assertNoError(requestDelete.error, "Takip isteği iptali");
    return { status: "none" as const };
  }
  if (relation !== "none") return { status: relation };
  const follower = await hydrateUserRow(followerId);
  if (target.account_visibility === "private") {
    const inserted = await admin.from("follow_requests")
      .upsert({ requester_id: followerId, target_id: followedId }, { onConflict: "requester_id,target_id", ignoreDuplicates: true })
      .select("requester_id")
      .maybeSingle();
    assertNoError(inserted.error, "Takip isteği oluşturma");
    if (inserted.data) {
      await insertSocialNotification({
        recipientId: followedId, actorId: followerId, eventType: "follow_request",
        title: "Yeni takip isteği", body: `@${follower?.username ?? "oyuncu"} seni takip etmek istiyor.`,
      });
    }
    return { status: "requested" as const };
  }
  const inserted = await admin.from("follows")
    .upsert({ follower_id: followerId, followed_id: followedId }, { onConflict: "follower_id,followed_id", ignoreDuplicates: true })
    .select("follower_id")
    .maybeSingle();
  assertNoError(inserted.error, "Takip oluşturma");
  if (inserted.data) {
    await insertSocialNotification({
      recipientId: followedId, actorId: followerId, eventType: "social_follow",
      title: "Yeni takipçin var", body: `@${follower?.username ?? "oyuncu"} seni takip etmeye başladı.`,
    });
  }
  return { status: "following" as const };
}

export async function listFollowRequests(targetId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("follow_requests").select("requester_id,created_at")
    .eq("target_id", targetId).order("created_at", { ascending: false }).limit(CONNECTION_PAGE_LIMITS.max);
  assertNoError(error, "Takip istekleri okuma");
  const profiles = await hydratePublicRows((data ?? []).map((row) => String(row.requester_id)));
  return (data ?? []).flatMap((row) => {
    const user = profiles.get(String(row.requester_id));
    return user ? [{ user: compactPlayer(user), requestedAt: String(row.created_at) }] : [];
  });
}

export async function resolveFollowRequest(targetId: string, requesterId: string, action: "accept" | "reject") {
  const admin = createMrapSupabaseAdminClient();
  // Deleting with a representation atomically consumes the pending request.
  // Concurrent accept/reject calls therefore cannot both win the decision.
  const consumed = await admin.from("follow_requests").delete()
    .eq("requester_id", requesterId).eq("target_id", targetId)
    .select("requester_id")
    .maybeSingle();
  assertNoError(consumed.error, "Takip isteği kapatma");
  if (!consumed.data) return false;
  if (action === "accept") {
    const followed = await admin.from("follows")
      .upsert({ follower_id: requesterId, followed_id: targetId }, { onConflict: "follower_id,followed_id", ignoreDuplicates: true })
      .select("follower_id")
      .maybeSingle();
    if (followed.error) {
      // Preserve the user's pending decision if the follow mutation fails.
      await admin.from("follow_requests")
        .upsert({ requester_id: requesterId, target_id: targetId }, { onConflict: "requester_id,target_id", ignoreDuplicates: true });
      assertNoError(followed.error, "Takip isteği kabulü");
    }
    if (followed.data) {
      await insertSocialNotification({
        recipientId: requesterId, actorId: targetId, eventType: "social_follow_accepted",
        title: "Takip isteğin kabul edildi", body: "Artık bu gizli hesabın paylaşımlarını görebilirsin.",
      });
    }
  }
  return true;
}

export async function searchPlayers(viewerId: string, query = ""): Promise<PlayerSearchResult[]> {
  const normalized = normalizeUserSearchText(query).slice(0, PLAYER_SEARCH_LIMITS.queryMax);
  if (!normalized) return [];
  const admin = createMrapSupabaseAdminClient();
  const pattern = `%${escapeSqlLike(normalized)}%`;
  const { data, error } = await admin.from("profiles").select("id")
    .neq("id", viewerId)
    .ilike("search_key", pattern)
    .order("search_key", { ascending: true })
    .order("id", { ascending: true })
    .limit(PLAYER_SEARCH_LIMITS.results);
  assertNoError(error, "Kullanıcı arama");
  const ids = (data ?? []).map((row) => String(row.id));
  const profiles = await hydratePublicRows(ids);
  const world = await productionWorld();
  return Promise.all(ids.flatMap((id) => profiles.has(id) ? [id] : []).map(async (id) => {
    const user = profiles.get(id)!;
    const [followers, claims, score, relation] = await Promise.all([
      admin.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", id),
      admin.from("claim_events").select("*", { count: "exact", head: true }).eq("user_id", id).eq("status", "committed"),
      admin.from("player_scores").select("current_territory_area_m2").eq("world_id", world.id).eq("user_id", id).maybeSingle(),
      getFollowRelation(viewerId, id),
    ]);
    assertNoError(followers.error, "Takipçi sayısı okuma");
    assertNoError(claims.error, "Alan sayısı okuma");
    assertNoError(score.error, "Alan skoru okuma");
    return {
      ...compactPlayer(user),
      followers: followers.count ?? 0,
      routes: claims.count ?? 0,
      areaKm2: numeric(score.data?.current_territory_area_m2) / 1_000_000,
      relation,
    };
  }));
}

export async function getPlayerProfile(username: string, viewerId: string) {
  const row = await findUserRowByUsername(username);
  if (!row) return null;
  const relation = row.id === viewerId ? "following" : await getFollowRelation(viewerId, row.id);
  return {
    user: publicPlayer(row),
    relation,
    canView: row.account_visibility === "public" || row.id === viewerId || relation === "following",
    stats: await getUserStats(row.id),
  };
}

export async function getConnectionListAccess(userId: string, viewerId: string): Promise<"allowed" | "forbidden" | "not_found"> {
  const owner = await hydrateUserRow(userId);
  if (!owner) return "not_found";
  const viewerFollowsOwner = owner.id !== viewerId && await getFollowRelation(viewerId, owner.id) === "following";
  return canViewConnectionList({ accountVisibility: owner.account_visibility, ownerId: owner.id, viewerId, viewerFollowsOwner })
    ? "allowed" : "forbidden";
}

export async function listConnectionPage(userId: string, viewerId: string, type: "followers" | "following", options: { cursor: ConnectionCursor | null; limit?: number }): Promise<ConnectionPage | null> {
  if (await getConnectionListAccess(userId, viewerId) !== "allowed") return null;
  const limit = options.limit ?? CONNECTION_PAGE_LIMITS.default;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CONNECTION_PAGE_LIMITS.max) throw new RangeError("Bağlantı sayfa limiti geçersiz.");
  const admin = createMrapSupabaseAdminClient();
  const column = type === "followers" ? "follower_id" : "followed_id";
  const filter = type === "followers" ? "followed_id" : "follower_id";
  const ids: string[] = [];
  let total = 0;
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const page = await admin.from("follows").select(column, { count: "exact" })
      .eq(filter, userId)
      .order(column, { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(page.error, "Bağlantı listesi okuma");
    if (from === 0) total = page.count ?? 0;
    ids.push(...(page.data ?? []).map((row) => String(row[column as keyof typeof row])));
    if ((page.data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  const profiles = await hydratePublicRows(ids);
  const ordered = ids.flatMap((id) => {
    const user = profiles.get(id);
    return user ? [{ user, searchKey: normalizeUserSearchText(`${user.username} ${user.display_name}`) }] : [];
  }).sort((left, right) => left.searchKey.localeCompare(right.searchKey, "tr") || left.user.id.localeCompare(right.user.id));
  const afterCursor = options.cursor
    ? ordered.filter((row) => row.searchKey > options.cursor!.searchKey || (row.searchKey === options.cursor!.searchKey && row.user.id > options.cursor!.id))
    : ordered;
  const visible = afterCursor.slice(0, limit);
  const connections: SocialConnection[] = await Promise.all(visible.map(async ({ user }) => ({
    user: compactPlayer(user),
    relation: user.id === viewerId ? "following" as const : await getFollowRelation(viewerId, user.id),
  })));
  const last = visible.at(-1);
  return {
    connections,
    nextCursor: afterCursor.length > limit && last ? encodeConnectionCursor({ searchKey: last.searchKey, id: last.user.id }) : null,
    total,
  };
}

export async function getUserStats(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const world = await productionWorld();
  const readClaims = async () => {
    const rows: Array<{ total_loop_area_m2: number | string }> = [];
    for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
      const page = await admin.from("claim_events").select("total_loop_area_m2")
        .eq("world_id", world.id).eq("user_id", userId).eq("status", "committed")
        .order("id", { ascending: true })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      assertNoError(page.error, "Profil alan istatistiği okuma");
      rows.push(...((page.data ?? []) as typeof rows));
      if ((page.data ?? []).length < SUPABASE_PAGE_SIZE) break;
    }
    return rows;
  };
  const readSessions = async () => {
    const rows: Array<{ distance_m: number | string; duration_seconds: number }> = [];
    for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
      const page = await admin.from("route_sessions").select("distance_m,duration_seconds")
        .eq("world_id", world.id).eq("player_id", userId).eq("status", "completed")
        .order("id", { ascending: true })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      assertNoError(page.error, "Profil rota istatistiği okuma");
      rows.push(...((page.data ?? []) as typeof rows));
      if ((page.data ?? []).length < SUPABASE_PAGE_SIZE) break;
    }
    return rows;
  };
  const [score, claims, sessions, followers, following] = await Promise.all([
    admin.from("player_scores").select("current_territory_area_m2").eq("world_id", world.id).eq("user_id", userId).maybeSingle(),
    readClaims(),
    readSessions(),
    admin.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", userId),
    admin.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  [score, followers, following].forEach((result) => assertNoError(result.error, "Profil istatistiği okuma"));
  return {
    area: numeric(score.data?.current_territory_area_m2) / 1_000_000,
    closed_area: claims.reduce((sum, row) => sum + numeric(row.total_loop_area_m2), 0) / 1_000_000,
    distance: sessions.reduce((sum, row) => sum + numeric(row.distance_m), 0) / 1_000,
    routes: claims.length,
    duration: sessions.reduce((sum, row) => sum + Number(row.duration_seconds ?? 0), 0),
    followers: followers.count ?? 0,
    following: following.count ?? 0,
  };
}

async function leaderboardRows(cityId?: string): Promise<LeaderboardEntry[]> {
  const admin = createMrapSupabaseAdminClient();
  const world = await productionWorld();
  let candidateIds: Set<string> | null = null;
  if (cityId) {
    candidateIds = new Set<string>();
    for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
      const page = await admin.from("profiles").select("id").eq("city_id", cityId)
        .order("id", { ascending: true })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      assertNoError(page.error, "Şehir oyuncuları okuma");
      for (const row of page.data ?? []) candidateIds.add(String(row.id));
      if ((page.data ?? []).length < SUPABASE_PAGE_SIZE) break;
    }
    if (!candidateIds.size) return [];
  }
  const allScores: Array<{ user_id: string; current_territory_area_m2: number | string; claim_count: number }> = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const page = await admin.from("player_scores").select("user_id,current_territory_area_m2,claim_count")
      .eq("world_id", world.id)
      .order("current_territory_area_m2", { ascending: false })
      .order("claim_count", { ascending: false })
      .order("user_id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    assertNoError(page.error, "Sıralama okuma");
    allScores.push(...((page.data ?? []) as typeof allScores));
    if ((page.data ?? []).length < SUPABASE_PAGE_SIZE) break;
  }
  const scores = candidateIds ? allScores.filter((row) => candidateIds.has(String(row.user_id))) : allScores;
  const profiles = await hydratePublicRows(scores.map((row) => String(row.user_id)));
  return scores.flatMap((score, index) => {
    const user = profiles.get(String(score.user_id));
    return user ? [{
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      initials: initials(user.display_name),
      color: user.color,
      pattern: user.pattern,
      city: user.city,
      avatarData: userMediaReference(user.id, "avatar", Boolean(user.avatar_object_key)),
      areaKm2: numeric(score.current_territory_area_m2) / 1_000_000,
      routes: Number(score.claim_count ?? 0),
      rank: index + 1,
    }] : [];
  });
}

export async function getLeaderboard(cityId?: string) {
  return (await leaderboardRows(cityId)).slice(0, LEADERBOARD_LIMIT);
}

export async function getLeaderboardRank(userId: string, cityId?: string) {
  return (await leaderboardRows(cityId)).find((entry) => entry.id === userId)?.rank ?? null;
}

function notificationCopy(eventType: string, payload: JsonObject) {
  const payloadTitle = typeof payload.title === "string" ? payload.title : null;
  const payloadBody = typeof payload.body === "string" ? payload.body : null;
  if (payloadTitle && payloadBody) return { type: eventType, title: payloadTitle, body: payloadBody };
  if (eventType === "territory.claim_committed") {
    const area = numeric(payload.newlyClaimedAreaM2) / 1_000_000;
    return { type: "claim_confirmed", title: "Alan güncellendi", body: `+${area.toFixed(4)} km² benzersiz alan kazandın.` };
  }
  if (eventType === "territory.lost") {
    const area = numeric(payload.lostAreaM2) / 1_000_000;
    return { type: "territory_lost", title: "Alan sınırın değişti", body: `${area.toFixed(4)} km² alan rakibe geçti.` };
  }
  return { type: "system", title: "mrap bildirimi", body: "Hesabında yeni bir hareket var." };
}

export async function listNotifications(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { data, error } = await admin.from("notifications")
    .select("id,actor_id,event_type,resource_type,resource_id,payload,read_at,created_at")
    .eq("recipient_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
  assertNoError(error, "Bildirimler okuma");
  const rows = data ?? [];
  const actors = await hydratePublicRows(rows.map((row) => String(row.actor_id ?? "")).filter(Boolean));
  return rows.map((row) => {
    const copy = notificationCopy(String(row.event_type), (row.payload ?? {}) as JsonObject);
    const actor = row.actor_id ? actors.get(String(row.actor_id)) : undefined;
    return {
      id: String(row.id),
      type: copy.type,
      title: copy.title,
      body: copy.body,
      read_at: row.read_at ? String(row.read_at) : null,
      created_at: String(row.created_at),
      href: notificationHref(copy.type, actor?.username, row.resource_type ? String(row.resource_type) : null, row.resource_id ? String(row.resource_id) : null),
    };
  });
}

export async function markNotificationsRead(userId: string) {
  const admin = createMrapSupabaseAdminClient();
  const { error } = await admin.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_id", userId).is("read_at", null);
  assertNoError(error, "Bildirimleri okundu işaretleme");
}
