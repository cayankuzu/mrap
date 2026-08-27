import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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
  ClaimResult,
  ClaimPipelineStatus,
  CloseLoopCommand,
  CompetitiveLocationMode,
  LocationPointCommand,
  LoopCandidateDto,
  PointClassification,
  RegionPatchEvent,
  RegionSnapshot,
  RouteSessionRecoveryDto,
  RouteSessionDto,
} from "@/lib/game/authoritative-types";
import type { Coordinate } from "@/lib/game/types";
import type { CurrentTerritory, TerritoryMapState, TerritoryPaint } from "@/lib/models";
import { TileOwnershipGrid, type SpatialOwnershipGrid } from "@/lib/spatial/ownership-grid";
import {
  AUTHORITATIVE_GAME_CONFIG,
  type AuthoritativeGameConfig,
} from "@/server/game/authoritative-config";
import { AuthoritativeGameError, gameError } from "@/server/game/authoritative-error";
import { incrementMetric, safeRiskEvent } from "@/server/game/safe-telemetry";

const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9_-]{16,100}$/;
const REGION_PATTERN = /^(?:[1-9]|1\d|2[0-6])\/(?:0|[1-9]\d{0,7})\/(?:0|[1-9]\d{0,7})$/;
const ACCEPTED_CLASSIFICATIONS = new Set<PointClassification>(["ACCEPTED", "SUSPICIOUS"]);

type SessionRow = {
  id: string;
  user_id: string;
  world_id: string;
  mode: CompetitiveLocationMode;
  status: RouteSessionDto["status"];
  server_nonce_hash: string;
  last_received_sequence: number;
  last_accepted_sequence: number;
  accepted_point_count: number;
  suspicious_point_count: number;
  accepted_distance_m: number;
  current_segment_index: number;
  risk_score: number;
  lease_expires_at: string;
  started_at_server: string;
  finished_at_server: string | null;
};

type PointRow = {
  sequence: number;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  speed_mps: number | null;
  client_observed_at: string | null;
  received_at_server: string;
  classification: PointClassification;
  classification_reason: string | null;
  segment_index: number;
};

type CandidateRow = {
  id: string;
  session_id: string;
  user_id: string;
  start_sequence: number;
  end_sequence: number;
  source_segment_index: number;
  source: "ACTIVE_ROUTE" | "OWN_TERRITORY";
  coordinates_hash: string;
  polygon_json: string;
  estimated_area_m2: number;
  route_length_m: number;
  status: LoopCandidateDto["status"];
  detected_at_server: string;
  expires_at: string;
};

type CellRow = {
  cell_id: string;
  region_id: string;
  owner_id: string;
  paint_color_id: string;
  area_m2: number;
  owner_changed_at: string;
  paint_changed_at: string;
};

type PointBatchResult = {
  acceptedCount: number;
  ignoredCount: number;
  suspiciousCount: number;
  lastReceivedSequence: number;
  lastAcceptedSequence: number;
  classifications: Array<{ sequence: number; classification: PointClassification; reason?: string }>;
};

type FinishedRoute = {
  distanceM: number;
  durationSeconds: number;
  acceptedPointCount: number;
  closedClaimCount: number;
};

