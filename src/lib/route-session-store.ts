import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RouteSession } from "@/lib/models";

type RouteSessionRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  payload_hash: string;
  location_mode: RouteSession["locationMode"];
  distance_m: number;
  duration_seconds: number;
  point_count: number;
  started_at: string;
  ended_at: string;
  created_at: string;
};

export type RecordRouteSessionInput = {
  idempotencyKey: string;
  payloadHash: string;
  locationMode: RouteSession["locationMode"];
  distanceM: number;
  durationSeconds: number;
  pointCount: number;
  startedAt: string;
  endedAt: string;
};

export class RouteSessionIdempotencyConflictError extends Error {
  constructor() {
    super("Aynı işlem kimliği farklı bir rota oturumu için kullanılamaz.");
    this.name = "RouteSessionIdempotencyConflictError";
  }
}

function toRouteSession(row: RouteSessionRow): RouteSession {
  return {
    id: row.id,
    userId: row.user_id,
    locationMode: row.location_mode,
    distanceM: row.distance_m,
    durationSeconds: row.duration_seconds,
    pointCount: row.point_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export function recordRouteSessionInDatabase(database: DatabaseSync, userId: string, input: RecordRouteSessionInput) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT * FROM route_sessions WHERE user_id = ? AND idempotency_key = ?")
      .get(userId, input.idempotencyKey) as RouteSessionRow | undefined;
    if (existing) {
      if (existing.payload_hash !== input.payloadHash) throw new RouteSessionIdempotencyConflictError();
      database.exec("COMMIT");
      return { session: toRouteSession(existing), created: false };
    }

    const id = randomUUID();
    database.prepare(`
      INSERT INTO route_sessions (
        id, user_id, idempotency_key, payload_hash, location_mode, distance_m,
        duration_seconds, point_count, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      input.idempotencyKey,
      input.payloadHash,
      input.locationMode,
      input.distanceM,
      input.durationSeconds,
      input.pointCount,
      input.startedAt,
      input.endedAt,
    );
    const inserted = database.prepare("SELECT * FROM route_sessions WHERE id = ?").get(id) as RouteSessionRow;
    database.exec("COMMIT");
    return { session: toRouteSession(inserted), created: true };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listRouteSessionsFromDatabase(database: DatabaseSync, userId: string, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return (database.prepare(`
    SELECT * FROM route_sessions
    WHERE user_id = ?
    ORDER BY ended_at DESC, created_at DESC
    LIMIT ?
  `).all(userId, safeLimit) as RouteSessionRow[]).map(toRouteSession);
}

export function getRouteSessionTotalsFromDatabase(database: DatabaseSync, userId: string) {
  return database.prepare(`
    SELECT
      COALESCE(SUM(distance_m), 0) AS distanceM,
      COALESCE(SUM(duration_seconds), 0) AS durationSeconds,
      COUNT(*) AS sessionCount
    FROM route_sessions WHERE user_id = ?
  `).get(userId) as { distanceM: number; durationSeconds: number; sessionCount: number };
}
