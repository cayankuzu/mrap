import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import bbox from "@turf/bbox";
import booleanValid from "@turf/boolean-valid";
import distance from "@turf/distance";
import { feature, point } from "@turf/helpers";
import kinks from "@turf/kinks";
import { ROUTE_COLORS } from "@/lib/app-config";
import { LoopDetector } from "@/lib/game/loop-detector";
import type {
  ClaimPipelineStatus,
  ClaimResult,
  CloseLoopCommand,
  CompetitiveLocationMode,
  LocationPointCommand,
  LoopCandidateDto,
  PointClassification,
  RegionPatchEvent,
  RouteSessionDto,
  RouteSessionRecoveryDto,
} from "@/lib/game/authoritative-types";
import type { Coordinate } from "@/lib/game/types";
import type { CurrentTerritory, TerritoryMapState, TerritoryPaint } from "@/lib/models";
import { TileOwnershipGrid } from "@/lib/spatial/ownership-grid";
import { createMrapSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { AUTHORITATIVE_GAME_CONFIG, type AuthoritativeGameConfig } from "@/server/game/authoritative-config";
import { gameError } from "@/server/game/authoritative-error";
import type { RegionSnapshotWithCells } from "@/server/game/authoritative-store";

const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGION_PATTERN = /^(?:[1-9]|1\d|2[0-6])\/(?:0|[1-9]\d{0,7})\/(?:0|[1-9]\d{0,7})$/;
const ACCEPTED_CLASSIFICATIONS = new Set<PointClassification>(["ACCEPTED", "SUSPICIOUS"]);

type HostedSessionRow = {
  id: string;
  player_id: string;
  world_id: string;
  location_mode: CompetitiveLocationMode;
  status: RouteSessionDto["status"];
  server_nonce_hash: string;
  last_received_sequence: number | string;
  last_accepted_sequence: number | string;
  point_count: number | string;
  suspicious_point_count: number | string;
  distance_m: number | string;
  current_segment_index: number | string;
  risk_score: number | string;
  lease_expires_at: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | string;
};

type HostedPoint = {
  sequence: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMps: number | null;
  clientObservedAt: string | null;
  receivedAtServer: string;
  classification: PointClassification;
  reason: string | null;
  segmentIndex: number;
  pointHash: string;
};

export type SupabasePointBatchResult = {
  acceptedCount: number;
  ignoredCount: number;
  suspiciousCount: number;
  lastReceivedSequence: number;
  lastAcceptedSequence: number;
  classifications: Array<{ sequence: number; classification: PointClassification; reason?: string }>;
};

type WorldRow = {
  id: string;
  slug: string;
  status: string;
  environment: string;
  grid_resolution: number;
  region_resolution: number;
};

type CellRow = {
  cell_id: string;
  region_id: string;
  owner_id: string;
  paint_color_id: string;
};

type HostedRpcError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
} | null;