export type RegionSnapshotWithCells = RegionSnapshot & {
  cells: Array<{ cellId: string; regionId: string; ownerId: string; ownerUsername: string; paintColorId: string }>;
  latestOutboxSequence: number;
  mapState: TerritoryMapState;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPoint(pointValue: LocationPointCommand) {
  return {
    sequence: pointValue.sequence,
    latitude: pointValue.latitude,
    longitude: pointValue.longitude,
    accuracyM: pointValue.accuracyM,
    altitudeM: pointValue.altitudeM ?? null,
    speedMps: pointValue.speedMps ?? null,
    heading: pointValue.heading ?? null,
    clientObservedAt: pointValue.clientObservedAt ?? null,
  };
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

function iso(nowMs: number) {
  return new Date(nowMs).toISOString();
}

function parseIsoMs(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
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

function ensureIdempotencyKey(value: string) {
  if (!IDEMPOTENCY_PATTERN.test(value)) gameError("INVALID_REQUEST", "İşlem kimliği geçersiz.");
}

function validRegionId(value: string, expectedZoom: number) {
  if (!REGION_PATTERN.test(value)) return false;
  const [zoom, x, y] = value.split("/").map(Number);
  const edge = 2 ** expectedZoom;
  return zoom === expectedZoom && x >= 0 && x < edge && y >= 0 && y < edge;
}

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionDto(row: SessionRow, nonce: string): RouteSessionDto {
  return {
    id: row.id,
    worldId: row.world_id,
    mode: row.mode,
    status: row.status,
    serverNonce: nonce,
    lastReceivedSequence: row.last_received_sequence,
    lastAcceptedSequence: row.last_accepted_sequence,
    currentSegmentIndex: row.current_segment_index,
    riskScore: row.risk_score,
    leaseExpiresAt: row.lease_expires_at,
    startedAtServer: row.started_at_server,
  };
}

function candidateDto(row: CandidateRow): LoopCandidateDto {
  return {
    id: row.id,
    sessionId: row.session_id,
    startSequence: row.start_sequence,
    endSequence: row.end_sequence,
    sourceSegmentIndex: row.source_segment_index,
    coordinatesHash: row.coordinates_hash,
    estimatedAreaM2: row.estimated_area_m2,
    routeLengthM: row.route_length_m,
    detectedAtServer: row.detected_at_server,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

function pointCoordinate(row: PointRow): Coordinate {
  return [row.longitude, row.latitude];
}

function rollback(database: DatabaseSync) {
  try { database.exec("ROLLBACK"); } catch { /* no active transaction */ }
}

function pipeline(...statuses: ClaimPipelineStatus[]) {
  return JSON.stringify(statuses);
}

export class AuthoritativeGameStore {
  readonly grid: SpatialOwnershipGrid;

  constructor(
    private readonly database: DatabaseSync,
    private readonly config: AuthoritativeGameConfig = AUTHORITATIVE_GAME_CONFIG,
    grid?: SpatialOwnershipGrid,
    private readonly clock: () => number = Date.now,
  ) {
    this.grid = grid ?? new TileOwnershipGrid(config.grid);
  }

  startSession(userId: string, mode: CompetitiveLocationMode, correlationId: string = randomUUID()) {
    if (mode === "development_simulation" && process.env.NODE_ENV === "production") {
      gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
    }
    const worldId = mode === "development_simulation" ? this.config.worlds.development : this.config.worlds.production;
    const now = this.clock();
    const startedAt = iso(now);
    const expiresAt = iso(now + this.config.sessions.leaseSeconds * 1_000);
    const sessionId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    this.purgeExpiredRawLocations(now);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE competitive_route_sessions
        SET status = 'expired', updated_at = ?
        WHERE user_id = ? AND world_id = ? AND status IN ('active', 'paused', 'closing') AND lease_expires_at <= ?
      `).run(startedAt, userId, worldId, startedAt);
      const active = this.database.prepare(`
        SELECT id FROM competitive_route_sessions
        WHERE user_id = ? AND world_id = ? AND status IN ('active', 'paused', 'closing')
      `).get(userId, worldId);
      if (active) gameError("SESSION_CONFLICT", "Bu dünyada zaten etkin bir rota oturumun var.", 409);
      this.database.prepare(`
        INSERT INTO competitive_route_sessions
          (id, user_id, world_id, mode, status, server_nonce_hash, lease_expires_at, started_at_server)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(sessionId, userId, worldId, mode, sha256(nonce), expiresAt, startedAt);
      this.database.prepare(`
        INSERT INTO audit_events (id, correlation_id, user_id, action, outcome, safe_context_json)
        VALUES (?, ?, ?, 'route_session_start', 'accepted', ?)
      `).run(randomUUID(), correlationId, userId, JSON.stringify({ worldId, mode }));
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    incrementMetric(this.database, "route_sessions_started_total");
    return sessionDto(this.getSessionRow(sessionId)!, nonce);
  }

  takeOverActiveSession(userId: string, mode: CompetitiveLocationMode, correlationId: string = randomUUID()) {
    if (mode === "development_simulation" && process.env.NODE_ENV === "production") {
      gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
    }
    const worldId = mode === "development_simulation" ? this.config.worlds.development : this.config.worlds.production;
    const now = this.clock();
    const changedAt = iso(now);
    const nonce = randomBytes(32).toString("base64url");
    let sessionId = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE competitive_route_sessions
        SET status = 'expired', updated_at = ?
        WHERE user_id = ? AND world_id = ? AND status IN ('active', 'paused', 'closing') AND lease_expires_at <= ?
      `).run(changedAt, userId, worldId, changedAt);
      const active = this.database.prepare(`
        SELECT id FROM competitive_route_sessions
        WHERE user_id = ? AND world_id = ? AND mode = ? AND status IN ('active', 'paused', 'closing')
        ORDER BY started_at_server DESC LIMIT 1
      `).get(userId, worldId, mode) as { id: string } | undefined;
      if (!active) gameError("NOT_FOUND", "Devralınabilecek etkin rota oturumu bulunamadı.", 404);
      sessionId = active.id;
      const updated = this.database.prepare(`
        UPDATE competitive_route_sessions
        SET status = 'active', server_nonce_hash = ?, current_segment_index = current_segment_index + 1,
            lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status IN ('active', 'paused', 'closing')
      `).run(
        sha256(nonce),
        iso(now + this.config.sessions.leaseSeconds * 1_000),
        changedAt,
        sessionId,
        userId,
      );
      if (updated.changes !== 1) gameError("CONFLICT", "Rota oturumu eşzamanlı başka bir işlemde değişti.", 409);
      this.database.prepare("UPDATE loop_candidates SET status = 'expired' WHERE session_id = ? AND status = 'available'").run(sessionId);
      this.database.prepare(`
        INSERT INTO audit_events (id, correlation_id, user_id, action, outcome, safe_context_json)
        VALUES (?, ?, ?, 'route_session_takeover', 'accepted', ?)
      `).run(randomUUID(), correlationId, userId, JSON.stringify({ worldId, mode, sessionId }));
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    incrementMetric(this.database, "route_sessions_taken_over_total");
    return this.getSessionRecovery({ userId, sessionId, nonce });
  }

  beginOnlineSegment(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    expectedCurrentSegmentIndex: number;
    correlationId?: string;
  }) {
    if (!Number.isSafeInteger(input.expectedCurrentSegmentIndex) || input.expectedCurrentSegmentIndex < 0) {
      gameError("INVALID_REQUEST", "Rota segmenti doğrulanamadı.");
    }
    const now = this.clock();
    const changedAt = iso(now);
    let changed = false;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const session = this.requireSession(input.sessionId, input.userId, input.nonce, now);
      if (session.current_segment_index === input.expectedCurrentSegmentIndex) {
        const updated = this.database.prepare(`
          UPDATE competitive_route_sessions
          SET current_segment_index = current_segment_index + 1, updated_at = ?
          WHERE id = ? AND user_id = ? AND current_segment_index = ?
        `).run(changedAt, input.sessionId, input.userId, input.expectedCurrentSegmentIndex);
        if (updated.changes !== 1) gameError("CONFLICT", "Rota segmenti eşzamanlı başka bir işlemde değişti.", 409, true);
        this.database.prepare("UPDATE loop_candidates SET status = 'expired' WHERE session_id = ? AND status = 'available'").run(input.sessionId);
        this.database.prepare(`
          INSERT INTO audit_events (id, correlation_id, user_id, action, outcome, safe_context_json)
          VALUES (?, ?, ?, 'route_session_online_segment', 'accepted', ?)
        `).run(
          randomUUID(),
          input.correlationId ?? randomUUID(),
          input.userId,
          JSON.stringify({ sessionId: input.sessionId, previousSegmentIndex: input.expectedCurrentSegmentIndex }),
        );
        changed = true;
      } else if (session.current_segment_index !== input.expectedCurrentSegmentIndex + 1) {
        gameError("CONFLICT", "Rota segmenti beklenen sırada değil.", 409);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    if (changed) incrementMetric(this.database, "route_online_segments_started_total");
    return sessionDto(this.getSessionRow(input.sessionId)!, input.nonce);
  }

  /**
   * Logout must not leave a nonce-less competitive lease behind. Revoke the
   * user's unfinished sessions and remove raw points before the auth cookie is
   * destroyed. Claimed territory and immutable claim history are untouched.
   */
  revokeActiveSessionsForUser(userId: string, correlationId: string = randomUUID()) {
    const revokedAt = iso(this.clock());
    const hasActiveSession = this.database.prepare(`
      SELECT 1 AS present FROM competitive_route_sessions
      WHERE user_id = ? AND status IN ('active', 'paused', 'closing')
      LIMIT 1
    `).get(userId) as { present: number } | undefined;
    if (!hasActiveSession) return 0;
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const activeSessions = this.database.prepare(`
        SELECT id FROM competitive_route_sessions
        WHERE user_id = ? AND status IN ('active', 'paused', 'closing')
      `).all(userId) as Array<{ id: string }>;
      if (activeSessions.length === 0) {
        this.database.exec("COMMIT");
        return 0;
      }

      this.database.prepare(`
        UPDATE loop_candidates
        SET status = 'expired'
        WHERE user_id = ? AND status = 'available'
          AND session_id IN (
            SELECT id FROM competitive_route_sessions
            WHERE user_id = ? AND status IN ('active', 'paused', 'closing')
          )
      `).run(userId, userId);
      this.database.prepare(`
        DELETE FROM route_points
        WHERE session_id IN (
          SELECT id FROM competitive_route_sessions
          WHERE user_id = ? AND status IN ('active', 'paused', 'closing')
        )
      `).run(userId);
      const result = this.database.prepare(`
        UPDATE competitive_route_sessions
        SET status = 'revoked', finished_at_server = COALESCE(finished_at_server, ?), updated_at = ?
        WHERE user_id = ? AND status IN ('active', 'paused', 'closing')
      `).run(revokedAt, revokedAt, userId);
      this.database.prepare(`
        INSERT INTO audit_events (id, correlation_id, user_id, action, outcome, safe_context_json)
        VALUES (?, ?, ?, 'route_sessions_logout_revoke', 'accepted', ?)
      `).run(randomUUID(), correlationId, userId, JSON.stringify({ revokedSessionCount: Number(result.changes) }));
      this.database.exec("COMMIT");
      incrementMetric(this.database, "route_sessions_logout_revoked_total", Number(result.changes));
      return Number(result.changes);
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  appendPointBatch(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    idempotencyKey: string;
    points: LocationPointCommand[];
  }): PointBatchResult {
    ensureIdempotencyKey(input.idempotencyKey);
    if (!Array.isArray(input.points) || input.points.length < 1 || input.points.length > this.config.sessions.maximumBatchPoints) {
      gameError("INVALID_REQUEST", "Konum paketi izin verilen nokta sayısını aşıyor.");
    }
    if (input.points.some((value) => !validPoint(value))) gameError("INVALID_REQUEST", "Konum paketinde geçersiz nokta var.");
    for (let index = 1; index < input.points.length; index += 1) {
      if (input.points[index].sequence !== input.points[index - 1].sequence + 1) gameError("SEQUENCE_GAP", "Konum sıra numaraları kesintisiz olmalı.", 409);
    }
    const payloadHash = sha256(JSON.stringify(input.points.map(canonicalPoint)));
    const now = this.clock();
    const receivedAt = iso(now);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.requireSessionIdentity(input.sessionId, input.userId, input.nonce);
      const previousBatch = this.database.prepare(`
        SELECT payload_hash, response_json FROM route_point_batches
        WHERE session_id = ? AND user_id = ? AND idempotency_key = ?
      `).get(input.sessionId, input.userId, input.idempotencyKey) as { payload_hash: string; response_json: string } | undefined;
      if (previousBatch) {
        if (previousBatch.payload_hash !== payloadHash) {
          safeRiskEvent(this.database, {
            userId: input.userId,
            sessionId: input.sessionId,
            category: "point_batch_idempotency_tamper",
            severity: "critical",
            context: { pointCount: input.points.length },
          });
          this.database.prepare("UPDATE competitive_route_sessions SET risk_score = risk_score + 25 WHERE id = ?").run(input.sessionId);
          this.database.exec("COMMIT");
          gameError("IDEMPOTENCY_CONFLICT", "Aynı işlem kimliği farklı bir konum paketiyle kullanıldı.", 409);
        }
        const result = JSON.parse(previousBatch.response_json) as PointBatchResult;
        this.database.exec("COMMIT");
        return result;
      }
      const session = this.requireSession(input.sessionId, input.userId, input.nonce, now);
      if (session.mode === "real_gps" && input.points.some((locationPoint) => !locationPoint.clientObservedAt)) {
        gameError("INVALID_REQUEST", "Gerçek konum noktalarında gözlem zamanı zorunludur.");
      }
      if (input.points[0].sequence <= session.last_received_sequence) {
        const existingPoint = this.database.prepare(`
          SELECT point_hash, classification, classification_reason FROM route_points
          WHERE session_id = ? AND sequence = ?
        `);
        const existing = input.points.map((locationPoint) => existingPoint.get(input.sessionId, locationPoint.sequence) as {
          point_hash: string;
          classification: PointClassification;
          classification_reason: string | null;
        } | undefined);
        const exactReplay = existing.every((row, index) => row?.point_hash === sha256(JSON.stringify(canonicalPoint(input.points[index]))));
        if (!exactReplay) {
          safeRiskEvent(this.database, {
            userId: input.userId,
            sessionId: input.sessionId,
            category: "point_sequence_payload_tamper",
            severity: "critical",
            context: { firstSequence: input.points[0].sequence, lastSequence: input.points.at(-1)!.sequence },
          });
          this.database.prepare("UPDATE competitive_route_sessions SET risk_score = risk_score + 25 WHERE id = ?").run(input.sessionId);
          this.database.exec("COMMIT");
          gameError("IDEMPOTENCY_CONFLICT", "Daha önce alınan konum sırası farklı içerikle değiştirilemez.", 409);
        }
        const replayResult: PointBatchResult = {
          acceptedCount: 0,
          ignoredCount: input.points.length,
          suspiciousCount: 0,
          lastReceivedSequence: session.last_received_sequence,
          lastAcceptedSequence: session.last_accepted_sequence,
          classifications: existing.map((row, index) => ({
            sequence: input.points[index].sequence,
            classification: row!.classification,
            reason: "duplicate_replay_ignored",
          })),
        };
        this.database.prepare(`
          INSERT INTO route_point_batches
            (id, session_id, user_id, idempotency_key, payload_hash, first_sequence, last_sequence,
             accepted_count, ignored_count, suspicious_count, response_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)
        `).run(
          randomUUID(), input.sessionId, input.userId, input.idempotencyKey, payloadHash,
          input.points[0].sequence, input.points.at(-1)!.sequence, input.points.length, JSON.stringify(replayResult),
        );
        this.database.exec("COMMIT");
        incrementMetric(this.database, "route_point_replays_ignored_total", input.points.length);
        return replayResult;
      }
      if (input.points[0].sequence !== session.last_received_sequence + 1) gameError("SEQUENCE_GAP", "Beklenen konum sıra numarası alınmadı.", 409);
      if (input.points.at(-1)!.sequence > this.config.sessions.maximumPoints) gameError("INVALID_REQUEST", "Rota oturumu nokta sınırını aşıyor.");

      let previousAccepted = this.database.prepare(`
        SELECT sequence, latitude, longitude, accuracy_m, speed_mps, client_observed_at, received_at_server,
               classification, classification_reason, segment_index
        FROM route_points
        WHERE session_id = ? AND classification IN ('ACCEPTED', 'SUSPICIOUS')
        ORDER BY sequence DESC LIMIT 1
      `).get(input.sessionId) as PointRow | undefined;
      let acceptedCount = 0;
      let ignoredCount = 0;
      let suspiciousCount = 0;
      let lastAcceptedSequence = session.last_accepted_sequence;
      let acceptedDistanceM = session.accepted_distance_m;
      let currentSegmentIndex = session.current_segment_index;
      const classifications: PointBatchResult["classifications"] = [];
      const insert = this.database.prepare(`
        INSERT INTO route_points
          (session_id, sequence, latitude, longitude, accuracy_m, altitude_m, speed_mps, heading,
           client_observed_at, received_at_server, classification, classification_reason, segment_index, point_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const locationPoint of input.points) {
        let classification: PointClassification = "ACCEPTED";
        let reason: string | undefined;
        let calculatedSpeedMps: number | null = null;
        let distanceIncrementM = 0;
        const clientMs = parseIsoMs(locationPoint.clientObservedAt);
        const startedAtMs = Date.parse(session.started_at_server);
        const preSessionGraceSeconds = session.last_received_sequence === 0 && locationPoint.sequence === 1
          ? this.config.location.initialSampleGraceSeconds
          : this.config.location.subsequentSampleGraceSeconds;
        if (locationPoint.accuracyM > this.config.location.maximumAccuracyM) {
          classification = "IGNORED_LOW_ACCURACY";
          reason = "accuracy_limit";
        } else if (session.mode === "real_gps" && clientMs !== null
          && clientMs < startedAtMs - preSessionGraceSeconds * 1_000) {
          classification = "IGNORED_OUTLIER";
          reason = "before_session_start";
        } else if (session.mode === "real_gps" && clientMs !== null
          && clientMs < now - this.config.location.maximumClientBackfillSeconds * 1_000) {
          classification = "IGNORED_OUTLIER";
          reason = "stale_client_time";
        } else if (session.mode === "real_gps" && clientMs !== null
          && clientMs > now + this.config.location.maximumClientFutureSkewSeconds * 1_000) {
          classification = "IGNORED_OUTLIER";
          reason = "future_client_time";
        } else if (previousAccepted) {
          const coordinate: Coordinate = [locationPoint.longitude, locationPoint.latitude];
          const travelledM = distance(point(pointCoordinate(previousAccepted)), point(coordinate), { units: "meters" });
          const previousClientMs = parseIsoMs(previousAccepted.client_observed_at);
          const measuredElapsedMs = previousClientMs !== null && clientMs !== null
            ? clientMs - previousClientMs
            : Math.max(1, locationPoint.sequence - previousAccepted.sequence) * 1_000;
          const elapsedMs = session.mode === "development_simulation"
            ? Math.max(measuredElapsedMs, 1_000)
            : measuredElapsedMs;
          const previousReceivedAtMs = Date.parse(previousAccepted.received_at_server);
          let startsNewSegment = previousAccepted.segment_index !== currentSegmentIndex;
          if (!startsNewSegment
            && session.mode === "real_gps"
            && Number.isFinite(previousReceivedAtMs)
            && now - previousReceivedAtMs > this.config.location.maximumTrackingGapSeconds * 1_000) {
            currentSegmentIndex += 1;
            startsNewSegment = true;
          }
          if (startsNewSegment) {
            reason = "tracking_gap_anchor";
          } else if (session.mode === "real_gps" && (elapsedMs <= 0 || elapsedMs < this.config.location.minimumPointIntervalMs)) {
            classification = "IGNORED_OUTLIER";
            reason = "non_monotonic_time";
          } else if (travelledM < this.config.location.minimumPointSpacingM) {
            classification = "IGNORED_OUTLIER";
            reason = "duplicate_or_jitter";
          } else {
            calculatedSpeedMps = travelledM / (elapsedMs / 1_000);
            const maximumSpeed = session.mode === "real_gps"
              ? this.config.location.maximumRealSpeedMps
              : this.config.location.maximumSimulationSpeedMps;
            if (calculatedSpeedMps > maximumSpeed) {
              classification = "IGNORED_OUTLIER";
              reason = "impossible_speed";
            } else if (session.mode === "real_gps"
              && acceptedDistanceM + travelledM > this.config.location.maximumRealSpeedMps
                * Math.max(0, (now - startedAtMs) / 1_000)
                + this.config.location.serverDistanceBudgetSlackM) {
              classification = "IGNORED_OUTLIER";
              reason = "server_distance_budget";
            } else if (session.mode === "real_gps" && calculatedSpeedMps > this.config.location.suspiciousRealSpeedMps) {
              classification = "SUSPICIOUS";
              reason = "high_speed";
            } else if (locationPoint.accuracyM > this.config.location.suspiciousAccuracyM) {
              classification = "SUSPICIOUS";
              reason = "weak_accuracy";
            }
            if (previousAccepted.speed_mps !== null && calculatedSpeedMps !== null) {
              const acceleration = Math.abs(calculatedSpeedMps - previousAccepted.speed_mps) / Math.max(elapsedMs / 1_000, 0.001);
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

        insert.run(
          input.sessionId,
          locationPoint.sequence,
          locationPoint.latitude,
          locationPoint.longitude,
          locationPoint.accuracyM,
          locationPoint.altitudeM ?? null,
          calculatedSpeedMps ?? locationPoint.speedMps ?? null,
          locationPoint.heading ?? null,
          locationPoint.clientObservedAt ?? null,
          receivedAt,
          classification,
          reason ?? null,
          currentSegmentIndex,
          sha256(JSON.stringify(canonicalPoint(locationPoint))),
        );
        classifications.push({ sequence: locationPoint.sequence, classification, ...(reason ? { reason } : {}) });
        if (ACCEPTED_CLASSIFICATIONS.has(classification)) {
          acceptedCount += 1;
          if (classification === "SUSPICIOUS") suspiciousCount += 1;
          acceptedDistanceM += distanceIncrementM;
          lastAcceptedSequence = locationPoint.sequence;
          previousAccepted = {
            sequence: locationPoint.sequence,
            latitude: locationPoint.latitude,
            longitude: locationPoint.longitude,
            accuracy_m: locationPoint.accuracyM,
            speed_mps: calculatedSpeedMps ?? locationPoint.speedMps ?? null,
            client_observed_at: locationPoint.clientObservedAt ?? null,
            received_at_server: receivedAt,
            classification,
            classification_reason: reason ?? null,
            segment_index: currentSegmentIndex,
          };
        } else {
          ignoredCount += 1;
        }
      }

      const totalAccepted = session.accepted_point_count + acceptedCount;
      const totalSuspicious = session.suspicious_point_count + suspiciousCount;
      if (totalAccepted >= 6 && totalSuspicious / totalAccepted > this.config.location.maximumSuspiciousRatio) {
        safeRiskEvent(this.database, {
          userId: input.userId,
          sessionId: input.sessionId,
          category: "suspicious_point_ratio",
          severity: "warning",
          context: { acceptedPointCount: totalAccepted, suspiciousPointCount: totalSuspicious },
        });
      }
      const lastReceivedSequence = input.points.at(-1)!.sequence;
      const riskIncrement = classifications.reduce((total, item) => {
        if (item.classification === "SUSPICIOUS") return total + 2;
        if (["impossible_speed", "non_monotonic_time", "server_distance_budget", "before_session_start", "stale_client_time", "future_client_time"].includes(item.reason ?? "")) return total + 5;
        return total;
      }, 0);
      const response: PointBatchResult = {
        acceptedCount,
        ignoredCount,
        suspiciousCount,
        lastReceivedSequence,
        lastAcceptedSequence,
        classifications,
      };
      this.database.prepare(`
        UPDATE competitive_route_sessions
        SET last_received_sequence = ?, last_accepted_sequence = ?, accepted_point_count = accepted_point_count + ?,
            suspicious_point_count = suspicious_point_count + ?, accepted_distance_m = ?, current_segment_index = ?,
            risk_score = risk_score + ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        lastReceivedSequence,
        lastAcceptedSequence,
        acceptedCount,
        suspiciousCount,
        acceptedDistanceM,
        currentSegmentIndex,
        riskIncrement,
        iso(now + this.config.sessions.leaseSeconds * 1_000),
        receivedAt,
        input.sessionId,
      );
      this.database.prepare(`
        INSERT INTO route_point_batches
          (id, session_id, user_id, idempotency_key, payload_hash, first_sequence, last_sequence,
           accepted_count, ignored_count, suspicious_count, response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), input.sessionId, input.userId, input.idempotencyKey, payloadHash,
        input.points[0].sequence, lastReceivedSequence, acceptedCount, ignoredCount, suspiciousCount,
        JSON.stringify(response),
      );
      this.database.exec("COMMIT");
      incrementMetric(this.database, "route_points_accepted_total", acceptedCount);
      incrementMetric(this.database, "route_points_ignored_total", ignoredCount);
      return response;
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  createLoopCandidate(input: { userId: string; sessionId: string; nonce: string; lastAcceptedPointSequence: number }) {
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
    const session = this.requireSession(input.sessionId, input.userId, input.nonce, now);
    if (input.lastAcceptedPointSequence !== session.last_accepted_sequence) {
      gameError("SEQUENCE_GAP", "Döngü yalnızca sunucunun son kabul ettiği nokta için oluşturulabilir.", 409);
    }
    const existing = this.database.prepare(`
      SELECT * FROM loop_candidates
      WHERE session_id = ? AND end_sequence = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(input.sessionId, input.lastAcceptedPointSequence) as CandidateRow | undefined;
    if (existing) {
      if (existing.status === "available" && parseIsoMs(existing.expires_at)! > now) {
        this.database.exec("COMMIT");
        return candidateDto(existing);
      }
      if (existing.status === "available") {
        this.database.prepare("UPDATE loop_candidates SET status = 'expired' WHERE id = ? AND status = 'available'").run(existing.id);
        this.database.exec("COMMIT");
        gameError("CANDIDATE_EXPIRED", "Döngü adayının süresi doldu.", 409);
      }
      gameError("CONFLICT", "Bu rota ucu için döngü kararı daha önce verildi.", 409);
    }

    const points = this.acceptedPoints(input.sessionId, input.lastAcceptedPointSequence, session.current_segment_index);
    if (points.length < this.config.geometry.minimumIndexGap + 1) gameError("NO_LOOP_AVAILABLE", "Henüz kapatılabilir bir döngü oluşmadı.", 409);
    const suspiciousSegmentPoints = points.filter((locationPoint) => locationPoint.classification === "SUSPICIOUS").length;
    if (suspiciousSegmentPoints / points.length > this.config.location.maximumSuspiciousRatio) {
      gameError("INVALID_ROUTE", "Döngü için konum kalitesi yeterli değil; daha açık bir alanda yeniden dene.", 422);
    }
    if (session.risk_score >= this.config.location.maximumClaimRiskScore) {
      gameError("INVALID_ROUTE", "Rota güvenlik sınırını aştı; yeni ve tutarlı bir rota oturumu başlat.", 422);
    }
    const detector = new LoopDetector({
      realProximityM: this.config.geometry.realProximityM,
      simulatedProximityM: this.config.geometry.simulatedProximityM,
      minimumAreaM2: this.config.geometry.minimumAreaM2,
      minimumRouteLengthM: this.config.geometry.minimumRouteLengthM,
      minimumIndexGap: this.config.geometry.minimumIndexGap,
      detectionCooldownMs: this.config.geometry.detectionCooldownMs,
    });
    const ownTerritory = this.currentTerritoryGeometry(input.userId, session.world_id);
    const detected = detector.detect(
      points.map(pointCoordinate),
      session.mode === "real_gps" ? "real" : "simulation",
      ownTerritory,
      now,
    );
    if (!detected.loop) gameError("NO_LOOP_AVAILABLE", "Henüz kapatılabilir geçerli bir döngü oluşmadı.", 409);
    this.validatePolygon(detected.loop.polygon);
    if (detected.loop.estimatedAreaM2 / Math.max(1, detected.loop.routeLengthM) > this.config.geometry.maximumAreaPerRouteMeterM2) {
      gameError("INVALID_GEOMETRY", "Alan ile izlenen rota uzunluğu tutarlı değil.", 422);
    }
    const id = randomUUID();
    const detectedAt = iso(now);
    const expiresAt = iso(now + this.config.sessions.candidateTtlSeconds * 1_000);
    this.database.prepare(`
      INSERT INTO loop_candidates
        (id, session_id, user_id, start_sequence, end_sequence, source_segment_index, source,
         coordinates_hash, polygon_json, estimated_area_m2, route_length_m, status, detected_at_server, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
    `).run(
      id,
      input.sessionId,
      input.userId,
      points[detected.loop.startIndex]?.sequence ?? points[0].sequence,
      points[detected.loop.endIndex]?.sequence ?? input.lastAcceptedPointSequence,
      session.current_segment_index,
      detected.loop.source,
      polygonHash(detected.loop.polygon),
      JSON.stringify(detected.loop.polygon),
      detected.loop.estimatedAreaM2,
      detected.loop.routeLengthM,
      detectedAt,
      expiresAt,
    );
    const created = this.getCandidateRow(id)!;
    this.database.exec("COMMIT");
    incrementMetric(this.database, "loop_candidates_created_total");
    return candidateDto(created);
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  continueCandidate(input: { userId: string; candidateId: string; nonce: string }) {
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const candidate = this.getCandidateRow(input.candidateId);
      if (!candidate || candidate.user_id !== input.userId) gameError("NOT_FOUND", "Döngü adayı bulunamadı.", 404);
      this.requireSession(candidate.session_id, input.userId, input.nonce, now);
      if (candidate.status !== "available") gameError("CONFLICT", "Döngü adayı artık kullanılamıyor.", 409);
      if (parseIsoMs(candidate.expires_at)! <= now) {
        this.database.prepare("UPDATE loop_candidates SET status = 'expired' WHERE id = ? AND status = 'available'").run(input.candidateId);
        this.database.exec("COMMIT");
        gameError("CANDIDATE_EXPIRED", "Döngü adayının süresi doldu.", 409);
      }
      const updated = this.database.prepare("UPDATE loop_candidates SET status = 'continued' WHERE id = ? AND status = 'available'").run(input.candidateId);
      if (updated.changes !== 1) gameError("CONFLICT", "Döngü adayı eşzamanlı başka bir işlemde kullanıldı.", 409);
      const result = candidateDto(this.getCandidateRow(input.candidateId)!);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  async claim(input: { userId: string; nonce: string; command: CloseLoopCommand }): Promise<ClaimResult> {
    incrementMetric(this.database, "claim_requests_total");
    const processingStartedAt = this.clock();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.claimOnce(input);
        incrementMetric(this.database, "claim_processing_duration_ms_total", Math.max(0, this.clock() - processingStartedAt));
        return result;
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
        const message = error instanceof Error ? error.message : "";
        const retryable = code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || /database is locked/i.test(message);
        if (!retryable || attempt >= this.config.transaction.maximumRetries) {
          if (retryable) incrementMetric(this.database, "claim_serialization_retry_exhausted_total");
          incrementMetric(this.database, "claims_rejected_total");
          if (error instanceof Error && error.message.includes("score invariant")) incrementMetric(this.database, "score_reconciliation_difference_total");
          throw error;
        }
        incrementMetric(this.database, "claim_serialization_retry_total");
        const delay = this.config.transaction.retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * (this.config.transaction.retryJitterMs + 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async claimOnce(input: { userId: string; nonce: string; command: CloseLoopCommand }): Promise<ClaimResult> {
    ensureIdempotencyKey(input.command.idempotencyKey);
    const normalizedColor = ROUTE_COLORS.find((color) => color.toUpperCase() === input.command.selectedColorId.toUpperCase());
    if (!normalizedColor) gameError("INVALID_COLOR", "Seçilen rota rengi izin verilen palette değil.");
    const payloadHash = commandHash({ ...input.command, selectedColorId: normalizedColor });
    const now = this.clock();
    this.requireSessionIdentity(input.command.sessionId, input.userId, input.nonce);
    const completed = this.findCompletedCommand(input.userId, input.command.idempotencyKey, payloadHash);
    if (completed) return completed;
    const session = this.requireSession(input.command.sessionId, input.userId, input.nonce, now);
    const candidate = this.getCandidateRow(input.command.candidateId);
    if (!candidate || candidate.user_id !== input.userId || candidate.session_id !== session.id) gameError("NOT_FOUND", "Döngü adayı bulunamadı.", 404);
    if (candidate.status !== "available") {
      gameError("CONFLICT", "Döngü adayı daha önce işlendi.", 409);
    }
    if (parseIsoMs(candidate.expires_at)! <= now) gameError("CANDIDATE_EXPIRED", "Döngü adayı süresi doldu.", 409);
    if (candidate.source_segment_index !== session.current_segment_index) {
      gameError("CONFLICT", "Döngü adayı başka bir rota segmentine ait.", 409);
    }
    if (input.command.lastAcceptedPointSequence < candidate.end_sequence
        || input.command.lastAcceptedPointSequence > session.last_accepted_sequence) {
      gameError("SEQUENCE_GAP", "Alan talebi öncesi rota noktaları sunucuyla eşleşmiyor.", 409);
    }
    if (session.accepted_point_count >= this.config.geometry.minimumIndexGap + 1
      && session.suspicious_point_count / session.accepted_point_count > this.config.location.maximumSuspiciousRatio) {
      gameError("INVALID_ROUTE", "Rota doğrulanamadı; konum kalitesi ve hareket tutarlılığını kontrol et.", 422);
    }
    if (session.risk_score >= this.config.location.maximumClaimRiskScore) {
      gameError("INVALID_ROUTE", "Rota güvenlik sınırını aştı; yeni ve tutarlı bir rota oturumu başlat.", 422);
    }
    if (now - Date.parse(session.started_at_server) < this.config.sessions.minimumClaimDurationSeconds * 1_000) {
      gameError("INVALID_ROUTE", "Alan kapatmak için rota oturumu çok kısa.", 422);
    }

    const polygon = this.reconstructCandidate(candidate, session);
    const polygonAreaM2 = this.validatePolygon(polygon);
    let targetCells: string[];
    try {
      targetCells = await this.grid.polygonToCells(polygon);
    } catch (error) {
      if (error instanceof Error && error.message.includes("sınırını aşıyor")) gameError("CLAIM_TOO_LARGE", "Alan işlem sınırını aşıyor.", 413);
      gameError("INVALID_GEOMETRY", "Alan standart harita hücrelerine dönüştürülemedi.", 422);
    }
    targetCells = [...new Set(targetCells)].sort();
    if (targetCells.length < this.config.geometry.minimumCellCount) gameError("INVALID_GEOMETRY", `Alan en az ${this.config.geometry.minimumCellCount} standart harita hücresi içermeli.`, 422);
    const regions = [...new Set(targetCells.map((cellId) => this.grid.getRegionId(cellId)))].sort();
    const commandId = randomUUID();
    const claimEventId = randomUUID();

    const lockWaitStartedAt = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      incrementMetric(this.database, "region_lock_wait_ms_total", Math.max(0, this.clock() - lockWaitStartedAt));
      const duplicate = this.database.prepare(`
        SELECT payload_hash, result_json, status FROM claim_commands
        WHERE user_id = ? AND idempotency_key = ?
      `).get(input.userId, input.command.idempotencyKey) as { payload_hash: string; result_json: string | null; status: string } | undefined;
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash) gameError("IDEMPOTENCY_CONFLICT", "Aynı işlem kimliği farklı bir alan talebiyle kullanıldı.", 409);
        if (!duplicate.result_json) gameError("RETRYABLE", "Alan talebi hâlâ işleniyor; durumunu yeniden sorgula.", 409, true);
        const result = JSON.parse(duplicate.result_json) as ClaimResult;
        this.database.exec("COMMIT");
        return result;
      }
      const lockedNow = this.clock();
      const lockedSession = this.requireSession(input.command.sessionId, input.userId, input.nonce, lockedNow);
      const lockedCandidate = this.getCandidateRow(input.command.candidateId);
      if (!lockedCandidate
          || lockedCandidate.user_id !== input.userId
          || lockedCandidate.session_id !== lockedSession.id
          || lockedCandidate.status !== "available") {
        gameError("CONFLICT", "Döngü adayı eşzamanlı başka bir işlemde kullanıldı.", 409);
      }
      if (parseIsoMs(lockedCandidate.expires_at)! <= lockedNow) gameError("CANDIDATE_EXPIRED", "Döngü adayının süresi doldu.", 409);
      if (lockedCandidate.source_segment_index !== lockedSession.current_segment_index) {
        gameError("CONFLICT", "Döngü adayı başka bir rota segmentine ait.", 409);
      }
      if (input.command.lastAcceptedPointSequence < lockedCandidate.end_sequence
          || input.command.lastAcceptedPointSequence > lockedSession.last_accepted_sequence) {
        gameError("SEQUENCE_GAP", "Rota alan talebi sırasında geçersiz bir nokta aralığı bildirdi.", 409);
      }
      if (lockedCandidate.start_sequence !== candidate.start_sequence
          || lockedCandidate.end_sequence !== candidate.end_sequence
          || lockedCandidate.source_segment_index !== candidate.source_segment_index
          || lockedCandidate.coordinates_hash !== candidate.coordinates_hash) {
        gameError("CONFLICT", "Döngü adayı alan talebi sırasında değişti.", 409);
      }
      if (lockedSession.risk_score >= this.config.location.maximumClaimRiskScore
          || (lockedSession.accepted_point_count >= this.config.geometry.minimumIndexGap + 1
            && lockedSession.suspicious_point_count / lockedSession.accepted_point_count
              > this.config.location.maximumSuspiciousRatio)) {
        gameError("INVALID_ROUTE", "Rota güvenlik sınırını aştı; yeni ve tutarlı bir rota oturumu başlat.", 422);
      }
      const committedAt = iso(lockedNow);

      this.database.prepare(`
        INSERT INTO claim_commands
          (id, user_id, world_id, session_id, candidate_id, idempotency_key, payload_hash, status, pipeline_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)
      `).run(
        commandId, input.userId, session.world_id, session.id, candidate.id, input.command.idempotencyKey, payloadHash,
        pipeline(
          "RECEIVED", "AUTHENTICATING", "SESSION_VALIDATION", "ROUTE_VALIDATION", "GEOMETRY_RECONSTRUCTION",
          "GEOMETRY_VALIDATION", "CELL_CALCULATION", "RATE_LIMIT_CHECK", "RISK_CHECK", "WAITING_FOR_REGION_LOCK", "PROCESSING",
        ),
      );

      for (const regionId of regions) {
        this.database.prepare("INSERT OR IGNORE INTO world_regions (world_id, region_id) VALUES (?, ?)").run(session.world_id, regionId);
        // Reading rows in deterministic region order documents and mirrors the production FOR UPDATE lock order.
        this.database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(session.world_id, regionId);
      }

      const selectCell = this.database.prepare(`
        SELECT cell_id, region_id, owner_id, paint_color_id, area_m2, owner_changed_at, paint_changed_at
        FROM territory_cells WHERE world_id = ? AND cell_id = ?
      `);
      const restrictedStatement = this.database.prepare(`
        SELECT 1 FROM restricted_regions WHERE world_id = ? AND cell_id = ? AND active = 1
      `);
      const oldCells = new Map<string, CellRow>();
      const restricted = new Set<string>();
      for (const cellId of targetCells) {
        const old = selectCell.get(session.world_id, cellId) as CellRow | undefined;
        if (old) oldCells.set(cellId, old);
        if (restrictedStatement.get(session.world_id, cellId)) restricted.add(cellId);
      }
      const cellAreas = new Map(targetCells.map((cellId) => [cellId, this.grid.calculateCellAreaM2(cellId)]));
      if ([...cellAreas.values()].some((cellAreaM2) => !Number.isFinite(cellAreaM2) || cellAreaM2 <= 0)) {
        gameError("INVALID_GEOMETRY", "Standart harita hücresi alanı doğrulanamadı.", 422);
      }
      const sumArea = (cellIds: readonly string[]) => cellIds.reduce((sum, cellId) => sum + (cellAreas.get(cellId) ?? 0), 0);
      const restrictedAreaM2 = sumArea([...restricted]);
      const concurrentRecalculation = [...oldCells.values()].some((cell) => cell.owner_changed_at > candidate.detected_at_server);
      if (restricted.size > 0) {
        const result: ClaimResult = {
          claimEventId: `rejected-${commandId}`,
          status: "rejected",
          newlyClaimedAreaM2: 0,
          capturedFromOthersAreaM2: 0,
          alreadyOwnedAreaM2: sumArea(targetCells.filter((cellId) => oldCells.get(cellId)?.owner_id === input.userId)),
          restrictedAreaM2,
          totalLoopAreaM2: Math.max(polygonAreaM2, sumArea(targetCells)),
          finalTerritoryAreaM2: this.scoreArea(session.world_id, input.userId),
          affectedRegionVersions: {},
          capturedFrom: [],
          committedAtServer: committedAt,
          concurrentRecalculation,
        };
        this.database.prepare(`
          UPDATE claim_commands
          SET status = 'REJECTED_RESTRICTED', result_json = ?, error_code = 'RESTRICTED_REGION', pipeline_json = ?, completed_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify(result),
          pipeline(
            "RECEIVED", "AUTHENTICATING", "SESSION_VALIDATION", "ROUTE_VALIDATION", "GEOMETRY_RECONSTRUCTION",
            "GEOMETRY_VALIDATION", "CELL_CALCULATION", "RATE_LIMIT_CHECK", "RISK_CHECK", "WAITING_FOR_REGION_LOCK",
            "PROCESSING", "REJECTED_RESTRICTED_REGION",
          ),
          committedAt,
          commandId,
        );
        this.database.prepare("UPDATE loop_candidates SET status = 'invalid' WHERE id = ? AND status = 'available'").run(candidate.id);
        this.database.exec("COMMIT");
        incrementMetric(this.database, "claim_restricted_rejected_total");
        return result;
      }
      const writableCells = targetCells.filter((cellId) => !restricted.has(cellId));
      const changedCells = writableCells.filter((cellId) => {
        const old = oldCells.get(cellId);
        return !old || old.owner_id !== input.userId || old.paint_color_id.toUpperCase() !== normalizedColor.toUpperCase();
      });
      const alreadyOwnedCells = writableCells.filter((cellId) => oldCells.get(cellId)?.owner_id === input.userId);
      const unownedCells = writableCells.filter((cellId) => !oldCells.has(cellId));
      const enemyCells = writableCells.filter((cellId) => {
        const ownerId = oldCells.get(cellId)?.owner_id;
        return Boolean(ownerId && ownerId !== input.userId);
      });
      const capturedByOwner = new Map<string, number>();
      for (const cellId of enemyCells) {
        const ownerId = oldCells.get(cellId)!.owner_id;
        capturedByOwner.set(ownerId, (capturedByOwner.get(ownerId) ?? 0) + (cellAreas.get(cellId) ?? 0));
      }
      if (changedCells.length === 0) {
        const result: ClaimResult = {
          claimEventId: `noop-${commandId}`,
          status: "rejected",
          newlyClaimedAreaM2: 0,
          capturedFromOthersAreaM2: 0,
          alreadyOwnedAreaM2: sumArea(alreadyOwnedCells),
          restrictedAreaM2,
          totalLoopAreaM2: sumArea(targetCells),
          finalTerritoryAreaM2: this.scoreArea(session.world_id, input.userId),
          affectedRegionVersions: {},
          capturedFrom: [],
          committedAtServer: committedAt,
          concurrentRecalculation,
        };
        this.database.prepare("UPDATE claim_commands SET status = 'COMMITTED_NOOP', result_json = ?, pipeline_json = ?, completed_at = ? WHERE id = ?")
          .run(JSON.stringify(result), pipeline("RECEIVED", "AUTHENTICATING", "SESSION_VALIDATION", "ROUTE_VALIDATION", "GEOMETRY_RECONSTRUCTION", "GEOMETRY_VALIDATION", "CELL_CALCULATION", "RATE_LIMIT_CHECK", "RISK_CHECK", "WAITING_FOR_REGION_LOCK", "PROCESSING", "REJECTED_DUPLICATE"), committedAt, commandId);
        this.database.prepare("UPDATE loop_candidates SET status = 'accepted' WHERE id = ?").run(candidate.id);
        this.database.exec("COMMIT");
        incrementMetric(this.database, "claim_noop_total");
        return result;
      }

      const finalTerritoryAreaM2 = this.scoreArea(session.world_id, input.userId) + sumArea(unownedCells) + sumArea(enemyCells);
      const claimStatus: ClaimResult["status"] = "accepted";
      this.database.prepare(`
        INSERT INTO claim_events
          (id, world_id, user_id, session_id, candidate_id, command_id, status, selected_color_id,
           raw_polygon_json, newly_claimed_area_m2, captured_from_others_area_m2, already_owned_area_m2,
           restricted_area_m2, total_loop_area_m2, total_area_after_m2, concurrent_recalculation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        claimEventId, session.world_id, input.userId, session.id, candidate.id, commandId, claimStatus, normalizedColor,
        JSON.stringify(polygon), sumArea(unownedCells), sumArea(enemyCells), sumArea(alreadyOwnedCells),
        restrictedAreaM2, Math.max(polygonAreaM2, sumArea(targetCells)), finalTerritoryAreaM2,
        concurrentRecalculation ? 1 : 0, committedAt,
      );

      const upsertCell = this.database.prepare(`
        INSERT INTO territory_cells
          (world_id, cell_id, region_id, owner_id, paint_color_id, area_m2, owner_changed_at, paint_changed_at, claim_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(world_id, cell_id) DO UPDATE SET
          region_id = excluded.region_id,
          owner_id = excluded.owner_id,
          paint_color_id = excluded.paint_color_id,
          area_m2 = excluded.area_m2,
          owner_changed_at = CASE WHEN territory_cells.owner_id <> excluded.owner_id THEN excluded.owner_changed_at ELSE territory_cells.owner_changed_at END,
          paint_changed_at = excluded.paint_changed_at,
          ownership_version = CASE WHEN territory_cells.owner_id <> excluded.owner_id THEN territory_cells.ownership_version + 1 ELSE territory_cells.ownership_version END,
          paint_version = CASE WHEN territory_cells.paint_color_id <> excluded.paint_color_id THEN territory_cells.paint_version + 1 ELSE territory_cells.paint_version END,
          claim_event_id = excluded.claim_event_id
      `);
      const insertChange = this.database.prepare(`
        INSERT INTO claim_cell_changes
          (claim_event_id, cell_id, region_id, old_owner_id, new_owner_id, old_paint_color_id, new_paint_color_id, area_m2)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const cellId of changedCells) {
        const old = oldCells.get(cellId);
        const cellAreaM2 = cellAreas.get(cellId)!;
        const regionId = this.grid.getRegionId(cellId);
        upsertCell.run(session.world_id, cellId, regionId, input.userId, normalizedColor, cellAreaM2, committedAt, committedAt, claimEventId);
        insertChange.run(claimEventId, cellId, regionId, old?.owner_id ?? null, input.userId, old?.paint_color_id ?? null, normalizedColor, cellAreaM2);
      }

      const affectedOwners = new Set([input.userId, ...capturedByOwner.keys()]);
      for (const ownerId of [...affectedOwners].sort()) {
        this.recalculateScore(session.world_id, ownerId, ownerId === input.userId ? 1 : 0, ownerId === input.userId ? sumArea(enemyCells) : 0, committedAt);
      }
      const recalculatedFinalAreaM2 = this.scoreArea(session.world_id, input.userId);
      if (Math.abs(recalculatedFinalAreaM2 - finalTerritoryAreaM2) > 0.01) {
        throw new Error("Territory score invariant failed during claim transaction.");
      }

      const affectedRegionVersions: Record<string, number> = {};
      for (const regionId of regions) {
        const relevant = changedCells.filter((cellId) => this.grid.getRegionId(cellId) === regionId);
        if (relevant.length === 0) continue;
        const versionRow = this.database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?")
          .get(session.world_id, regionId) as { version: number };
        const nextVersion = versionRow.version + 1;
        this.database.prepare("UPDATE world_regions SET version = ?, updated_at = ? WHERE world_id = ? AND region_id = ?")
          .run(nextVersion, committedAt, session.world_id, regionId);
        affectedRegionVersions[regionId] = nextVersion;
        const event: RegionPatchEvent = {
          eventId: randomUUID(),
          type: "region_patch",
          worldId: session.world_id,
          regionId,
          previousVersion: versionRow.version,
          version: nextVersion,
          claimEventId,
          ...(relevant.length <= this.config.realtime.maximumInlinePatchCells
            ? { changedCells: relevant.map((cellId) => ({ cellId, ownerId: input.userId, paintColorId: normalizedColor })) }
            : { requiresRefetch: true }),
          committedAtServer: committedAt,
        };
        this.database.prepare(`
          INSERT INTO realtime_outbox
            (event_id, world_id, region_id, previous_version, version, claim_event_id, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(event.eventId, session.world_id, regionId, versionRow.version, nextVersion, claimEventId, JSON.stringify(event), committedAt);
      }

      this.insertClaimNotifications(input.userId, claimEventId, capturedByOwner, sumArea(unownedCells), sumArea(enemyCells));
      this.database.prepare("UPDATE loop_candidates SET status = 'accepted' WHERE id = ?").run(candidate.id);

      const result: ClaimResult = {
        claimEventId,
        status: claimStatus,
        newlyClaimedAreaM2: sumArea(unownedCells),
        capturedFromOthersAreaM2: sumArea(enemyCells),
        alreadyOwnedAreaM2: sumArea(alreadyOwnedCells),
        restrictedAreaM2,
        totalLoopAreaM2: Math.max(polygonAreaM2, sumArea(targetCells)),
        finalTerritoryAreaM2,
        affectedRegionVersions,
        capturedFrom: [...capturedByOwner].sort(([a], [b]) => a.localeCompare(b)).map(([userId, areaM2]) => ({ userId, areaM2 })),
        committedAtServer: committedAt,
        concurrentRecalculation,
      };
      this.database.prepare("UPDATE claim_commands SET status = 'COMMITTED', result_json = ?, pipeline_json = ?, completed_at = ? WHERE id = ?")
        .run(JSON.stringify(result), pipeline("RECEIVED", "AUTHENTICATING", "SESSION_VALIDATION", "ROUTE_VALIDATION", "GEOMETRY_RECONSTRUCTION", "GEOMETRY_VALIDATION", "CELL_CALCULATION", "RATE_LIMIT_CHECK", "RISK_CHECK", "WAITING_FOR_REGION_LOCK", "PROCESSING", "COMMITTED", "BROADCASTED"), committedAt, commandId);
      this.syncLegacyProjection(session, polygon, result, normalizedColor, affectedOwners, input.command.idempotencyKey);
      this.database.exec("COMMIT");
      incrementMetric(this.database, "claims_committed_total");
      incrementMetric(this.database, "territory_cells_changed_total", changedCells.length);
      incrementMetric(this.database, "claim_cells_total", targetCells.length);
      if (targetCells.length > this.config.realtime.maximumInlinePatchCells) incrementMetric(this.database, "large_claim_total");
      return result;
    } catch (error) {
      rollback(this.database);
      if (!(error instanceof AuthoritativeGameError)) incrementMetric(this.database, "claim_transaction_rollback_total");
      throw error;
    }
  }

  finishSession(input: { userId: string; sessionId: string; nonce: string }) {
    const existing = this.requireSessionIdentity(input.sessionId, input.userId, input.nonce);
    if (existing.status === "completed") {
      return { session: sessionDto(existing, input.nonce), route: this.requireFinishedRoute(input.sessionId) };
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const lockedIdentity = this.requireSessionIdentity(input.sessionId, input.userId, input.nonce);
      if (lockedIdentity.status === "completed") {
        const route = this.requireFinishedRoute(input.sessionId);
        this.database.exec("COMMIT");
        return { session: sessionDto(lockedIdentity, input.nonce), route };
      }
      const lockedNow = this.clock();
      const locked = this.requireSession(input.sessionId, input.userId, input.nonce, lockedNow);
      const points = this.acceptedPoints(locked.id);
      const distanceM = locked.accepted_distance_m;
      const durationSeconds = Math.max(0, Math.round((lockedNow - Date.parse(locked.started_at_server)) / 1_000));
      const closedClaimCount = (this.database.prepare("SELECT COUNT(*) AS count FROM claim_events WHERE session_id = ? AND status <> 'rejected'")
        .get(locked.id) as { count: number }).count;
      const endedAt = iso(lockedNow);
      const route: FinishedRoute = { distanceM, durationSeconds, acceptedPointCount: points.length, closedClaimCount };
      const completed = this.database.prepare(`
        UPDATE competitive_route_sessions
        SET status = 'completed', finished_at_server = ?, updated_at = ?
        WHERE id = ? AND status IN ('active', 'paused', 'closing')
      `).run(endedAt, endedAt, input.sessionId);
      if (completed.changes !== 1) gameError("CONFLICT", "Rota oturumu eşzamanlı başka bir işlemde değişti.", 409);
      this.database.prepare("UPDATE loop_candidates SET status = 'expired' WHERE session_id = ? AND status = 'available'").run(input.sessionId);
      this.database.prepare(`
        INSERT INTO authoritative_saved_routes
          (id, session_id, user_id, world_id, distance_m, duration_seconds, accepted_point_count,
           closed_claim_count, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), input.sessionId, input.userId, locked.world_id, distanceM, durationSeconds, points.length, closedClaimCount, locked.started_at_server, endedAt);
      if (locked.world_id === this.config.worlds.production && points.length > 0) {
        this.database.prepare(`
          INSERT OR IGNORE INTO route_sessions
            (id, user_id, idempotency_key, payload_hash, location_mode, distance_m, duration_seconds,
             point_count, started_at, ended_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), input.userId, `competitive_${input.sessionId}`, sha256(JSON.stringify(route)), "real",
          distanceM, Math.min(durationSeconds, 86_400), points.length, locked.started_at_server, endedAt,
        );
      }
      this.database.exec("COMMIT");
      incrementMetric(this.database, "route_sessions_finished_total");
      return { session: sessionDto({ ...locked, status: "completed", finished_at_server: endedAt }, input.nonce), route };
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  getCommandResult(userId: string, idempotencyKey: string) {
    ensureIdempotencyKey(idempotencyKey);
    const row = this.database.prepare(`
      SELECT status, result_json, error_code, pipeline_json, completed_at FROM claim_commands
      WHERE user_id = ? AND idempotency_key = ?
    `).get(userId, idempotencyKey) as { status: string; result_json: string | null; error_code: string | null; pipeline_json: string; completed_at: string | null } | undefined;
    if (!row) gameError("NOT_FOUND", "Alan talebi komutu bulunamadı.", 404);
    return { status: row.status, pipeline: JSON.parse(row.pipeline_json) as ClaimPipelineStatus[], result: row.result_json ? JSON.parse(row.result_json) as ClaimResult : null, errorCode: row.error_code, completedAt: row.completed_at };
  }

  getSessionWorld(userId: string, sessionId: string) {
    const session = this.getSessionRow(sessionId);
    if (!session || session.user_id !== userId) gameError("NOT_FOUND", "Rota oturumu bulunamadı.", 404);
    return session.world_id;
  }

  getSessionRecovery(input: { userId: string; sessionId: string; nonce: string }): RouteSessionRecoveryDto {
    const now = this.clock();
    const session = this.requireSession(input.sessionId, input.userId, input.nonce, now);
    const points = this.acceptedPoints(session.id, undefined, session.current_segment_index);
    const claimCount = (this.database.prepare(`
      SELECT COUNT(*) AS count FROM claim_events
      WHERE session_id = ? AND status <> 'rejected'
    `).get(session.id) as { count: number }).count;
    const availableCandidateRow = this.database.prepare(`
      SELECT * FROM loop_candidates
      WHERE session_id = ? AND status = 'available' AND expires_at > ?
      ORDER BY end_sequence DESC LIMIT 1
    `).get(session.id, iso(now)) as CandidateRow | undefined;
    return {
      session: sessionDto(session, input.nonce),
      currentSegmentPoints: points.map((locationPoint) => ({
        coordinate: pointCoordinate(locationPoint),
        accuracyM: locationPoint.accuracy_m,
        timestamp: parseIsoMs(locationPoint.client_observed_at) ?? parseIsoMs(locationPoint.received_at_server) ?? now,
      })),
      totalDistanceM: session.accepted_distance_m,
      claimCount,
      elapsedSeconds: Math.max(0, Math.floor((now - Date.parse(session.started_at_server)) / 1_000)),
      availableCandidate: availableCandidateRow ? candidateDto(availableCandidateRow) : null,
    };
  }

  getRegionSnapshot(worldId: string, regionIds: readonly string[]): RegionSnapshotWithCells {
    const uniqueRegions = [...new Set(regionIds)].sort();
    if (uniqueRegions.length < 1 || uniqueRegions.length > this.config.grid.maximumViewportRegions || uniqueRegions.some((id) => !validRegionId(id, this.config.grid.regionZoom))) {
      gameError("INVALID_REQUEST", "Görünür harita bölgeleri geçersiz.");
    }
    const versions: Record<string, number> = {};
    const cells: RegionSnapshotWithCells["cells"] = [];
    const versionStatement = this.database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?");
    const cellStatement = this.database.prepare(`
      SELECT c.cell_id, c.region_id, c.owner_id, c.paint_color_id, u.username
      FROM territory_cells c JOIN users u ON u.id = c.owner_id
      WHERE c.world_id = ? AND c.region_id = ? ORDER BY c.cell_id
    `);
    for (const regionId of uniqueRegions) {
      versions[regionId] = (versionStatement.get(worldId, regionId) as { version: number } | undefined)?.version ?? 0;
      const rows = cellStatement.all(worldId, regionId) as Array<{ cell_id: string; region_id: string; owner_id: string; paint_color_id: string; username: string }>;
      for (const row of rows) cells.push({ cellId: row.cell_id, regionId: row.region_id, ownerId: row.owner_id, ownerUsername: row.username, paintColorId: row.paint_color_id });
    }
    const latestOutboxSequence = (this.database.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM realtime_outbox WHERE world_id = ?")
      .get(worldId) as { sequence: number }).sequence;
    return { worldId, versions, cells, latestOutboxSequence, mapState: this.getMapState(worldId, uniqueRegions), generatedAtServer: iso(this.clock()) };
  }

  listRegionEvents(worldId: string, regionIds: readonly string[], afterSequence: number, limit = 200) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) gameError("INVALID_REQUEST", "Gerçek zamanlı akış sıra değeri geçersiz.");
    const wanted = new Set(regionIds);
    if (wanted.size < 1 || wanted.size > this.config.grid.maximumViewportRegions || [...wanted].some((id) => !validRegionId(id, this.config.grid.regionZoom))) {
      gameError("INVALID_REQUEST", "Gerçek zamanlı akış bölge listesi geçersiz.");
    }
    const sortedRegions = [...wanted].sort();
    const placeholders = sortedRegions.map(() => "?").join(",");
    const rows = this.database.prepare(`
      SELECT sequence, region_id, payload_json FROM realtime_outbox
      WHERE world_id = ? AND sequence > ? AND region_id IN (${placeholders})
      ORDER BY sequence LIMIT ?
    `).all(worldId, afterSequence, ...sortedRegions, Math.min(Math.max(limit, 1), 1_000)) as Array<{ sequence: number; region_id: string; payload_json: string }>;
    return rows.map((row) => ({ sequence: row.sequence, event: JSON.parse(row.payload_json) as RegionPatchEvent }));
  }

  getMapState(worldId: string, regionIds?: readonly string[]): TerritoryMapState {
    const scopedRegions = regionIds ? [...new Set(regionIds)].sort() : [];
    const regionFilter = scopedRegions.length > 0 ? ` AND c.region_id IN (${scopedRegions.map(() => "?").join(",")})` : "";
    const rows = this.database.prepare(`
      SELECT c.cell_id, c.owner_id, c.paint_color_id, c.area_m2, c.owner_changed_at, c.paint_changed_at,
             u.username, u.color, u.pattern
      FROM territory_cells c JOIN users u ON u.id = c.owner_id
      WHERE c.world_id = ?${regionFilter} ORDER BY c.owner_id, c.cell_id
    `).all(worldId, ...scopedRegions) as Array<CellRow & { username: string; color: string; pattern: number }>;
    const byOwner = new Map<string, typeof rows>();
    const byPaint = new Map<string, typeof rows>();
    for (const row of rows) {
      const ownerRows = byOwner.get(row.owner_id) ?? [];
      ownerRows.push(row);
      byOwner.set(row.owner_id, ownerRows);
      const paintKey = `${row.owner_id}:${row.paint_color_id}`;
      const paintRows = byPaint.get(paintKey) ?? [];
      paintRows.push(row);
      byPaint.set(paintKey, paintRows);
    }
    const territories: CurrentTerritory[] = [...byOwner].map(([ownerId, ownerRows]) => ({
      userId: ownerId,
      ownerUsername: ownerRows[0].username,
      geometry: this.cellsGeometry(ownerRows.map((row) => row.cell_id)),
      areaM2: ownerRows.reduce((sum, row) => sum + row.area_m2, 0),
      color: ownerRows[0].color,
      pattern: ownerRows[0].pattern,
      updatedAt: ownerRows.reduce((latest, row) => row.owner_changed_at > latest ? row.owner_changed_at : latest, ownerRows[0].owner_changed_at),
    }));
    const paints: TerritoryPaint[] = [...byPaint].map(([key, paintRows]) => ({
      id: sha256(`${worldId}:${key}`).slice(0, 32),
      userId: paintRows[0].owner_id,
      geometry: this.cellsGeometry(paintRows.map((row) => row.cell_id)),
      color: paintRows[0].paint_color_id,
      updatedAt: paintRows.reduce((latest, row) => row.paint_changed_at > latest ? row.paint_changed_at : latest, paintRows[0].paint_changed_at),
    }));
    return { territories, paints };
  }

  consumeRateLimit(scopeKey: string, maximumHits: number, windowMs: number) {
    const now = this.clock();
    const boundedScope = sha256(scopeKey);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT window_started_at_ms, hit_count FROM game_rate_limits WHERE scope_key = ?")
        .get(boundedScope) as { window_started_at_ms: number; hit_count: number } | undefined;
      let remaining: number;
      let retryAfterSeconds = 0;
      if (!row || now - row.window_started_at_ms >= windowMs) {
        this.database.prepare(`
          INSERT INTO game_rate_limits (scope_key, window_started_at_ms, hit_count) VALUES (?, ?, 1)
          ON CONFLICT(scope_key) DO UPDATE SET window_started_at_ms = excluded.window_started_at_ms, hit_count = 1, updated_at = CURRENT_TIMESTAMP
        `).run(boundedScope, now);
        remaining = maximumHits - 1;
      } else if (row.hit_count >= maximumHits) {
        remaining = 0;
        retryAfterSeconds = Math.max(1, Math.ceil((row.window_started_at_ms + windowMs - now) / 1_000));
      } else {
        this.database.prepare("UPDATE game_rate_limits SET hit_count = hit_count + 1, updated_at = CURRENT_TIMESTAMP WHERE scope_key = ?").run(boundedScope);
        remaining = maximumHits - row.hit_count - 1;
      }
      this.database.exec("COMMIT");
      return { allowed: retryAfterSeconds === 0, remaining, retryAfterSeconds };
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  health() {
    const quickCheck = this.database.prepare("PRAGMA quick_check").get() as { quick_check: string };
    const pendingOutbox = (this.database.prepare("SELECT COUNT(*) AS count FROM realtime_outbox WHERE dispatched_at IS NULL").get() as { count: number }).count;
    const activeSessions = (this.database.prepare("SELECT COUNT(*) AS count FROM competitive_route_sessions WHERE status IN ('active','paused','closing')").get() as { count: number }).count;
    const metrics = this.database.prepare("SELECT metric_key, metric_value FROM game_metrics ORDER BY metric_key").all() as Array<{ metric_key: string; metric_value: number }>;
    return {
      status: quickCheck.quick_check === "ok" ? "ok" : "degraded",
      storage: "sqlite-local-authoritative",
      pendingOutbox,
      activeSessions,
      metrics: Object.fromEntries(metrics.map((metric) => [metric.metric_key, metric.metric_value])),
      checkedAt: iso(this.clock()),
    };
  }

  recordMetric(key: string, amount = 1) {
    if (!/^[a-z0-9_]{3,80}$/.test(key) || !Number.isSafeInteger(amount)) return;
    incrementMetric(this.database, key, amount);
  }

  purgeExpiredRawLocations(now = this.clock()) {
    const cutoff = iso(now - this.config.privacy.rawLocationRetentionDays * 24 * 60 * 60 * 1_000);
    this.database.prepare(`
      UPDATE competitive_route_sessions
      SET status = 'expired',
          finished_at_server = COALESCE(finished_at_server, lease_expires_at),
          updated_at = ?
      WHERE status IN ('active', 'paused', 'closing')
        AND datetime(lease_expires_at) < datetime(?)
    `).run(iso(now), cutoff);
    const result = this.database.prepare(`
      DELETE FROM route_points
      WHERE session_id IN (
        SELECT id FROM competitive_route_sessions
        WHERE status IN ('completed', 'expired', 'revoked')
          AND datetime(COALESCE(finished_at_server, lease_expires_at)) < datetime(?)
      )
    `).run(cutoff);
    if (result.changes > 0) incrementMetric(this.database, "raw_location_points_purged_total", Number(result.changes));
    return Number(result.changes);
  }

  private requireFinishedRoute(sessionId: string): FinishedRoute {
    const saved = this.database.prepare(`
      SELECT distance_m, duration_seconds, accepted_point_count, closed_claim_count
      FROM authoritative_saved_routes WHERE session_id = ?
    `).get(sessionId) as {
      distance_m: number;
      duration_seconds: number;
      accepted_point_count: number;
      closed_claim_count: number;
    } | undefined;
    if (!saved) gameError("RETRYABLE", "Tamamlanan rota özeti henüz okunamıyor.", 409, true);
    return {
      distanceM: saved.distance_m,
      durationSeconds: saved.duration_seconds,
      acceptedPointCount: saved.accepted_point_count,
      closedClaimCount: saved.closed_claim_count,
    };
  }

  private getSessionRow(id: string) {
    return this.database.prepare("SELECT * FROM competitive_route_sessions WHERE id = ?").get(id) as SessionRow | undefined;
  }

  private getCandidateRow(id: string) {
    return this.database.prepare("SELECT * FROM loop_candidates WHERE id = ?").get(id) as CandidateRow | undefined;
  }

  private requireSessionIdentity(sessionId: string, userId: string, nonce: string) {
    const session = this.getSessionRow(sessionId);
    if (!session || session.user_id !== userId) gameError("NOT_FOUND", "Rota oturumu bulunamadı.", 404);
    if (!nonce || !safeEqualHex(session.server_nonce_hash, sha256(nonce))) gameError("NONCE_MISMATCH", "Rota oturumu doğrulanamadı.", 403);
    const expectedWorld = session.mode === "development_simulation" ? this.config.worlds.development : this.config.worlds.production;
    if (session.world_id !== expectedWorld) gameError("INVALID_SESSION", "Rota oturumu oyun dünyasıyla eşleşmiyor.", 409);
    if (process.env.NODE_ENV === "production" && session.mode === "development_simulation") {
      gameError("PRODUCTION_SIMULATION_FORBIDDEN", "Üretim dünyasında sanal konum kullanılamaz.", 403);
    }
    return session;
  }

  private requireSession(sessionId: string, userId: string, nonce: string, now: number) {
    const session = this.requireSessionIdentity(sessionId, userId, nonce);
    if (session.status === "revoked") gameError("SESSION_REVOKED", "Rota oturumu güvenlik nedeniyle sonlandırıldı.", 409);
    if (session.status !== "active" && session.status !== "paused" && session.status !== "closing") gameError("INVALID_SESSION", "Rota oturumu etkin değil.", 409);
    if (Date.parse(session.lease_expires_at) <= now) {
      this.database.prepare("UPDATE competitive_route_sessions SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('active','paused','closing')")
        .run(iso(now), sessionId);
      gameError("SESSION_EXPIRED", "Rota oturumunun süresi doldu.", 409);
    }
    return session;
  }

  private acceptedPoints(sessionId: string, throughSequence?: number, segmentIndex?: number) {
    return this.database.prepare(`
      SELECT sequence, latitude, longitude, accuracy_m, speed_mps, client_observed_at, received_at_server,
             classification, classification_reason, segment_index
      FROM route_points
      WHERE session_id = ? AND classification IN ('ACCEPTED', 'SUSPICIOUS')
        AND sequence <= COALESCE(?, sequence)
        AND segment_index = COALESCE(?, segment_index)
      ORDER BY sequence
    `).all(sessionId, throughSequence ?? null, segmentIndex ?? null) as PointRow[];
  }

  private currentTerritoryGeometry(userId: string, worldId: string) {
    const ownedCells = this.database.prepare("SELECT cell_id FROM territory_cells WHERE world_id = ? AND owner_id = ? ORDER BY cell_id")
      .all(worldId, userId) as Array<{ cell_id: string }>;
    if (ownedCells.length > 0) return this.cellsGeometry(ownedCells.map((row) => row.cell_id));
    if (worldId !== this.config.worlds.production) return null;
    const row = this.database.prepare("SELECT geojson FROM current_territories WHERE user_id = ?").get(userId) as { geojson: string } | undefined;
    if (!row) return null;
    try {
      const geometry = JSON.parse(row.geojson) as Polygon | MultiPolygon;
      return geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? geometry : null;
    } catch {
      return null;
    }
  }

  private reconstructCandidate(candidate: CandidateRow, session: SessionRow) {
    const stored = JSON.parse(candidate.polygon_json) as Polygon;
    if (stored.type !== "Polygon" || polygonHash(stored) !== candidate.coordinates_hash) gameError("INVALID_ROUTE", "Döngü adayı bütünlük kontrolünden geçemedi.", 422);
    const points = this.acceptedPoints(session.id, candidate.end_sequence, candidate.source_segment_index);
    const startExists = points.some((item) => item.sequence === candidate.start_sequence);
    const endExists = points.some((item) => item.sequence === candidate.end_sequence);
    if (!startExists || !endExists) gameError("INVALID_ROUTE", "Döngü rota aralığında eksik kabul edilmiş nokta var.", 422);
    if (candidate.source === "ACTIVE_ROUTE") {
      const detector = new LoopDetector({
        realProximityM: this.config.geometry.realProximityM,
        simulatedProximityM: this.config.geometry.simulatedProximityM,
        minimumAreaM2: this.config.geometry.minimumAreaM2,
        minimumRouteLengthM: this.config.geometry.minimumRouteLengthM,
        minimumIndexGap: this.config.geometry.minimumIndexGap,
        detectionCooldownMs: 0,
      });
      const detected = detector.detect(points.map(pointCoordinate), session.mode === "real_gps" ? "real" : "simulation", null, this.clock());
      if (!detected.loop || polygonHash(detected.loop.polygon) !== candidate.coordinates_hash) {
        gameError("INVALID_ROUTE", "Döngü sunucunun kabul ettiği rota noktalarından yeniden üretilemedi.", 422);
      }
      return detected.loop.polygon;
    }
    // OWN_TERRITORY closure was generated server-side against the confirmed boundary at detection time.
    // Its hash and accepted sequence range are immutable; client geometry is never consulted.
    return stored;
  }

  private validatePolygon(polygon: Polygon) {
    if (polygon.type !== "Polygon" || polygon.coordinates.length !== 1) gameError("INVALID_GEOMETRY", "Yalnızca tek halkalı alanlar kabul edilir.", 422);
    const ring = polygon.coordinates[0];
    if (ring.length < 4 || ring.length > this.config.geometry.maximumVertices) gameError("INVALID_GEOMETRY", "Alan nokta sayısı geçersiz.", 422);
    if (ring.some((coordinate) => coordinate.length < 2 || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || coordinate[0] < -180 || coordinate[0] > 180 || coordinate[1] < -85.05112878 || coordinate[1] > 85.05112878)) {
      gameError("INVALID_GEOMETRY", "Alan koordinatları geçersiz.", 422);
    }
    const polygonFeature = feature(polygon);
    if (!booleanValid(polygonFeature) || kinks(polygonFeature).features.length > 0) gameError("INVALID_GEOMETRY", "Alan geometrisi geçersiz veya kendi kendini kesiyor.", 422);
    const areaM2 = area(polygonFeature);
    if (!Number.isFinite(areaM2) || areaM2 < this.config.geometry.minimumAreaM2) gameError("INVALID_GEOMETRY", `Alan en az ${this.config.geometry.minimumAreaM2} m² olmalı.`, 422);
    if (areaM2 > this.config.geometry.maximumAreaM2) gameError("CLAIM_TOO_LARGE", "Tek alan talebi sınırı aşıyor.", 413);
    const bounds = bbox(polygonFeature);
    if (bounds[2] - bounds[0] > 180) gameError("INVALID_GEOMETRY", "Antimeridian geçen alan desteklenmiyor.", 422);
    const widthM = distance(point([bounds[0], (bounds[1] + bounds[3]) / 2]), point([bounds[2], (bounds[1] + bounds[3]) / 2]), { units: "meters" });
    const heightM = distance(point([(bounds[0] + bounds[2]) / 2, bounds[1]]), point([(bounds[0] + bounds[2]) / 2, bounds[3]]), { units: "meters" });
    if (Math.max(widthM, heightM) > this.config.geometry.maximumBoundingBoxKm * 1_000) gameError("CLAIM_TOO_LARGE", "Alan coğrafi genişlik sınırını aşıyor.", 413);
    const aspect = Math.max(widthM, heightM) / Math.max(0.01, Math.min(widthM, heightM));
    if (aspect > this.config.geometry.maximumAspectRatio) gameError("INVALID_GEOMETRY", "Aşırı ince alanlar kabul edilmez.", 422);
    return areaM2;
  }

  private findCompletedCommand(userId: string, idempotencyKey: string, payloadHash: string) {
    const row = this.database.prepare("SELECT payload_hash, result_json, status FROM claim_commands WHERE user_id = ? AND idempotency_key = ?")
      .get(userId, idempotencyKey) as { payload_hash: string; result_json: string | null; status: string } | undefined;
    if (!row) return null;
    if (row.payload_hash !== payloadHash) gameError("IDEMPOTENCY_CONFLICT", "Aynı işlem kimliği farklı bir alan talebiyle kullanıldı.", 409);
    if (!row.result_json) gameError("RETRYABLE", "Alan talebi hâlâ işleniyor; kısa süre sonra yeniden dene.", 409, true);
    return JSON.parse(row.result_json) as ClaimResult;
  }

  private scoreArea(worldId: string, userId: string) {
    return (this.database.prepare("SELECT COALESCE(SUM(area_m2), 0) AS area FROM territory_cells WHERE world_id = ? AND owner_id = ?")
      .get(worldId, userId) as { area: number }).area;
  }

  private recalculateScore(worldId: string, userId: string, claimIncrement: number, capturedAreaIncrement: number, updatedAt: string) {
    const aggregate = this.database.prepare(`
      SELECT COALESCE(SUM(area_m2), 0) AS area, COUNT(*) AS count
      FROM territory_cells WHERE world_id = ? AND owner_id = ?
    `).get(worldId, userId) as { area: number; count: number };
    const previous = this.database.prepare("SELECT claim_count, captured_area_m2 FROM player_scores WHERE world_id = ? AND user_id = ?")
      .get(worldId, userId) as { claim_count: number; captured_area_m2: number } | undefined;
    this.database.prepare(`
      INSERT INTO player_scores
        (world_id, user_id, unique_owned_area_m2, owned_cell_count, claim_count, captured_area_m2, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(world_id, user_id) DO UPDATE SET
        unique_owned_area_m2 = excluded.unique_owned_area_m2,
        owned_cell_count = excluded.owned_cell_count,
        claim_count = excluded.claim_count,
        captured_area_m2 = excluded.captured_area_m2,
        updated_at = excluded.updated_at
    `).run(
      worldId, userId, Math.max(0, aggregate.area), aggregate.count,
      (previous?.claim_count ?? 0) + claimIncrement,
      (previous?.captured_area_m2 ?? 0) + capturedAreaIncrement,
      updatedAt,
    );
  }

  private insertClaimNotifications(userId: string, eventId: string, captured: Map<string, number>, newAreaM2: number, capturedAreaM2: number) {
    const claimant = this.database.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string };
    this.database.prepare(`
      INSERT OR IGNORE INTO notifications
        (id, user_id, actor_id, type, title, body, source_event_id, resource_type, resource_id)
      VALUES (?, ?, ?, 'claim_confirmed', 'Alan onaylandı', ?, ?, 'claim', ?)
    `).run(randomUUID(), userId, userId, `Sunucu ${Math.round(newAreaM2 + capturedAreaM2).toLocaleString("tr-TR")} m² değişikliği onayladı.`, eventId, eventId);
    for (const [oldOwnerId, areaM2] of captured) {
      this.database.prepare(`
        INSERT OR IGNORE INTO notifications
          (id, user_id, actor_id, type, title, body, source_event_id, resource_type, resource_id)
        VALUES (?, ?, ?, 'territory_lost', 'Alan değişikliği', ?, ?, 'claim', ?)
      `).run(randomUUID(), oldOwnerId, userId, `@${claimant.username} ${Math.round(areaM2).toLocaleString("tr-TR")} m² alanı ele geçirdi.`, eventId, eventId);
    }
  }

  private syncLegacyProjection(
    session: SessionRow,
    polygon: Polygon,
    result: ClaimResult,
    color: string,
    affectedOwners: Set<string>,
    idempotencyKey: string,
  ) {
    if (session.world_id !== this.config.worlds.production) return;
    const now = result.committedAtServer;
    for (const ownerId of affectedOwners) {
      const cells = this.database.prepare("SELECT cell_id, paint_color_id, area_m2 FROM territory_cells WHERE world_id = ? AND owner_id = ? ORDER BY cell_id")
        .all(session.world_id, ownerId) as Array<{ cell_id: string; paint_color_id: string; area_m2: number }>;
      this.database.prepare("DELETE FROM territory_paints WHERE user_id = ?").run(ownerId);
      if (cells.length === 0) {
        this.database.prepare("DELETE FROM current_territories WHERE user_id = ?").run(ownerId);
        continue;
      }
      const geometry = this.cellsGeometry(cells.map((cell) => cell.cell_id));
      const totalArea = cells.reduce((sum, cell) => sum + cell.area_m2, 0);
      this.database.prepare(`
        INSERT INTO current_territories (user_id, geojson, area_m2, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET geojson = excluded.geojson, area_m2 = excluded.area_m2, updated_at = excluded.updated_at
      `).run(ownerId, JSON.stringify(geometry), totalArea, now);
      const paintGroups = new Map<string, string[]>();
      for (const cell of cells) paintGroups.set(cell.paint_color_id, [...(paintGroups.get(cell.paint_color_id) ?? []), cell.cell_id]);
      for (const [paintColor, cellIds] of paintGroups) {
        this.database.prepare("INSERT INTO territory_paints (id, user_id, geojson, color, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(sha256(`${session.world_id}:${ownerId}:${paintColor}`).slice(0, 32), ownerId, JSON.stringify(this.cellsGeometry(cellIds)), paintColor, now);
      }
    }
    const user = this.database.prepare("SELECT city, pattern FROM users WHERE id = ?").get(session.user_id) as { city: string; pattern: number };
    const distanceKm = session.accepted_distance_m / 1_000;
    const durationSeconds = Math.max(1, Math.round((Date.parse(now) - Date.parse(session.started_at_server)) / 1_000));
    this.database.prepare(`
      INSERT OR IGNORE INTO territories
        (id, user_id, idempotency_key, name, district, geojson, color, pattern, area_km2,
         newly_added_area_km2, overlap_area_km2, total_area_after_km2, distance_km, duration_seconds, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      result.claimEventId, session.user_id, idempotencyKey, "Onaylı mrap alanı", user.city,
      JSON.stringify(polygon), color, user.pattern, result.totalLoopAreaM2 / 1_000_000,
      result.newlyClaimedAreaM2 / 1_000_000, result.alreadyOwnedAreaM2 / 1_000_000,
      result.finalTerritoryAreaM2 / 1_000_000, distanceKm, durationSeconds, now,
    );
    this.database.prepare("UPDATE world_state SET version = version + 1 WHERE id = 1").run();
  }

  private cellsGeometry(cellIds: readonly string[]): Polygon | MultiPolygon {
    type Tile = { zoom: number; x: number; y: number };
    type Rectangle = { zoom: number; x1: number; x2: number; y1: number; y2: number };
    const tiles = cellIds.map((cellId): Tile => {
      const [zoom, x, y] = cellId.split("/").map(Number);
      return { zoom, x, y };
    }).sort((left, right) => left.zoom - right.zoom || left.y - right.y || left.x - right.x);
    const horizontalRuns: Rectangle[] = [];
    for (const tile of tiles) {
      const previous = horizontalRuns.at(-1);
      if (previous && previous.zoom === tile.zoom && previous.y1 === tile.y && previous.y2 === tile.y && previous.x2 + 1 === tile.x) {
        previous.x2 = tile.x;
      } else {
        horizontalRuns.push({ zoom: tile.zoom, x1: tile.x, x2: tile.x, y1: tile.y, y2: tile.y });
      }
    }
    const rectangles: Rectangle[] = [];
    for (const run of horizontalRuns) {
      const mergeTarget = rectangles.find((rectangle) =>
        rectangle.zoom === run.zoom
        && rectangle.x1 === run.x1
        && rectangle.x2 === run.x2
        && rectangle.y2 + 1 === run.y1,
      );
      if (mergeTarget) mergeTarget.y2 = run.y2;
      else rectangles.push({ ...run });
    }
    const polygons = rectangles.map((rectangle) => {
      const topLeft = this.grid.cellToGeometry(`${rectangle.zoom}/${rectangle.x1}/${rectangle.y1}`).coordinates[0];
      const bottomRight = this.grid.cellToGeometry(`${rectangle.zoom}/${rectangle.x2}/${rectangle.y2}`).coordinates[0];
      const west = topLeft[0][0];
      const north = topLeft[0][1];
      const east = bottomRight[2][0];
      const south = bottomRight[2][1];
      return [[[west, north], [east, north], [east, south], [west, south], [west, north]]];
    });
    if (polygons.length === 1) return { type: "Polygon", coordinates: polygons[0] };
    return { type: "MultiPolygon", coordinates: polygons };
  }
}