type HostedRpcResult<T> = {
  data: T;
  error: HostedRpcError;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function iso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function parseIsoMs(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function numeric(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function canonicalPoint(value: LocationPointCommand) {
  return {
    sequence: value.sequence,
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyM: value.accuracyM,
    altitudeM: value.altitudeM ?? null,
    speedMps: value.speedMps ?? null,
    heading: value.heading ?? null,
    clientObservedAt: value.clientObservedAt ?? null,
  };
}

function validPoint(value: LocationPointCommand) {
  return Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && Number.isFinite(value.latitude)
    && value.latitude >= -85.05112878
    && value.latitude <= 85.05112878
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && Number.isFinite(value.accuracyM)
    && value.accuracyM >= 0
    && (value.altitudeM === undefined || Number.isFinite(value.altitudeM))
    && (value.speedMps === undefined || Number.isFinite(value.speedMps) && value.speedMps >= 0)
    && (value.heading === undefined || Number.isFinite(value.heading) && value.heading >= 0 && value.heading <= 360)
    && (value.clientObservedAt === undefined || parseIsoMs(value.clientObservedAt) !== null);
}

function polygonHash(polygon: Polygon) {
  const normalized = polygon.coordinates.map((ring) => ring.map((coordinate) => [
    Number(coordinate[0].toFixed(7)),
    Number(coordinate[1].toFixed(7)),
  ]));
  return sha256(JSON.stringify(normalized));
}

function commandHash(command: CloseLoopCommand) {
  return sha256(JSON.stringify({
    sessionId: command.sessionId,
    candidateId: command.candidateId,
    lastAcceptedPointSequence: command.lastAcceptedPointSequence,
    selectedColorId: command.selectedColorId.toUpperCase(),
    idempotencyKey: command.idempotencyKey,
  }));
}

function safeEqualHex(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue, "hex");
  const right = Buffer.from(rightValue, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isTransactionRetryable(error: HostedRpcError) {
  return error?.code === "40P01" || error?.code === "40001";
}

function gameRpcError(error: HostedRpcError, fallback: string): never {
  const source = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toUpperCase();
  if (source.includes("SESSION_NOT_FOUND")) gameError("NOT_FOUND", "Rota oturumu bulunamadı.", 404);
  if (source.includes("CANDIDATE_NOT_FOUND")) gameError("NOT_FOUND", "Döngü adayı bulunamadı.", 404);
  if (source.includes("WORLD_NOT_FOUND")) gameError("NOT_FOUND", "Oyun dünyası bulunamadı.", 404);
  if (source.includes("WORLD_NOT_ACTIVE")) gameError("RETRYABLE", "Oyun dünyası henüz rekabetçi oturumlara açılmadı.", 503, true);
  if (source.includes("WORLD_NOT_ACCEPTING_CLAIMS")) gameError("RETRYABLE", "Oyun dünyası şu anda alan taleplerini kabul etmiyor.", 503, true);
  if (source.includes("PRODUCTION_SIMULATION_FORBIDDEN")) gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
  if (source.includes("NONCE_MISMATCH")) gameError("NONCE_MISMATCH", "Rota oturumu doğrulanamadı.", 403);
  if (source.includes("SESSION_REVOKED")) gameError("SESSION_REVOKED", "Rota oturumu güvenlik nedeniyle sonlandırıldı.", 409);
  if (source.includes("SESSION_EXPIRED")) gameError("SESSION_EXPIRED", "Rota oturumunun süresi doldu.", 409);
  if (source.includes("SESSION_CONFLICT")) gameError("SESSION_CONFLICT", "Bu dünyada zaten etkin bir rota oturumun var.", 409);
  if (source.includes("SEGMENT_CONFLICT") || source.includes("CANDIDATE_CONFLICT")) gameError("CONFLICT", "İşlem eşzamanlı başka bir istekle değişti.", 409, true);
  if (source.includes("CANDIDATE_EXPIRED") || source.includes("STALE_LOOP_CANDIDATE")) gameError("CANDIDATE_EXPIRED", "Döngü adayının süresi doldu.", 409);
  if (source.includes("STALE_ROUTE_SESSION") || source.includes("STALE_POINT_SEQUENCE")) gameError("CONFLICT", "Rota durumu değişti; güncel durumla yeniden dene.", 409, true);
  if (source.includes("IDEMPOTENCY_CONFLICT") || source.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) gameError("IDEMPOTENCY_CONFLICT", "Aynı işlem kimliği farklı içerikle kullanılamaz.", 409);
  if (source.includes("SEQUENCE_GAP")) gameError("SEQUENCE_GAP", "Beklenen konum sıra numarası alınmadı.", 409);
  if (source.includes("INVALID_GEOMETRY") || source.includes("INVALID_CLAIM_GEOMETRY")
      || source.includes("CELL_OUTSIDE_CANDIDATE")) gameError("INVALID_GEOMETRY", "Alan geometrisi doğrulanamadı.", 422);
  if (source.includes("INVALID_TARGET_CELL_SET") || source.includes("INVALID_CELL_ID") || source.includes("INVALID_REGION_SET")) gameError("INVALID_GEOMETRY", "Alan hücreleri doğrulanamadı.", 422);
  if (source.includes("INVALID_SESSION")) gameError("INVALID_SESSION", "Rota oturumu etkin değil.", 409);
  if (source.includes("CLAIM_RATE_LIMITED")) gameError("RATE_LIMITED", "Alan işlemi sınırına ulaşıldı.", 429, true);
  if (source.includes("RESTRICTED_REGION")) gameError("RESTRICTED_REGION", "Bu bölgede alan kapatılamaz.", 422);
  if (source.includes("SIMULATION_NOT_ALLOWED")) gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
  if (source.includes("FOREIGN_SESSION_OR_CANDIDATE") || source.includes("INVALID_ROUTE_SESSION")
      || source.includes("INVALID_LOOP_CANDIDATE")) gameError("INVALID_ROUTE", "Rota sahipliği doğrulanamadı.", 422);
  if (source.includes("UNMATERIALIZED_TARGET_CELL") || source.includes("REGION_NOT_WRITABLE")) {
    gameError("RETRYABLE", "Alan bölgesi eş zamanlı güncellendi; yeniden denenebilir.", 409, true);
  }
  if (source.includes("RISK_SCORE_TOO_HIGH") || source.includes("ROUTE_SEQUENCE_GAP")
      || source.includes("INVALID_ROUTE_SOURCE_CONTACT") || source.includes("INVALID_OWNERSHIP_SOURCE_CONTACT")
      || source.includes("OWNERSHIP_BOUNDARY_CHANGED")) {
    gameError("INVALID_ROUTE", "Rota güvenlik doğrulamasından geçemedi.", 422);
  }
  if (error?.code === "22P02") gameError("INVALID_REQUEST", "İstek kimliklerinden biri geçersiz.");
  if (isTransactionRetryable(error)) gameError("RETRYABLE", "İşlem eş zamanlı bir güncellemeyle çakıştı; güvenle yeniden denenebilir.", 409, true);
  throw new Error(`${fallback}: hosted authoritative operation failed`);
}

function sessionDto(row: HostedSessionRow, worldSlug: string, nonce: string): RouteSessionDto {
  return {
    id: row.id,
    worldId: worldSlug,
    mode: row.location_mode,
    status: row.status,
    serverNonce: nonce,
    lastReceivedSequence: numeric(row.last_received_sequence),
    lastAcceptedSequence: numeric(row.last_accepted_sequence),
    currentSegmentIndex: numeric(row.current_segment_index),
    riskScore: numeric(row.risk_score),
    leaseExpiresAt: row.lease_expires_at,
    startedAtServer: row.started_at,
  };
}

function rpcSessionDto(value: unknown, nonce: string): RouteSessionDto {
  const row = recordValue(value);
  return {
    id: String(row.id ?? ""),
    worldId: String(row.worldId ?? ""),
    mode: row.mode as CompetitiveLocationMode,
    status: row.status as RouteSessionDto["status"],
    serverNonce: nonce,
    lastReceivedSequence: numeric(row.lastReceivedSequence),
    lastAcceptedSequence: numeric(row.lastAcceptedSequence),
    currentSegmentIndex: numeric(row.currentSegmentIndex),
    riskScore: numeric(row.riskScore),
    leaseExpiresAt: String(row.leaseExpiresAt ?? ""),
    startedAtServer: String(row.startedAtServer ?? ""),
  };
}

function candidateDto(value: unknown): LoopCandidateDto {
  const row = recordValue(value);
  return {
    id: String(row.id ?? ""),
    sessionId: String(row.sessionId ?? ""),
    startSequence: numeric(row.startSequence),
    endSequence: numeric(row.endSequence),
    sourceSegmentIndex: numeric(row.sourceSegmentIndex),
    coordinatesHash: String(row.coordinatesHash ?? ""),
    estimatedAreaM2: numeric(row.estimatedAreaM2),
    routeLengthM: numeric(row.routeLengthM),
    detectedAtServer: String(row.detectedAtServer ?? ""),
    expiresAt: String(row.expiresAt ?? ""),
    status: row.status as LoopCandidateDto["status"],
  };
}

function polygonalGeometry(value: unknown, context: string): Polygon | MultiPolygon {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    gameError("INVALID_GEOMETRY", `${context} geometrisi okunamadı.`, 500);
  }
  const geometry = value as Polygon | MultiPolygon;
  if ((geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")
      || !Array.isArray(geometry.coordinates)
      || !booleanValid(feature(geometry))) {
    gameError("INVALID_GEOMETRY", `${context} geometrisi geçersiz.`, 500);
  }
  return geometry;
}

export class SupabaseAuthoritativeGameStore {
  readonly grid: TileOwnershipGrid;

  constructor(
    private readonly config: AuthoritativeGameConfig = AUTHORITATIVE_GAME_CONFIG,
    private readonly clock: () => number = Date.now,
  ) {
    this.grid = new TileOwnershipGrid(config.grid);
  }

  private admin() {
    return createMrapSupabaseAdminClient();
  }

  private async retryIdempotentRpc<T>(operation: () => PromiseLike<HostedRpcResult<T>>) {
    let attempt = 0;
    for (;;) {
      const result = await operation();
      if (!isTransactionRetryable(result.error) || attempt >= this.config.transaction.maximumRetries) return result;
      const jitter = this.config.transaction.retryJitterMs > 0
        ? Math.floor(Math.random() * (this.config.transaction.retryJitterMs + 1))
        : 0;
      const delayMs = this.config.transaction.retryBaseDelayMs * (2 ** attempt) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }

  private throwStructuredRpcError(value: unknown, fallback: string) {
    const result = recordValue(value);
    const errorCode = typeof result.errorCode === "string" ? result.errorCode : null;
    if (errorCode) gameRpcError({ message: errorCode }, fallback);
  }

  private worldSlugForMode(mode: CompetitiveLocationMode) {
    if (mode === "development_simulation") {
      if (process.env.NODE_ENV === "production") {
        gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
      }
      return this.config.worlds.development;
    }
    return this.config.worlds.production;
  }

  private async worldBySlug(slug: string): Promise<WorldRow> {
    const { data, error } = await this.admin().from("worlds")
      .select("id,slug,status,environment,grid_resolution,region_resolution")
      .eq("slug", slug)
      .maybeSingle();
    if (error) gameRpcError(error, "world lookup");
    if (!data) gameError("NOT_FOUND", "Oyun dünyası bulunamadı.", 404);
    return data as WorldRow;
  }

  private async worldById(id: string): Promise<WorldRow> {
    const { data, error } = await this.admin().from("worlds")
      .select("id,slug,status,environment,grid_resolution,region_resolution")
      .eq("id", id)
      .maybeSingle();
    if (error) gameRpcError(error, "world lookup");
    if (!data) gameError("NOT_FOUND", "Oyun dünyası bulunamadı.", 404);
    return data as WorldRow;
  }

  private async sessionRow(userId: string, sessionId: string): Promise<HostedSessionRow> {
    if (!UUID_PATTERN.test(sessionId)) gameError("INVALID_REQUEST", "Rota oturumu kimliği geçersiz.");
    const { data, error } = await this.admin().from("route_sessions")
      .select("id,player_id,world_id,location_mode,status,server_nonce_hash,last_received_sequence,last_accepted_sequence,point_count,suspicious_point_count,distance_m,current_segment_index,risk_score,lease_expires_at,started_at,ended_at,duration_seconds")
      .eq("id", sessionId)
      .eq("player_id", userId)
      .maybeSingle();
    if (error) gameRpcError(error, "session lookup");
    if (!data) gameError("NOT_FOUND", "Rota oturumu bulunamadı.", 404);
    return data as HostedSessionRow;
  }

  private async requireSessionIdentity(userId: string, sessionId: string, nonce: string, requireLive = true) {
    const session = await this.sessionRow(userId, sessionId);
    const nonceHash = sha256(nonce);
    if (!nonce || !safeEqualHex(session.server_nonce_hash, nonceHash)) {
      gameError("NONCE_MISMATCH", "Rota oturumu doğrulanamadı.", 403);
    }
    if (process.env.NODE_ENV === "production" && session.location_mode === "development_simulation") {
      gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
    }
    if (requireLive) {
      if (session.status === "revoked") gameError("SESSION_REVOKED", "Rota oturumu güvenlik nedeniyle sonlandırıldı.", 409);
      if (!["active", "paused", "closing"].includes(session.status)) gameError("INVALID_SESSION", "Rota oturumu etkin değil.", 409);
      if (Date.parse(session.lease_expires_at) <= this.clock()) gameError("SESSION_EXPIRED", "Rota oturumunun süresi doldu.", 409);
    }
    return session;
  }

  async startSession(userId: string, mode: CompetitiveLocationMode, correlationId: string = randomUUID()) {
    const nonce = randomBytes(32).toString("base64url");
    const { data, error } = await this.admin().rpc("mrap_game_start_session", {
      p_user_id: userId,
      p_world_slug: this.worldSlugForMode(mode),
      p_mode: mode,
      p_nonce_hash: sha256(nonce),
      p_lease_seconds: this.config.sessions.leaseSeconds,
      p_correlation_id: correlationId,
    });
    if (error) gameRpcError(error, "start session");
    this.throwStructuredRpcError(data, "start session");
    const session = rpcSessionDto(data, nonce);
    await this.bestEffortMetric("route_sessions_started_total");
    return session;
  }

  async takeOverActiveSession(userId: string, mode: CompetitiveLocationMode, correlationId: string = randomUUID()) {
    const nonce = randomBytes(32).toString("base64url");
    const { data, error } = await this.admin().rpc("mrap_game_takeover_session", {
      p_user_id: userId,
      p_world_slug: this.worldSlugForMode(mode),
      p_mode: mode,
      p_nonce_hash: sha256(nonce),
      p_lease_seconds: this.config.sessions.leaseSeconds,
      p_correlation_id: correlationId,
    });
    if (error) gameRpcError(error, "take over session");
    this.throwStructuredRpcError(data, "take over session");
    const session = rpcSessionDto(data, nonce);
    await this.bestEffortMetric("route_sessions_taken_over_total");
    return this.getSessionRecovery({ userId, sessionId: session.id, nonce });
  }

  async beginOnlineSegment(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    expectedCurrentSegmentIndex: number;
    correlationId?: string;
  }) {
    if (!Number.isSafeInteger(input.expectedCurrentSegmentIndex) || input.expectedCurrentSegmentIndex < 0) {
      gameError("INVALID_REQUEST", "Rota segmenti doğrulanamadı.");
    }
    const { data, error } = await this.admin().rpc("mrap_game_begin_segment", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_nonce_hash: sha256(input.nonce),
      p_expected_segment_index: input.expectedCurrentSegmentIndex,
      p_lease_seconds: this.config.sessions.leaseSeconds,
      p_correlation_id: input.correlationId ?? randomUUID(),
    });
    if (error) gameRpcError(error, "begin segment");
    this.throwStructuredRpcError(data, "begin segment");
    await this.bestEffortMetric("route_segments_started_total");
    return rpcSessionDto(data, input.nonce);
  }

  async revokeActiveSessionsForUser(userId: string, correlationId: string = randomUUID()) {
    const { data, error } = await this.admin().rpc("mrap_game_revoke_sessions", {
      p_user_id: userId,
      p_correlation_id: correlationId,
    });
    if (error) gameRpcError(error, "revoke sessions");
    this.throwStructuredRpcError(data, "revoke sessions");
    await this.bestEffortMetric("route_sessions_revoked_total", numeric(data));
    return numeric(data);
  }

  private async acceptedPoints(sessionId: string, throughSequence?: number, segmentIndex?: number) {
    const points: HostedPoint[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.admin().from("route_point_batches")
        .select("points")
        .eq("route_session_id", sessionId)
        .order("first_sequence", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) gameRpcError(error, "route point lookup");
      const rows = data ?? [];
      for (const batch of rows) {
        const rawPoints = Array.isArray(batch.points) ? batch.points : [];
        for (const value of rawPoints) {
          const raw = recordValue(value);
          const classification = raw.classification as PointClassification;
          const sequence = numeric(raw.sequence);
          const pointValue: HostedPoint = {
            sequence,
            latitude: numeric(raw.latitude),
            longitude: numeric(raw.longitude),
            accuracyM: numeric(raw.accuracyM),
            speedMps: raw.speedMps === null || raw.speedMps === undefined ? null : numeric(raw.speedMps),
            clientObservedAt: typeof raw.clientObservedAt === "string" ? raw.clientObservedAt : null,
            receivedAtServer: String(raw.receivedAtServer ?? ""),
            classification,
            reason: typeof raw.reason === "string" ? raw.reason : null,
            segmentIndex: numeric(raw.segmentIndex),
            pointHash: String(raw.pointHash ?? ""),
          };
          if (ACCEPTED_CLASSIFICATIONS.has(classification)
              && (throughSequence === undefined || sequence <= throughSequence)
              && (segmentIndex === undefined || pointValue.segmentIndex === segmentIndex)) {
            points.push(pointValue);
          }
        }
      }
      if (rows.length < pageSize) break;
    }
    return points.sort((left, right) => left.sequence - right.sequence);
  }

  async appendPointBatch(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    idempotencyKey: string;
    points: LocationPointCommand[];
  }): Promise<SupabasePointBatchResult> {
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) gameError("INVALID_REQUEST", "İşlem kimliği geçersiz.");
    if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > this.config.sessions.maximumBatchPoints) {
      gameError("INVALID_REQUEST", "Konum paketi izin verilen nokta sayısını aşıyor.");
    }
    if (input.points.some((value) => !validPoint(value))) gameError("INVALID_REQUEST", "Konum paketinde geçersiz nokta var.");
    for (let index = 1; index < input.points.length; index += 1) {
      if (input.points[index].sequence !== input.points[index - 1].sequence + 1) {
        gameError("SEQUENCE_GAP", "Konum sıra numaraları kesintisiz olmalı.", 409);
      }
    }

    const session = await this.requireSessionIdentity(input.userId, input.sessionId, input.nonce);
    if (session.location_mode === "real_gps" && input.points.some((value) => !value.clientObservedAt)) {
      gameError("INVALID_REQUEST", "Gerçek konum noktalarında gözlem zamanı zorunludur.");
    }
    if (input.points[0].sequence !== numeric(session.last_received_sequence) + 1) {
      // The same idempotency key is resolved atomically by the RPC. Other
      // overlapping sequences are rejected rather than silently rewritten.
      const { data: replay, error: replayError } = await this.admin().from("route_point_batches")
        .select("payload_hash,response_payload")
        .eq("route_session_id", input.sessionId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (replayError) gameRpcError(replayError, "point replay lookup");
      const expectedHash = sha256(JSON.stringify(input.points.map(canonicalPoint)));
      if (replay && replay.payload_hash === expectedHash) return replay.response_payload as SupabasePointBatchResult;
      if (replay) gameError("IDEMPOTENCY_CONFLICT", "Aynı işlem kimliği farklı konum paketiyle kullanılamaz.", 409);
      gameError("SEQUENCE_GAP", "Beklenen konum sıra numarası alınmadı.", 409);
    }
    if (input.points.at(-1)!.sequence > this.config.sessions.maximumPoints) {
      gameError("INVALID_REQUEST", "Rota oturumu nokta sınırını aşıyor.");
    }

    const previousPoints = await this.acceptedPoints(input.sessionId);
    let previousAccepted = previousPoints.at(-1);
    let acceptedCount = 0;
    let ignoredCount = 0;
    let suspiciousCount = 0;
    let lastAcceptedSequence = numeric(session.last_accepted_sequence);
    let distanceIncrementTotalM = 0;
    let currentSegmentIndex = numeric(session.current_segment_index);
    const classifications: SupabasePointBatchResult["classifications"] = [];
    const storedPoints: HostedPoint[] = [];
    const now = this.clock();
    const receivedAt = iso(now);
    const startedAtMs = Date.parse(session.started_at);

    for (const locationPoint of input.points) {
      let classification: PointClassification = "ACCEPTED";
      let reason: string | undefined;
      let calculatedSpeedMps: number | null = null;
      let distanceIncrementM = 0;
      const clientMs = parseIsoMs(locationPoint.clientObservedAt);
      const graceSeconds = numeric(session.last_received_sequence) === 0 && locationPoint.sequence === 1
        ? this.config.location.initialSampleGraceSeconds
        : this.config.location.subsequentSampleGraceSeconds;
      if (locationPoint.accuracyM > this.config.location.maximumAccuracyM) {
        classification = "IGNORED_LOW_ACCURACY";
        reason = "accuracy_limit";
      } else if (session.location_mode === "real_gps" && clientMs !== null && clientMs < startedAtMs - graceSeconds * 1_000) {
        classification = "IGNORED_OUTLIER";
        reason = "before_session_start";
      } else if (session.location_mode === "real_gps" && clientMs !== null && clientMs < now - this.config.location.maximumClientBackfillSeconds * 1_000) {
        classification = "IGNORED_OUTLIER";
        reason = "stale_client_time";
      } else if (session.location_mode === "real_gps" && clientMs !== null && clientMs > now + this.config.location.maximumClientFutureSkewSeconds * 1_000) {
        classification = "IGNORED_OUTLIER";
        reason = "future_client_time";
      } else if (previousAccepted) {
        const travelledM = distance(
          point([previousAccepted.longitude, previousAccepted.latitude]),
          point([locationPoint.longitude, locationPoint.latitude]),
          { units: "meters" },
        );
        const previousClientMs = parseIsoMs(previousAccepted.clientObservedAt);
        const measuredElapsedMs = previousClientMs !== null && clientMs !== null
          ? clientMs - previousClientMs
          : Math.max(1, locationPoint.sequence - previousAccepted.sequence) * 1_000;
        const elapsedMs = session.location_mode === "development_simulation" ? Math.max(measuredElapsedMs, 1_000) : measuredElapsedMs;
        const previousReceivedAtMs = Date.parse(previousAccepted.receivedAtServer);
        let startsNewSegment = previousAccepted.segmentIndex !== currentSegmentIndex;
        if (!startsNewSegment && session.location_mode === "real_gps" && Number.isFinite(previousReceivedAtMs)
            && now - previousReceivedAtMs > this.config.location.maximumTrackingGapSeconds * 1_000) {
          currentSegmentIndex += 1;
          startsNewSegment = true;
        }
        if (startsNewSegment) {
          reason = "tracking_gap_anchor";
        } else if (session.location_mode === "real_gps" && (elapsedMs <= 0 || elapsedMs < this.config.location.minimumPointIntervalMs)) {
          classification = "IGNORED_OUTLIER";
          reason = "non_monotonic_time";
        } else if (travelledM < this.config.location.minimumPointSpacingM) {
          classification = "IGNORED_OUTLIER";
          reason = "duplicate_or_jitter";
        } else {
          calculatedSpeedMps = travelledM / (elapsedMs / 1_000);
          const maximumSpeed = session.location_mode === "real_gps"
            ? this.config.location.maximumRealSpeedMps
            : this.config.location.maximumSimulationSpeedMps;
          if (calculatedSpeedMps > maximumSpeed) {
            classification = "IGNORED_OUTLIER";
            reason = "impossible_speed";
          } else if (session.location_mode === "real_gps"
              && numeric(session.distance_m) + distanceIncrementTotalM + travelledM > this.config.location.maximumRealSpeedMps
                * Math.max(0, (now - startedAtMs) / 1_000) + this.config.location.serverDistanceBudgetSlackM) {
            classification = "IGNORED_OUTLIER";
            reason = "server_distance_budget";
          } else if (session.location_mode === "real_gps" && calculatedSpeedMps > this.config.location.suspiciousRealSpeedMps) {
            classification = "SUSPICIOUS";
            reason = "high_speed";
          } else if (locationPoint.accuracyM > this.config.location.suspiciousAccuracyM) {
            classification = "SUSPICIOUS";
            reason = "weak_accuracy";
          }
          if (previousAccepted.speedMps !== null && calculatedSpeedMps !== null) {
            const acceleration = Math.abs(calculatedSpeedMps - previousAccepted.speedMps) / Math.max(elapsedMs / 1_000, 0.001);
            if (acceleration > this.config.location.maximumAccelerationMps2 && classification === "ACCEPTED") {
              classification = "SUSPICIOUS";
              reason = "high_acceleration";
            }
          }
          if (ACCEPTED_CLASSIFICATIONS.has(classification)) distanceIncrementM = travelledM;
        }
      } else if (locationPoint.accuracyM > this.config.location.suspiciousAccuracyM) {
        classification = "SUSPICIOUS";
        reason = "weak_accuracy";
      }

      const stored: HostedPoint = {
        sequence: locationPoint.sequence,
        latitude: locationPoint.latitude,
        longitude: locationPoint.longitude,
        accuracyM: locationPoint.accuracyM,
        speedMps: calculatedSpeedMps ?? locationPoint.speedMps ?? null,
        clientObservedAt: locationPoint.clientObservedAt ?? null,
        receivedAtServer: receivedAt,
        classification,
        reason: reason ?? null,
        segmentIndex: currentSegmentIndex,
        pointHash: sha256(JSON.stringify(canonicalPoint(locationPoint))),
      };
      storedPoints.push(stored);
      classifications.push({ sequence: locationPoint.sequence, classification, ...(reason ? { reason } : {}) });
      if (ACCEPTED_CLASSIFICATIONS.has(classification)) {
        acceptedCount += 1;
        if (classification === "SUSPICIOUS") suspiciousCount += 1;
        distanceIncrementTotalM += distanceIncrementM;
        lastAcceptedSequence = locationPoint.sequence;
        previousAccepted = stored;
      } else {
        ignoredCount += 1;
      }
    }

    const riskIncrement = classifications.reduce((total, item) => {
      if (item.classification === "SUSPICIOUS") return total + 2;
      if (["impossible_speed", "non_monotonic_time", "server_distance_budget", "before_session_start", "stale_client_time", "future_client_time"].includes(item.reason ?? "")) return total + 5;
      return total;
    }, 0);
    const response: SupabasePointBatchResult = {
      acceptedCount,
      ignoredCount,
      suspiciousCount,
      lastReceivedSequence: input.points.at(-1)!.sequence,
      lastAcceptedSequence,
      classifications,
    };
    const { data, error } = await this.retryIdempotentRpc(() => this.admin().rpc("mrap_game_append_point_batch", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_nonce_hash: sha256(input.nonce),
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: sha256(JSON.stringify(input.points.map(canonicalPoint))),
      p_points: storedPoints,
      p_accepted_count: acceptedCount,
      p_ignored_count: ignoredCount,
      p_suspicious_count: suspiciousCount,
      p_last_accepted_sequence: lastAcceptedSequence,
      p_distance_increment_m: distanceIncrementTotalM,
      p_risk_delta: riskIncrement,
      p_segment_index: currentSegmentIndex,
      p_response_payload: response,
      p_lease_seconds: this.config.sessions.leaseSeconds,
      p_retention_days: this.config.privacy.rawLocationRetentionDays,
    }));
    if (error) gameRpcError(error, "append points");
    this.throwStructuredRpcError(data, "append points");
    await Promise.all([
      this.bestEffortMetric("route_points_accepted_total", acceptedCount),
      this.bestEffortMetric("route_points_ignored_total", ignoredCount),
    ]);
    return recordValue(data) as SupabasePointBatchResult;
  }

  private validatePolygon(polygon: Polygon) {
    if (polygon.type !== "Polygon" || polygon.coordinates.length !== 1) {
      gameError("INVALID_GEOMETRY", "Yalnızca tek halkalı alanlar kabul edilir.", 422);
    }
    const ring = polygon.coordinates[0];
    if (ring.length < 4 || ring.length > this.config.geometry.maximumVertices) {
      gameError("INVALID_GEOMETRY", "Alan nokta sayısı geçersiz.", 422);
    }
    if (ring.some((coordinate) => coordinate.length < 2
        || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])
        || coordinate[0] < -180 || coordinate[0] > 180
        || coordinate[1] < -85.05112878 || coordinate[1] > 85.05112878)) {
      gameError("INVALID_GEOMETRY", "Alan koordinatları geçersiz.", 422);
    }
    const polygonFeature = feature(polygon);
    if (!booleanValid(polygonFeature) || kinks(polygonFeature).features.length > 0) {
      gameError("INVALID_GEOMETRY", "Alan geometrisi geçersiz veya kendi kendini kesiyor.", 422);
    }
    const areaM2 = area(polygonFeature);
    if (!Number.isFinite(areaM2) || areaM2 < this.config.geometry.minimumAreaM2) {
      gameError("INVALID_GEOMETRY", `Alan en az ${this.config.geometry.minimumAreaM2} m² olmalı.`, 422);
    }
    if (areaM2 > this.config.geometry.maximumAreaM2) gameError("CLAIM_TOO_LARGE", "Tek alan talebi sınırı aşıyor.", 413);
    const bounds = bbox(polygonFeature);
    if (bounds[2] - bounds[0] > 180) gameError("INVALID_GEOMETRY", "Antimeridian geçen alan desteklenmiyor.", 422);
    const widthM = distance(point([bounds[0], (bounds[1] + bounds[3]) / 2]), point([bounds[2], (bounds[1] + bounds[3]) / 2]), { units: "meters" });
    const heightM = distance(point([(bounds[0] + bounds[2]) / 2, bounds[1]]), point([(bounds[0] + bounds[2]) / 2, bounds[3]]), { units: "meters" });
    if (Math.max(widthM, heightM) > this.config.geometry.maximumBoundingBoxKm * 1_000) {
      gameError("CLAIM_TOO_LARGE", "Alan coğrafi genişlik sınırını aşıyor.", 413);
    }
    const aspect = Math.max(widthM, heightM) / Math.max(0.01, Math.min(widthM, heightM));
    if (aspect > this.config.geometry.maximumAspectRatio) gameError("INVALID_GEOMETRY", "Aşırı ince alanlar kabul edilmez.", 422);
    return areaM2;
  }

  private async cellRows(worldId: string, options: { ownerId?: string; regionIds?: readonly string[] } = {}) {
    const rows: CellRow[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      let query = this.admin().from("territory_cells")
        .select("cell_id,region_id,owner_id,paint_color_id")
        .eq("world_id", worldId)
        .not("owner_id", "is", null)
        .order("cell_id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (options.ownerId) query = query.eq("owner_id", options.ownerId);
      if (options.regionIds && options.regionIds.length > 0) query = query.in("region_id", [...options.regionIds]);
      const { data, error } = await query;
      if (error) gameRpcError(error, "territory cell lookup");
      const page = (data ?? []) as CellRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  }

  private async currentTerritoryGeometry(userId: string, worldId: string) {
    const { data, error } = await this.admin().rpc("mrap_game_owned_territory", {
      p_user_id: userId,
      p_world_id: worldId,
    });
    if (error) gameRpcError(error, "owned territory geometry");
    const raw = recordValue(data);
    const geometry = raw.geometry;
    if (geometry === null || geometry === undefined) return null;
    return polygonalGeometry(geometry, "Sahip olunan alan");
  }

  async createLoopCandidate(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    lastAcceptedPointSequence: number;
  }) {
    const session = await this.requireSessionIdentity(input.userId, input.sessionId, input.nonce);
    if (input.lastAcceptedPointSequence !== numeric(session.last_accepted_sequence)) {
      gameError("SEQUENCE_GAP", "Döngü yalnızca sunucunun son kabul ettiği nokta için oluşturulabilir.", 409);
    }
    const points = await this.acceptedPoints(
      input.sessionId,
      input.lastAcceptedPointSequence,
      numeric(session.current_segment_index),
    );
    if (points.length < this.config.geometry.minimumIndexGap + 1) {
      gameError("NO_LOOP_AVAILABLE", "Henüz kapatılabilir bir döngü oluşmadı.", 409);
    }
    const suspiciousPoints = points.filter((value) => value.classification === "SUSPICIOUS").length;
    if (suspiciousPoints / points.length > this.config.location.maximumSuspiciousRatio
        || numeric(session.risk_score) >= this.config.location.maximumClaimRiskScore) {
      gameError("INVALID_ROUTE", "Döngü için konum kalitesi yeterli değil; daha açık bir alanda yeniden dene.", 422);
    }
    const detector = new LoopDetector({
      realProximityM: this.config.geometry.realProximityM,
      simulatedProximityM: this.config.geometry.simulatedProximityM,
      minimumAreaM2: this.config.geometry.minimumAreaM2,
      minimumRouteLengthM: this.config.geometry.minimumRouteLengthM,
      minimumIndexGap: this.config.geometry.minimumIndexGap,
      detectionCooldownMs: this.config.geometry.detectionCooldownMs,
    });
    const ownTerritory = await this.currentTerritoryGeometry(input.userId, session.world_id);
    const detected = detector.detect(
      points.map((value) => [value.longitude, value.latitude] as Coordinate),
      session.location_mode === "real_gps" ? "real" : "simulation",
      ownTerritory,
      this.clock(),
    );
    if (!detected.loop) gameError("NO_LOOP_AVAILABLE", "Henüz kapatılabilir geçerli bir döngü oluşmadı.", 409);
    this.validatePolygon(detected.loop.polygon);
    if (detected.loop.estimatedAreaM2 / Math.max(1, detected.loop.routeLengthM) > this.config.geometry.maximumAreaPerRouteMeterM2) {
      gameError("INVALID_GEOMETRY", "Alan ile izlenen rota uzunluğu tutarlı değil.", 422);
    }
    const targetCells = await this.grid.polygonToCells(detected.loop.polygon);
    if (targetCells.length < this.config.geometry.minimumCellCount || targetCells.length > this.config.grid.maximumCandidateCells) {
      gameError("INVALID_GEOMETRY", "Alan canonical hücre sınırlarına uymuyor.", 422);
    }
    const threshold = session.location_mode === "real_gps"
      ? this.config.geometry.realProximityM
      : this.config.geometry.simulatedProximityM;
    const { data, error } = await this.admin().rpc("mrap_game_create_candidate", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_nonce_hash: sha256(input.nonce),
      p_last_accepted_sequence: input.lastAcceptedPointSequence,
      p_start_sequence: points[detected.loop.startIndex]?.sequence ?? points[0].sequence,
      p_source: detected.loop.source,
      // The loop start point is represented by p_start_sequence. This field is
      // the authoritative tracking segment used for point-level claim proof.
      p_source_segment_index: numeric(session.current_segment_index),
      p_coordinates_hash: polygonHash(detected.loop.polygon),
      p_polygon: detected.loop.polygon,
      p_estimated_area_m2: detected.loop.estimatedAreaM2,
      p_route_length_m: detected.loop.routeLengthM,
      p_proximity_threshold_m: threshold,
      p_target_cell_ids: targetCells,
      p_candidate_ttl_seconds: this.config.sessions.candidateTtlSeconds,
    });
    if (error) gameRpcError(error, "create candidate");
    this.throwStructuredRpcError(data, "create candidate");
    await this.bestEffortMetric("loop_candidates_created_total");
    return candidateDto(data);
  }

  async continueCandidate(input: { userId: string; candidateId: string; nonce: string }) {
    if (!UUID_PATTERN.test(input.candidateId)) gameError("INVALID_REQUEST", "Döngü adayı kimliği geçersiz.");
    const { data, error } = await this.admin().rpc("mrap_game_continue_candidate", {
      p_user_id: input.userId,
      p_candidate_id: input.candidateId,
      p_nonce_hash: sha256(input.nonce),
    });
    if (error) gameRpcError(error, "continue candidate");
    this.throwStructuredRpcError(data, "continue candidate");
    await this.bestEffortMetric("loop_candidates_continued_total");
    return candidateDto(data);
  }

  private async regionKeyMap(ids: readonly string[]) {
    const result = new Map<string, string>();
    const unique = [...new Set(ids.filter((id) => UUID_PATTERN.test(id)))];
    if (unique.length === 0) return result;
    try {
      const { data, error } = await this.admin().from("world_regions").select("id,region_key").in("id", unique);
      // This lookup decorates an already committed command response. UUID keys
      // are a safe fallback and must not turn a committed claim into a 500.
      if (error) return result;
      for (const row of data ?? []) result.set(String(row.id), String(row.region_key));
    } catch {
      return result;
    }
    return result;
  }

  async claim(input: { userId: string; nonce: string; command: CloseLoopCommand }): Promise<ClaimResult> {
    if (!UUID_PATTERN.test(input.command.sessionId) || !UUID_PATTERN.test(input.command.candidateId)) {
      gameError("INVALID_REQUEST", "Alan kapatma kimlikleri geçersiz.");
    }
    if (!IDEMPOTENCY_PATTERN.test(input.command.idempotencyKey)) gameError("INVALID_REQUEST", "İşlem kimliği geçersiz.");
    const normalizedColor = input.command.selectedColorId.toUpperCase();
    if (!ROUTE_COLORS.includes(normalizedColor as (typeof ROUTE_COLORS)[number])) {
      gameError("INVALID_COLOR", "Seçilen rota rengi geçersiz.");
    }
    const session = await this.requireSessionIdentity(input.userId, input.command.sessionId, input.nonce);
    if (numeric(session.risk_score) >= this.config.location.maximumClaimRiskScore) {
      gameError("INVALID_ROUTE", "Rota güvenlik doğrulamasından geçemedi.", 422);
    }
    const { data, error } = await this.retryIdempotentRpc(() => this.admin().rpc("mrap_execute_claim_command", {
      p_authoritative_user_id: input.userId,
      p_route_session_id: input.command.sessionId,
      p_loop_candidate_id: input.command.candidateId,
      p_last_accepted_point_sequence: input.command.lastAcceptedPointSequence,
      p_selected_color_id: normalizedColor,
      p_idempotency_key: input.command.idempotencyKey,
      p_payload_hash: commandHash(input.command),
      p_correlation_id: randomUUID(),
    }));
    if (error) gameRpcError(error, "claim territory");
    this.throwStructuredRpcError(data, "claim territory");
    const raw = recordValue(data);
    const rawVersions = recordValue(raw.affectedRegionVersions);
    const keyMap = await this.regionKeyMap(Object.keys(rawVersions));
    const affectedRegionVersions: Record<string, number> = {};
    for (const [regionId, version] of Object.entries(rawVersions)) {
      affectedRegionVersions[keyMap.get(regionId) ?? regionId] = numeric(version);
    }
    const rawCaptured = Array.isArray(raw.capturedFrom) ? raw.capturedFrom : [];
    const noOp = raw.noOp === true;
    const claimEventId = String(raw.claimEventId ?? `${noOp ? "noop" : "rejected"}-${String(raw.commandId ?? "unknown")}`);
    let committedAtServer = iso(this.clock());
    if (UUID_PATTERN.test(claimEventId) && raw.claimEventId) {
      try {
        const { data: event } = await this.admin().from("claim_events")
          .select("committed_at_server").eq("id", claimEventId).maybeSingle();
        if (event?.committed_at_server) committedAtServer = String(event.committed_at_server);
      } catch {
        // The authoritative result already committed; server time is a safe
        // presentation fallback when this optional read is unavailable.
      }
    }
    await Promise.all([
      !noOp && raw.status !== "rejected" ? this.bestEffortMetric("claims_committed_total") : Promise.resolve(),
      !noOp && raw.status !== "rejected" ? this.bestEffortPublishOutbox() : Promise.resolve(),
    ]);
    return {
      claimEventId,
      status: noOp ? "rejected" : raw.status === "partially_accepted" ? "partially_accepted" : raw.status === "rejected" ? "rejected" : "accepted",
      newlyClaimedAreaM2: numeric(raw.newlyClaimedAreaM2),
      capturedFromOthersAreaM2: numeric(raw.capturedFromOthersAreaM2),
      alreadyOwnedAreaM2: numeric(raw.alreadyOwnedAreaM2),
      restrictedAreaM2: numeric(raw.restrictedAreaM2),
      totalLoopAreaM2: numeric(raw.totalLoopAreaM2),
      finalTerritoryAreaM2: numeric(raw.finalTerritoryAreaM2),
      affectedRegionVersions,
      capturedFrom: rawCaptured.map((value) => {
        const item = recordValue(value);
        return { userId: String(item.userId ?? ""), areaM2: numeric(item.areaM2) };
      }).filter((value) => UUID_PATTERN.test(value.userId)),
      committedAtServer,
      concurrentRecalculation: false,
    };
  }

  async finishSession(input: { userId: string; sessionId: string; nonce: string }) {
    const { data, error } = await this.admin().rpc("mrap_game_finish_session", {
      p_user_id: input.userId,
      p_session_id: input.sessionId,
      p_nonce_hash: sha256(input.nonce),
    });
    if (error) gameRpcError(error, "finish session");
    this.throwStructuredRpcError(data, "finish session");
    const raw = recordValue(data);
    const route = recordValue(raw.route);
    await this.bestEffortMetric("route_sessions_finished_total");
    return {
      session: rpcSessionDto(raw.session, input.nonce),
      route: {
        distanceM: numeric(route.distanceM),
        durationSeconds: numeric(route.durationSeconds),
        acceptedPointCount: numeric(route.acceptedPointCount),
        closedClaimCount: numeric(route.closedClaimCount),
      },
    };
  }

  async getCommandResult(userId: string, idempotencyKey: string) {
    if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) gameError("INVALID_REQUEST", "İşlem kimliği geçersiz.");
    const { data, error } = await this.admin().from("claim_commands")
      .select("status,result_payload,error_code,completed_at")
      .eq("user_id", userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) gameRpcError(error, "claim command lookup");
    if (!data) gameError("NOT_FOUND", "Alan talebi komutu bulunamadı.", 404);
    const status = String(data.status);
    const pipeline: ClaimPipelineStatus[] = ["RECEIVED"];
    if (status !== "RECEIVED") pipeline.push(status as ClaimPipelineStatus);
    const rawResult = data.result_payload ? recordValue(data.result_payload) : null;
    let result: ClaimResult | null = null;
    if (rawResult) {
      const rawVersions = recordValue(rawResult.affectedRegionVersions);
      const keyMap = await this.regionKeyMap(Object.keys(rawVersions));
      const affectedRegionVersions: Record<string, number> = {};
      for (const [regionId, version] of Object.entries(rawVersions)) {
        affectedRegionVersions[keyMap.get(regionId) ?? regionId] = numeric(version);
      }
      const rawCaptured = Array.isArray(rawResult.capturedFrom) ? rawResult.capturedFrom : [];
      const noOp = rawResult.noOp === true;
      result = {
        claimEventId: String(rawResult.claimEventId ?? `${noOp ? "noop" : "rejected"}-${String(rawResult.commandId ?? "unknown")}`),
        status: noOp ? "rejected" : rawResult.status === "partially_accepted" ? "partially_accepted" : rawResult.status === "rejected" ? "rejected" : "accepted",
        newlyClaimedAreaM2: numeric(rawResult.newlyClaimedAreaM2),
        capturedFromOthersAreaM2: numeric(rawResult.capturedFromOthersAreaM2),
        alreadyOwnedAreaM2: numeric(rawResult.alreadyOwnedAreaM2),
        restrictedAreaM2: numeric(rawResult.restrictedAreaM2),
        totalLoopAreaM2: numeric(rawResult.totalLoopAreaM2),
        finalTerritoryAreaM2: numeric(rawResult.finalTerritoryAreaM2),
        affectedRegionVersions,
        capturedFrom: rawCaptured.map((value) => {
          const item = recordValue(value);
          return { userId: String(item.userId ?? ""), areaM2: numeric(item.areaM2) };
        }).filter((value) => UUID_PATTERN.test(value.userId)),
        committedAtServer: String(data.completed_at ?? iso(this.clock())),
        concurrentRecalculation: false,
      };
    }
    return {
      status,
      pipeline,
      result,
      errorCode: data.error_code,
      completedAt: data.completed_at,
    };
  }

  async getSessionWorld(userId: string, sessionId: string) {
    const session = await this.sessionRow(userId, sessionId);
    return (await this.worldById(session.world_id)).slug;
  }

  async getSessionRecovery(input: { userId: string; sessionId: string; nonce: string }): Promise<RouteSessionRecoveryDto> {
    const session = await this.requireSessionIdentity(input.userId, input.sessionId, input.nonce);
    const [world, points, claimResult, candidateResult] = await Promise.all([
      this.worldById(session.world_id),
      this.acceptedPoints(input.sessionId, undefined, numeric(session.current_segment_index)),
      this.admin().from("claim_events").select("id", { count: "exact", head: true }).eq("route_session_id", input.sessionId).eq("status", "committed"),
      this.admin().from("loop_candidates")
        .select("id,route_session_id,start_sequence,end_sequence,source_segment_index,coordinates_hash,estimated_area_m2,route_length_m,detected_at_server,expires_at,status")
        .eq("route_session_id", input.sessionId)
        .eq("status", "available")
        .gt("expires_at", iso(this.clock()))
        .order("end_sequence", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (claimResult.error) gameRpcError(claimResult.error, "claim count");
    if (candidateResult.error) gameRpcError(candidateResult.error, "candidate recovery");
    const candidate = candidateResult.data ? candidateDto({
      id: candidateResult.data.id,
      sessionId: candidateResult.data.route_session_id,
      startSequence: candidateResult.data.start_sequence,
      endSequence: candidateResult.data.end_sequence,
      sourceSegmentIndex: candidateResult.data.source_segment_index,
      coordinatesHash: candidateResult.data.coordinates_hash,
      estimatedAreaM2: candidateResult.data.estimated_area_m2,
      routeLengthM: candidateResult.data.route_length_m,
      detectedAtServer: candidateResult.data.detected_at_server,
      expiresAt: candidateResult.data.expires_at,
      status: candidateResult.data.status,
    }) : null;
    return {
      session: sessionDto(session, world.slug, input.nonce),
      currentSegmentPoints: points.map((value) => ({
        coordinate: [value.longitude, value.latitude],
        accuracyM: value.accuracyM,
        timestamp: parseIsoMs(value.clientObservedAt) ?? parseIsoMs(value.receivedAtServer) ?? this.clock(),
      })),
      totalDistanceM: numeric(session.distance_m),
      claimCount: claimResult.count ?? 0,
      elapsedSeconds: Math.max(0, Math.floor((this.clock() - Date.parse(session.started_at)) / 1_000)),
      availableCandidate: candidate,
    };
  }

  private validateRegions(regionIds: readonly string[]) {
    const unique = [...new Set(regionIds)].sort();
    if (unique.length < 1 || unique.length > this.config.grid.maximumViewportRegions
        || unique.some((id) => !REGION_PATTERN.test(id) || Number(id.split("/")[0]) !== this.config.grid.regionZoom)) {
      gameError("INVALID_REQUEST", "Görünür harita bölgeleri geçersiz.");
    }
    return unique;
  }

  private async regionRows(worldId: string, regionKeys: readonly string[]) {
    const { data, error } = await this.admin().from("world_regions")
      .select("id,region_key,version")
      .eq("world_id", worldId)
      .in("region_key", [...regionKeys]);
    if (error) gameRpcError(error, "region lookup");
    return (data ?? []).map((value) => ({
      id: String(value.id),
      regionKey: String(value.region_key),
      version: numeric(value.version),
    }));
  }

  private async profilesById(ownerIds: readonly string[]) {
    const profiles = new Map<string, { username: string; color: string; pattern: number }>();
    const unique = [...new Set(ownerIds)];
    for (let offset = 0; offset < unique.length; offset += 200) {
      const { data, error } = await this.admin().from("profiles")
        .select("id,username,color,pattern")
        .in("id", unique.slice(offset, offset + 200));
      if (error) gameRpcError(error, "territory owner lookup");
      for (const profile of data ?? []) profiles.set(String(profile.id), {
        username: String(profile.username),
        color: String(profile.color),
        pattern: numeric(profile.pattern),
      });
    }
    return profiles;
  }

  async getRegionSnapshot(worldSlug: string, regionIds: readonly string[]): Promise<RegionSnapshotWithCells> {
    const uniqueRegions = this.validateRegions(regionIds);
    const world = await this.worldBySlug(worldSlug);
    // Cursor-first is intentional: any commit that races the following snapshot
    // reads has a sequence greater than this cursor and is replayed. Reading the
    // cursor last could permanently skip an event represented by neither view.
    const { data: latest, error: latestError } = await this.admin().from("realtime_outbox")
      .select("sequence")
      .eq("world_id", world.id)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) gameRpcError(latestError, "outbox cursor lookup");
    const regionRows = await this.regionRows(world.id, uniqueRegions);
    const regionKeyById = new Map(regionRows.map((value) => [value.id, value.regionKey]));
    const versions: Record<string, number> = Object.fromEntries(uniqueRegions.map((key) => [key, 0]));
    for (const region of regionRows) versions[region.regionKey] = region.version;
    const rows = regionRows.length > 0 ? await this.cellRows(world.id, { regionIds: regionRows.map((value) => value.id) }) : [];
    const profiles = await this.profilesById(rows.map((value) => value.owner_id));
    return {
      worldId: world.slug,
      versions,
      cells: rows.map((value) => ({
        cellId: value.cell_id,
        regionId: regionKeyById.get(value.region_id) ?? value.region_id,
        ownerId: value.owner_id,
        ownerUsername: profiles.get(value.owner_id)?.username ?? "mrap",
        paintColorId: value.paint_color_id,
      })),
      latestOutboxSequence: numeric(latest?.sequence),
      mapState: await this.getMapState(world.slug, uniqueRegions),
      generatedAtServer: iso(this.clock()),
    };
  }

  async listRegionEvents(worldSlug: string, regionIds: readonly string[], afterSequence: number, limit = 200) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) gameError("INVALID_REQUEST", "Gerçek zamanlı akış sıra değeri geçersiz.");
    const uniqueRegions = this.validateRegions(regionIds);
    const world = await this.worldBySlug(worldSlug);
    const regions = await this.regionRows(world.id, uniqueRegions);
    if (regions.length === 0) return [];
    const keyById = new Map(regions.map((value) => [value.id, value.regionKey]));
    const { data, error } = await this.admin().from("realtime_outbox")
      .select("sequence,region_id,payload")
      .eq("world_id", world.id)
      .in("region_id", regions.map((value) => value.id))
      .gt("sequence", afterSequence)
      .order("sequence", { ascending: true })
      .limit(Math.min(Math.max(limit, 1), 1_000));
    if (error) gameRpcError(error, "region event lookup");
    return (data ?? []).map((row) => {
      const payload = recordValue(row.payload);
      const regionKey = keyById.get(String(row.region_id)) ?? String(row.region_id);
      const event: RegionPatchEvent = {
        eventId: String(payload.eventId ?? randomUUID()),
        type: "region_patch",
        worldId: world.slug,
        regionId: regionKey,
        previousVersion: numeric(payload.previousVersion),
        version: numeric(payload.version),
        claimEventId: String(payload.claimEventId ?? ""),
        ...(Array.isArray(payload.changedCells) ? { changedCells: payload.changedCells.map((value) => {
          const item = recordValue(value);
          return {
            cellId: String(item.cellId ?? ""),
            ownerId: item.ownerId ? String(item.ownerId) : null,
            paintColorId: item.paintColorId ? String(item.paintColorId) : null,
          };
        }) } : {}),
        ...(payload.requiresRefetch === true ? { requiresRefetch: true } : {}),
        committedAtServer: String(payload.committedAtServer ?? iso(this.clock())),
      };
      return { sequence: numeric(row.sequence), event };
    });
  }

  async getMapState(worldSlug: string, regionIds?: readonly string[]): Promise<TerritoryMapState> {
    if (!regionIds || regionIds.length === 0) {
      gameError("INVALID_REQUEST", "Harita görünümü için bölge kapsamı gerekli.");
    }
    const world = await this.worldBySlug(worldSlug);
    const references = [...new Set(regionIds)];
    if (references.length > this.config.grid.maximumViewportRegions
        || references.some((value) => !UUID_PATTERN.test(value) && !REGION_PATTERN.test(value))) {
      gameError("INVALID_REQUEST", "Harita bölge kapsamı geçersiz.");
    }
    // Claim response decoration is best-effort after commit. If the optional
    // region-key lookup failed there, its trusted UUID still provides a safe,
    // bounded scope for this render refresh.
    const regionKeys = references.filter((value) => REGION_PATTERN.test(value));
    const scopedRegionIds = [
      ...references.filter((value) => UUID_PATTERN.test(value)),
      ...(regionKeys.length > 0 ? await this.regionRows(world.id, regionKeys) : []).map((value) => value.id),
    ];
    if (scopedRegionIds.length === 0) return { territories: [], paints: [] };
    const { data, error } = await this.admin().rpc("mrap_game_region_map_state", {
      p_world_id: world.id,
      p_region_ids: scopedRegionIds,
    });
    if (error) gameRpcError(error, "region map state");
    const payload = recordValue(data);
    if (!Array.isArray(payload.territories) || !Array.isArray(payload.paints)) {
      gameError("INVALID_GEOMETRY", "Harita alanları okunamadı.", 500);
    }
    const territories: CurrentTerritory[] = payload.territories.map((value) => {
      const row = recordValue(value);
      return {
        userId: String(row.userId ?? ""),
        ownerUsername: String(row.ownerUsername ?? "mrap"),
        geometry: polygonalGeometry(row.geometry, "Sahiplik"),
        areaM2: numeric(row.areaM2),
        color: String(row.color ?? "#1488FF"),
        pattern: numeric(row.pattern),
        updatedAt: String(row.updatedAt ?? iso(this.clock())),
      };
    });
    const paints: TerritoryPaint[] = payload.paints.map((value) => {
      const row = recordValue(value);
      return {
        id: String(row.id ?? ""),
        userId: String(row.userId ?? ""),
        geometry: polygonalGeometry(row.geometry, "Boya"),
        color: String(row.color ?? "#1488FF"),
        updatedAt: String(row.updatedAt ?? iso(this.clock())),
      };
    });
    return { territories, paints };
  }

  async consumeRateLimit(scopeKey: string, maximumHits: number, windowMs: number) {
    const { data, error } = await this.admin().rpc("mrap_consume_rate_limit", {
      p_scope_hash: sha256(scopeKey),
      p_maximum_hits: maximumHits,
      p_window_ms: windowMs,
    });
    if (error) gameRpcError(error, "rate limit");
    const first = Array.isArray(data) ? recordValue(data[0]) : recordValue(data);
    return {
      allowed: first.allowed === true,
      remaining: numeric(first.remaining),
      retryAfterSeconds: numeric(first.retry_after_seconds),
    };
  }

  async health() {
    const { data, error } = await this.admin().rpc("mrap_game_health");
    if (error) gameRpcError(error, "game health");
    return recordValue(data);
  }

  private async bestEffortMetric(key: string, amount = 1) {
    if (!/^[a-z0-9_]{3,80}$/.test(key) || !Number.isSafeInteger(amount) || amount <= 0) return;
    try {
      // Telemetry is deliberately outside the authoritative result path. A
      // committed mutation must never be reported as failed because metrics are
      // unavailable.
      await this.admin().rpc("mrap_game_record_metric", {
        p_metric_key: key,
        p_amount: amount,
      });
    } catch {
      // Best effort by contract; never include identifiers or payloads in logs.
    }
  }

  private async bestEffortPublishOutbox(limit = 100) {
    try {
      await this.admin().rpc("mrap_game_publish_outbox", {
        p_limit: Math.min(Math.max(Math.trunc(limit), 1), 500),
      });
    } catch {
      // Region polling replays the durable outbox if Broadcast is unavailable.
    }
  }

  async recordMetric(key: string, amount = 1) {
    await this.bestEffortMetric(key, amount);
  }

  async purgeExpiredRawLocations(now = this.clock()) {
    if (!Number.isFinite(now)) gameError("INVALID_REQUEST", "Konum saklama zamanı geçersiz.");
    const { data, error } = await this.admin().rpc("purge_expired_location_data", { p_limit: 25_000 });
    if (error) gameRpcError(error, "purge raw locations");
    return numeric(recordValue(data).deletedBatches);
  }
}
