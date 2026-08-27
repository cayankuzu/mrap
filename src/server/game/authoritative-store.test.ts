import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { MultiPolygon, Polygon } from "geojson";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ROUTE_COLORS } from "@/lib/app-config";
import type { CloseLoopCommand, LocationPointCommand, RouteSessionDto } from "@/lib/game/authoritative-types";
import type { SpatialOwnershipGrid } from "@/lib/spatial/ownership-grid";
import { AUTHORITATIVE_GAME_CONFIG, type AuthoritativeGameConfig } from "@/server/game/authoritative-config";
import { AuthoritativeGameError, type GameErrorCode } from "@/server/game/authoritative-error";
import { AuthoritativeGameStore } from "@/server/game/authoritative-store";
import { ensureAuthoritativeGameSchema } from "@/server/game/schema";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const WORLD = "development-sandbox";
const REGION = "14/0/0";
const CELL_A = "22/100/100";
const CELL_B = "22/101/100";
const CELL_C = "22/102/100";
const CELL_D = "22/103/100";

type Player = {
  userId: string;
  session: RouteSessionDto;
  lastSequence: number;
};

type ScoreRow = {
  unique_owned_area_m2: number;
  owned_cell_count: number;
  claim_count: number;
  captured_area_m2: number;
};

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function polygonKey(polygon: Polygon) {
  return JSON.stringify(polygon);
}

function polygonHash(polygon: Polygon) {
  const normalized = polygon.coordinates.map((ring) => ring.map((coordinate) => [
    Number(coordinate[0].toFixed(7)),
    Number(coordinate[1].toFixed(7)),
  ]));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

class DeterministicGrid implements SpatialOwnershipGrid {
  private readonly plans = new Map<string, string[]>();
  private readonly areas = new Map<string, number>([
    [CELL_A, 100],
    [CELL_B, 150],
    [CELL_C, 200],
    [CELL_D, 250],
  ]);
  fallbackCells = [CELL_A];

  plan(polygon: Polygon, cells: readonly string[]) {
    this.plans.set(polygonKey(polygon), [...cells]);
  }

  async polygonToCells(polygon: Polygon) {
    return [...(this.plans.get(polygonKey(polygon)) ?? this.fallbackCells)];
  }

  cellToGeometry(cellId: string): Polygon {
    const x = Number(cellId.split("/")[1] ?? 100);
    const west = 29 + (x - 100) * 0.0002;
    return rectangle(west, 41, west + 0.0001, 41.0001);
  }

  getRegionId() {
    return REGION;
  }

  calculateCellAreaM2(cellId: string) {
    return this.areas.get(cellId) ?? 100;
  }
}

function testConfig(): AuthoritativeGameConfig {
  return {
    ...AUTHORITATIVE_GAME_CONFIG,
    grid: {
      ...AUTHORITATIVE_GAME_CONFIG.grid,
      maximumCandidateCells: 1_000,
      maximumViewportRegions: 16,
    },
    sessions: {
      ...AUTHORITATIVE_GAME_CONFIG.sessions,
      leaseSeconds: 600,
      candidateTtlSeconds: 300,
      maximumPoints: 1_000,
      maximumBatchPoints: 100,
    },
    location: {
      ...AUTHORITATIVE_GAME_CONFIG.location,
      maximumAccuracyM: 100,
      suspiciousAccuracyM: 60,
      minimumPointSpacingM: 1,
      maximumSimulationSpeedMps: 500,
      maximumAccelerationMps2: 1_000,
      minimumPointIntervalMs: 100,
      maximumSuspiciousRatio: 0.9,
    },
    geometry: {
      ...AUTHORITATIVE_GAME_CONFIG.geometry,
      realProximityM: 12,
      simulatedProximityM: 4,
      minimumAreaM2: 10,
      minimumRouteLengthM: 5,
      minimumIndexGap: 3,
      detectionCooldownMs: 0,
      maximumAreaM2: 1_000_000_000_000_000,
      maximumBoundingBoxKm: 2,
      maximumAspectRatio: 20,
      maximumVertices: 12,
    },
    realtime: {
      ...AUTHORITATIVE_GAME_CONFIG.realtime,
      maximumInlinePatchCells: 100,
    },
  };
}

function createLegacySchema(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#0D8BFF',
      pattern INTEGER NOT NULL DEFAULT 0,
      city TEXT NOT NULL DEFAULT 'İstanbul'
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE current_territories (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      geojson TEXT NOT NULL,
      area_m2 REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

let database: DatabaseSync;
let grid: DeterministicGrid;
let store: AuthoritativeGameStore;
let now: number;
let sequenceId: number;

beforeEach(() => {
  now = NOW;
  sequenceId = 0;
  database = new DatabaseSync(":memory:");
  createLegacySchema(database);
  ensureAuthoritativeGameSchema(database);
  const insertUser = database.prepare("INSERT INTO users (id, email, username, color, pattern, city) VALUES (?, ?, ?, ?, ?, ?)");
  for (const [index, userId] of ["x", "y", "z", "spectator"].entries()) {
    insertUser.run(userId, `${userId}@example.test`, `user_${userId}`, ROUTE_COLORS[index], index, "İstanbul");
  }
  grid = new DeterministicGrid();
  store = new AuthoritativeGameStore(database, testConfig(), grid, () => now);
});

afterEach(() => {
  vi.unstubAllEnvs();
  database.close();
});

function nextId(prefix: string) {
  sequenceId += 1;
  return `${prefix}-${String(sequenceId).padStart(8, "0")}`;
}

function pointCommand(sequence: number, longitude = 29 + sequence * 0.0001, latitude = 41): LocationPointCommand {
  return {
    sequence,
    longitude,
    latitude,
    accuracyM: 3,
    clientObservedAt: new Date(NOW + sequence * 1_000).toISOString(),
  };
}

function startOnly(userId: string) {
  return store.startSession(userId, "development_simulation", nextId("correlation"));
}

function appendPoints(userId: string, session: RouteSessionDto, points: LocationPointCommand[]) {
  return store.appendPointBatch({
    userId,
    sessionId: session.id,
    nonce: session.serverNonce,
    idempotencyKey: nextId("point-batch"),
    points,
  });
}

function preparePlayer(userId: string): Player {
  const session = startOnly(userId);
  const response = appendPoints(userId, session, [pointCommand(1), pointCommand(2)]);
  now += (testConfig().sessions.minimumClaimDurationSeconds + 1) * 1_000;
  return { userId, session, lastSequence: response.lastAcceptedSequence };
}

function seedCandidate(player: Player, geometry: Polygon | MultiPolygon, candidateId = nextId("candidate")) {
  const isPolygon = geometry.type === "Polygon";
  database.prepare(`
    INSERT INTO loop_candidates
      (id, session_id, user_id, start_sequence, end_sequence, source_segment_index, source,
       coordinates_hash, polygon_json, estimated_area_m2, route_length_m, status, detected_at_server, expires_at)
    VALUES (?, ?, ?, 1, ?, 0, 'OWN_TERRITORY', ?, ?, 100, 20, 'available', ?, ?)
  `).run(
    candidateId,
    player.session.id,
    player.userId,
    player.lastSequence,
    isPolygon ? polygonHash(geometry) : "0".repeat(64),
    JSON.stringify(geometry),
    new Date(now).toISOString(),
    new Date(now + 300_000).toISOString(),
  );
  return candidateId;
}

function commandFor(
  player: Player,
  candidateId: string,
  options: { color?: string; idempotencyKey?: string; sessionId?: string; lastSequence?: number } = {},
): CloseLoopCommand {
  return {
    sessionId: options.sessionId ?? player.session.id,
    candidateId,
    lastAcceptedPointSequence: options.lastSequence ?? player.lastSequence,
    selectedColorId: options.color ?? ROUTE_COLORS[0],
    idempotencyKey: options.idempotencyKey ?? nextId("claim-command"),
  };
}

async function claimPolygon(
  player: Player,
  polygon: Polygon,
  cells: readonly string[],
  options: { color?: string; idempotencyKey?: string } = {},
) {
  grid.plan(polygon, cells);
  const candidateId = seedCandidate(player, polygon);
  const command = commandFor(player, candidateId, options);
  const result = await store.claim({ userId: player.userId, nonce: player.session.serverNonce, command });
  return { result, command, candidateId };
}

function score(userId: string): ScoreRow {
  return (database.prepare(`
    SELECT unique_owned_area_m2, owned_cell_count, claim_count, captured_area_m2
    FROM player_scores WHERE world_id = ? AND user_id = ?
  `).get(WORLD, userId) as ScoreRow | undefined) ?? {
    unique_owned_area_m2: 0,
    owned_cell_count: 0,
    claim_count: 0,
    captured_area_m2: 0,
  };
}

function ownedArea(userId: string) {
  return (database.prepare("SELECT COALESCE(SUM(area_m2), 0) AS area FROM territory_cells WHERE world_id = ? AND owner_id = ?")
    .get(WORLD, userId) as { area: number }).area;
}

function ownerOf(cellId: string) {
  return (database.prepare("SELECT owner_id, paint_color_id FROM territory_cells WHERE world_id = ? AND cell_id = ?")
    .get(WORLD, cellId) as { owner_id: string; paint_color_id: string } | undefined) ?? null;
}

function tableCount(table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function expectCode(error: unknown, code: GameErrorCode) {
  expect(error).toBeInstanceOf(AuthoritativeGameError);
  expect(error).toMatchObject({ code });
}

async function expectRejectedCode(promise: Promise<unknown>, code: GameErrorCode) {
  try {
    await promise;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expectCode(error, code);
  }
}

function assertScoreInvariant(userIds: readonly string[]) {
  for (const userId of userIds) {
    const current = score(userId);
    const area = ownedArea(userId);
    const count = (database.prepare("SELECT COUNT(*) AS count FROM territory_cells WHERE world_id = ? AND owner_id = ?")
      .get(WORLD, userId) as { count: number }).count;
    expect(current.unique_owned_area_m2).toBeCloseTo(area, 8);
    expect(current.owned_cell_count).toBe(count);
    expect(current.unique_owned_area_m2).toBeGreaterThanOrEqual(0);
    expect(current.owned_cell_count).toBeGreaterThanOrEqual(0);
  }
}

describe("authoritative session ve nokta kabulü", () => {
  it("9 — aynı kullanıcı için yalnızca bir etkin competitive session oluşturur", () => {
    const first = startOnly("x");

    expect(() => startOnly("x")).toThrow(AuthoritativeGameError);
    expect(tableCount("competitive_route_sessions")).toBe(1);
    expect(store.getSessionWorld("x", first.id)).toBe(WORLD);
    expect(tableCount("audit_events")).toBe(1);
  });

  it("expired sessionı kapatıp aynı kullanıcıya yeni session açar", () => {
    const first = startOnly("x");
    now += testConfig().sessions.leaseSeconds * 1_000 + 1;

    const second = startOnly("x");
    const firstStatus = database.prepare("SELECT status FROM competitive_route_sessions WHERE id = ?").get(first.id) as { status: string };

    expect(firstStatus.status).toBe("expired");
    expect(second.id).not.toBe(first.id);
  });

  it("sekme kaybında hesap sahibinin oturumu onayla devralıp eski nonce'u iptal etmesini sağlar", () => {
    const original = startOnly("x");
    appendPoints("x", original, [pointCommand(1), pointCommand(2)]);

    const recovery = store.takeOverActiveSession("x", "development_simulation", nextId("correlation"));

    expect(recovery.session).toMatchObject({
      id: original.id,
      currentSegmentIndex: 1,
      lastReceivedSequence: 2,
      lastAcceptedSequence: 2,
    });
    expect(recovery.session.serverNonce).not.toBe(original.serverNonce);
    expect(recovery.currentSegmentPoints).toEqual([]);
    expect(recovery.totalDistanceM).toBeGreaterThan(0);
    expect(() => appendPoints("x", original, [pointCommand(3)])).toThrow(AuthoritativeGameError);

    const resumed = appendPoints("x", recovery.session, [pointCommand(3, 30, 42)]);
    expect(resumed.classifications[0]).toMatchObject({ classification: "ACCEPTED", reason: "tracking_gap_anchor" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'route_session_takeover'").get())
      .toEqual({ count: 1 });
  });

  it("çevrimdışı taslaktan sonra idempotent online segment sınırı açar", () => {
    const session = startOnly("x");
    appendPoints("x", session, [pointCommand(1), pointCommand(2)]);

    const boundary = store.beginOnlineSegment({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      expectedCurrentSegmentIndex: 0,
      correlationId: nextId("correlation"),
    });
    const replay = store.beginOnlineSegment({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      expectedCurrentSegmentIndex: 0,
      correlationId: nextId("correlation"),
    });

    expect(boundary.currentSegmentIndex).toBe(1);
    expect(replay.currentSegmentIndex).toBe(1);
    const resumed = appendPoints("x", boundary, [pointCommand(3, 29.01, 41)]);
    expect(resumed.classifications[0]).toMatchObject({ classification: "ACCEPTED", reason: "tracking_gap_anchor" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'route_session_online_segment'").get())
      .toEqual({ count: 1 });
  });

  it("çıkışta etkin lease'i iptal eder ve ham rota noktalarını hemen temizler", () => {
    const session = startOnly("x");
    appendPoints("x", session, [pointCommand(1), pointCommand(2)]);

    expect(store.revokeActiveSessionsForUser("x", nextId("correlation"))).toBe(1);
    expect(database.prepare("SELECT status FROM competitive_route_sessions WHERE id = ?").get(session.id))
      .toEqual({ status: "revoked" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM route_points WHERE session_id = ?").get(session.id))
      .toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'route_sessions_logout_revoke'").get())
      .toEqual({ count: 1 });
    expect(() => appendPoints("x", session, [pointCommand(3)])).toThrow(AuthoritativeGameError);
    expect(store.revokeActiveSessionsForUser("x", nextId("correlation"))).toBe(0);
  });

  it("nonce ve owner izolasyonunu her nokta mutasyonunda doğrular", () => {
    const session = startOnly("x");
    const base = {
      sessionId: session.id,
      idempotencyKey: "point-batch-auth-0001",
      points: [pointCommand(1)],
    };

    try {
      store.appendPointBatch({ ...base, userId: "y", nonce: session.serverNonce });
      throw new Error("owner isolation expected");
    } catch (error) {
      expectCode(error, "NOT_FOUND");
    }
    try {
      store.appendPointBatch({ ...base, userId: "x", nonce: "wrong-nonce" });
      throw new Error("nonce mismatch expected");
    } catch (error) {
      expectCode(error, "NONCE_MISMATCH");
    }
    expect(tableCount("route_points")).toBe(0);
  });

  it("idempotent point batch replayinde tek batch ve tek nokta seti bırakır", () => {
    const session = startOnly("x");
    const input = {
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      idempotencyKey: "point-batch-replay-0001",
      points: [pointCommand(1), pointCommand(2)],
    };

    const first = store.appendPointBatch(input);
    const replay = store.appendPointBatch(input);

    expect(replay).toEqual(first);
    expect(tableCount("route_point_batches")).toBe(1);
    expect(tableCount("route_points")).toBe(2);
    const sessionRow = database.prepare("SELECT accepted_point_count, last_received_sequence FROM competitive_route_sessions WHERE id = ?")
      .get(session.id);
    expect(sessionRow).toEqual({ accepted_point_count: 2, last_received_sequence: 2 });
  });

  it("yalnız session sahibi ve nonce ile güncel segmenti kurtarır", () => {
    const session = startOnly("x");
    appendPoints("x", session, [pointCommand(1), pointCommand(2)]);

    const recovery = store.getSessionRecovery({ userId: "x", sessionId: session.id, nonce: session.serverNonce });

    expect(recovery.session).toMatchObject({
      id: session.id,
      lastReceivedSequence: 2,
      lastAcceptedSequence: 2,
      currentSegmentIndex: 0,
    });
    expect(recovery.currentSegmentPoints).toHaveLength(2);
    expect(recovery.currentSegmentPoints[0]).toMatchObject({ coordinate: [29.0001, 41], accuracyM: 3 });
    expect(recovery.totalDistanceM).toBeGreaterThan(0);
    expect(recovery.availableCandidate).toBeNull();

    for (const credentials of [
      { userId: "y", nonce: session.serverNonce },
      { userId: "x", nonce: "wrong-nonce" },
    ]) {
      expect(() => store.getSessionRecovery({ ...credentials, sessionId: session.id })).toThrow(AuthoritativeGameError);
    }
  });

  it("aynı batch anahtarını farklı payload ile kullanmayı reddeder", () => {
    const session = startOnly("x");
    const input = {
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      idempotencyKey: "point-batch-conflict-01",
      points: [pointCommand(1)],
    };
    store.appendPointBatch(input);

    try {
      store.appendPointBatch({ ...input, points: [{ ...pointCommand(1), accuracyM: 4 }] });
      throw new Error("idempotency conflict expected");
    } catch (error) {
      expectCode(error, "IDEMPOTENCY_CONFLICT");
    }
    expect(tableCount("route_points")).toBe(1);
  });

  it("batch içi ve session devamındaki sequence gap durumlarını atomik reddeder", () => {
    const session = startOnly("x");

    for (const points of [[pointCommand(1), pointCommand(3)], [pointCommand(2)]]) {
      try {
        store.appendPointBatch({
          userId: "x",
          sessionId: session.id,
          nonce: session.serverNonce,
          idempotencyKey: nextId("sequence-gap"),
          points,
        });
        throw new Error("sequence gap expected");
      } catch (error) {
        expectCode(error, "SEQUENCE_GAP");
      }
    }
    expect(tableCount("route_points")).toBe(0);
    expect(tableCount("route_point_batches")).toBe(0);
  });

  it("26 — duplicate GPS noktasını alan girdisi yapmak yerine jitter olarak yok sayar", () => {
    const session = startOnly("x");
    const first = pointCommand(1, 29, 41);
    const duplicate = pointCommand(2, 29, 41);

    const result = appendPoints("x", session, [first, duplicate]);

    expect(result).toMatchObject({ acceptedCount: 1, ignoredCount: 1, lastReceivedSequence: 2, lastAcceptedSequence: 1 });
    expect(result.classifications[1]).toMatchObject({ classification: "IGNORED_OUTLIER", reason: "duplicate_or_jitter" });
  });

  it.each([
    ["27 — NaN", Number.NaN],
    ["28 — Infinity", Number.POSITIVE_INFINITY],
  ])("%s koordinatını transaction başlamadan reddeder", (_label, invalidLatitude) => {
    const session = startOnly("x");

    try {
      appendPoints("x", session, [{ ...pointCommand(1), latitude: invalidLatitude }]);
      throw new Error("invalid point expected");
    } catch (error) {
      expectCode(error, "INVALID_REQUEST");
    }
    expect(tableCount("route_points")).toBe(0);
  });

  it("gerçek GPS paketinde gözlem zamanını zorunlu tutar", () => {
    const session = store.startSession("x", "real_gps", nextId("correlation"));

    try {
      appendPoints("x", session, [{ ...pointCommand(1), clientObservedAt: undefined }]);
      throw new Error("observed time required");
    } catch (error) {
      expectCode(error, "INVALID_REQUEST");
    }

    expect(tableCount("route_points")).toBe(0);
    expect(tableCount("route_point_batches")).toBe(0);
  });

  it("oturum öncesi, eski ve ileri tarihli gerçek GPS noktalarını alan girdisinden çıkarır", () => {
    const beforeSession = store.startSession("x", "real_gps", nextId("correlation"));
    const beforeResult = appendPoints("x", beforeSession, [{
      ...pointCommand(1),
      clientObservedAt: new Date(NOW - (testConfig().location.initialSampleGraceSeconds + 1) * 1_000).toISOString(),
    }]);
    expect(beforeResult.classifications[0]).toMatchObject({ classification: "IGNORED_OUTLIER", reason: "before_session_start" });

    const staleSession = store.startSession("y", "real_gps", nextId("correlation"));
    now += (testConfig().location.maximumClientBackfillSeconds + 2) * 1_000;
    const staleResult = appendPoints("y", staleSession, [{
      ...pointCommand(1),
      clientObservedAt: new Date(NOW + 1_000).toISOString(),
    }]);
    expect(staleResult.classifications[0]).toMatchObject({ classification: "IGNORED_OUTLIER", reason: "stale_client_time" });

    const futureSession = store.startSession("z", "real_gps", nextId("correlation"));
    const futureResult = appendPoints("z", futureSession, [{
      ...pointCommand(1),
      clientObservedAt: new Date(now + (testConfig().location.maximumClientFutureSkewSeconds + 1) * 1_000).toISOString(),
    }]);
    expect(futureResult.classifications[0]).toMatchObject({ classification: "IGNORED_OUTLIER", reason: "future_client_time" });
  });

  it("yalnız ilk GPS örneğine başlangıç toleransı verir; geçmiş rota paketi kabul etmez", () => {
    const session = store.startSession("x", "real_gps", nextId("correlation"));
    const result = appendPoints("x", session, [
      { ...pointCommand(1, 29, 41), clientObservedAt: new Date(NOW - 10_000).toISOString() },
      { ...pointCommand(2, 29.00005, 41), clientObservedAt: new Date(NOW - 8_000).toISOString() },
    ]);

    expect(result.classifications).toEqual([
      { sequence: 1, classification: "ACCEPTED" },
      { sequence: 2, classification: "IGNORED_OUTLIER", reason: "before_session_start" },
    ]);
    expect(result.lastAcceptedSequence).toBe(1);
  });

  it("istemci zamanını uzatarak sunucu mesafe bütçesinin aşılamamasını sağlar", () => {
    const session = store.startSession("x", "real_gps", nextId("correlation"));
    const first = {
      ...pointCommand(1, 29, 41),
      clientObservedAt: new Date(NOW - 14_000).toISOString(),
    };
    appendPoints("x", session, [first]);
    now += 1_000;

    const result = appendPoints("x", session, [{
      ...pointCommand(2, 29.0013, 41),
      clientObservedAt: new Date(now).toISOString(),
    }]);

    expect(result.classifications[0]).toMatchObject({
      classification: "IGNORED_OUTLIER",
      reason: "server_distance_budget",
    });
    expect(database.prepare("SELECT accepted_distance_m, risk_score FROM competitive_route_sessions WHERE id = ?")
      .get(session.id)).toEqual({ accepted_distance_m: 0, risk_score: 5 });
  });

  it("arka plan dönüşünü yeni segment yapar ve aradaki sıçramayı mesafeye katmaz", () => {
    const session = store.startSession("x", "real_gps", nextId("correlation"));
    appendPoints("x", session, [{ ...pointCommand(1, 29, 41), clientObservedAt: new Date(now).toISOString() }]);
    now += (testConfig().location.maximumTrackingGapSeconds + 1) * 1_000;
    const resumed = appendPoints("x", session, [{
      ...pointCommand(2, 29.01, 41),
      clientObservedAt: new Date(now).toISOString(),
    }]);
    now += 1_000;
    appendPoints("x", session, [{ ...pointCommand(3, 29.01005, 41), clientObservedAt: new Date(now).toISOString() }]);

    expect(resumed.classifications[0]).toMatchObject({ classification: "ACCEPTED", reason: "tracking_gap_anchor" });
    expect(database.prepare("SELECT sequence, segment_index FROM route_points WHERE session_id = ? ORDER BY sequence")
      .all(session.id)).toEqual([
      { sequence: 1, segment_index: 0 },
      { sequence: 2, segment_index: 1 },
      { sequence: 3, segment_index: 1 },
    ]);
    const distanceRow = database.prepare("SELECT accepted_distance_m FROM competitive_route_sessions WHERE id = ?")
      .get(session.id) as { accepted_distance_m: number };
    expect(distanceRow.accepted_distance_m).toBeGreaterThan(3);
    expect(distanceRow.accepted_distance_m).toBeLessThan(6);
  });

  it("56 — kapanmamış rota mesafe üretse bile territory skorunu değiştirmez", () => {
    const session = startOnly("x");
    appendPoints("x", session, [pointCommand(1), pointCommand(2), pointCommand(3)]);
    now += 20_000;

    const finished = store.finishSession({ userId: "x", sessionId: session.id, nonce: session.serverNonce });

    expect(finished.route.distanceM).toBeGreaterThan(0);
    expect(finished.route.closedClaimCount).toBe(0);
    expect(score("x").unique_owned_area_m2).toBe(0);
    expect(tableCount("territory_cells")).toBe(0);
  });
});

describe("server-side loop ve geometri doğrulaması", () => {
  it("minimum beş noktalı loop'un tamamı şüpheliyse candidate üretmez", () => {
    const session = startOnly("x");
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.0005, 41.0005],
      [29, 41.0005],
      [29.00001, 41],
    ] as const;
    const response = appendPoints("x", session, coordinates.map(([longitude, latitude], index) => ({
      ...pointCommand(index + 1, longitude, latitude),
      accuracyM: testConfig().location.suspiciousAccuracyM + 1,
    })));

    expect(response.suspiciousCount).toBe(5);
    try {
      store.createLoopCandidate({
        userId: "x",
        sessionId: session.id,
        nonce: session.serverNonce,
        lastAcceptedPointSequence: response.lastAcceptedSequence,
      });
      throw new Error("suspicious loop expected to fail");
    } catch (error) {
      expectCode(error, "INVALID_ROUTE");
    }
    expect(tableCount("loop_candidates")).toBe(0);
  });

  it("21 — basit kapalı loop için server candidate üretir ve aynı rotadan claim eder", async () => {
    const session = startOnly("x");
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.0005, 41.0005],
      [29, 41.0005],
      [29.00001, 41],
    ] as const;
    const response = appendPoints("x", session, coordinates.map(([longitude, latitude], index) => pointCommand(index + 1, longitude, latitude)));

    const candidate = store.createLoopCandidate({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      lastAcceptedPointSequence: response.lastAcceptedSequence,
    });

    expect(candidate.status).toBe("available");
    expect(candidate.startSequence).toBe(1);
    expect(candidate.endSequence).toBe(5);
    expect(candidate.estimatedAreaM2).toBeGreaterThan(10);

    now += (testConfig().sessions.minimumClaimDurationSeconds + 1) * 1_000;
    const result = await store.claim({
      userId: "x",
      nonce: session.serverNonce,
      command: commandFor({ userId: "x", session, lastSequence: response.lastAcceptedSequence }, candidate.id),
    });
    expect(result.status).toBe("accepted");
    expect(ownerOf(CELL_A)?.owner_id).toBe("x");
  });

  it("nonmodal loop paneli açıkken gelen sonraki noktayı claim geometrisine katmadan kabul eder", async () => {
    const session = startOnly("x");
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.0005, 41.0005],
      [29, 41.0005],
      [29.00001, 41],
    ] as const;
    const detected = appendPoints(
      "x",
      session,
      coordinates.map(([longitude, latitude], index) => pointCommand(index + 1, longitude, latitude)),
    );
    const candidate = store.createLoopCandidate({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      lastAcceptedPointSequence: detected.lastAcceptedSequence,
    });
    const later = appendPoints("x", session, [pointCommand(6, 29.0008, 41.0008)]);
    expect(later.lastAcceptedSequence).toBeGreaterThan(candidate.endSequence);
    const command = commandFor(
      { userId: "x", session, lastSequence: later.lastAcceptedSequence },
      candidate.id,
    );
    const raced = appendPoints("x", session, [pointCommand(7, 29.0009, 41.0009)]);
    expect(raced.lastAcceptedSequence).toBeGreaterThan(command.lastAcceptedPointSequence);
    now += (testConfig().sessions.minimumClaimDurationSeconds + 1) * 1_000;

    const result = await store.claim({
      userId: "x",
      nonce: session.serverNonce,
      command,
    });

    expect(result.status).toBe("accepted");
    const event = database.prepare("SELECT raw_polygon_json FROM claim_events WHERE candidate_id = ?")
      .get(candidate.id) as { raw_polygon_json: string };
    expect(polygonHash(JSON.parse(event.raw_polygon_json) as Polygon)).toBe(candidate.coordinatesHash);
  });

  it("candidate watermark aralığı dışındaki ve başka segmente taşınmış claimleri reddeder", async () => {
    const player = preparePlayer("x");
    const candidateId = seedCandidate(player, rectangle(29, 41, 29.001, 41.001));

    await expectRejectedCode(
      store.claim({
        userId: "x",
        nonce: player.session.serverNonce,
        command: commandFor(player, candidateId, { lastSequence: player.lastSequence + 1 }),
      }),
      "SEQUENCE_GAP",
    );

    const nextSegment = store.beginOnlineSegment({
      userId: "x",
      sessionId: player.session.id,
      nonce: player.session.serverNonce,
      expectedCurrentSegmentIndex: 0,
    });
    expect(nextSegment.currentSegmentIndex).toBe(1);
    expect(database.prepare("SELECT status FROM loop_candidates WHERE id = ?").get(candidateId))
      .toEqual({ status: "expired" });
    await expectRejectedCode(
      store.claim({
        userId: "x",
        nonce: player.session.serverNonce,
        command: commandFor(player, candidateId),
      }),
      "CONFLICT",
    );
    expect(tableCount("claim_events")).toBe(0);
  });

  it("candidate kaynağını rota içi nokta indeksine değil immutable session segmentine bağlar", () => {
    const initial = startOnly("x");
    const session = store.beginOnlineSegment({
      userId: "x",
      sessionId: initial.id,
      nonce: initial.serverNonce,
      expectedCurrentSegmentIndex: 0,
    });
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.0005, 41.0005],
      [29, 41.0005],
      [29.00001, 41],
    ] as const;
    const response = appendPoints(
      "x",
      session,
      coordinates.map(([longitude, latitude], index) => pointCommand(index + 1, longitude, latitude)),
    );

    const candidate = store.createLoopCandidate({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      lastAcceptedPointSequence: response.lastAcceptedSequence,
    });

    expect(candidate.sourceSegmentIndex).toBe(1);
  });

  it("22 — başlangıç noktasına dönmeden eski aktif çizgiye temasla candidate üretir", () => {
    const session = startOnly("x");
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.001, 41],
      [29.001, 41.0005],
      [29.0005, 41.0005],
      [29.00051, 41],
    ] as const;
    const response = appendPoints("x", session, coordinates.map(([longitude, latitude], index) => pointCommand(index + 1, longitude, latitude)));

    const candidate = store.createLoopCandidate({
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      lastAcceptedPointSequence: response.lastAcceptedSequence,
    });

    expect(candidate.startSequence).toBe(2);
    expect(candidate.endSequence).toBe(6);
  });

  it("candidate üretimini exact server sequence ile sınırlar", () => {
    const player = preparePlayer("x");

    try {
      store.createLoopCandidate({
        userId: player.userId,
        sessionId: player.session.id,
        nonce: player.session.serverNonce,
        lastAcceptedPointSequence: player.lastSequence - 1,
      });
      throw new Error("sequence gap expected");
    } catch (error) {
      expectCode(error, "SEQUENCE_GAP");
    }
  });

  const selfIntersecting: Polygon = {
    type: "Polygon",
    coordinates: [[
      [29, 41],
      [29.002, 41.002],
      [29, 41.002],
      [29.002, 41],
      [29, 41.001],
      [29.002, 41.001],
      [29, 41],
    ]],
  };
  const zeroArea: Polygon = {
    type: "Polygon",
    coordinates: [[[29, 41], [29.001, 41], [29.002, 41], [29, 41]]],
  };
  const tooManyVertices: Polygon = {
    type: "Polygon",
    coordinates: [[
      ...Array.from({ length: 13 }, (_, index) => {
        const angle = index / 13 * Math.PI * 2;
        return [29 + Math.cos(angle) * 0.001, 41 + Math.sin(angle) * 0.001];
      }),
      [29.001, 41],
    ]],
  };
  const makeValidWouldChangeShape: Polygon = {
    type: "Polygon",
    coordinates: [[[29, 41], [29.003, 41.003], [29, 41.003], [29.003, 41], [29, 41]]],
  };

  it.each([
    ["23 — çoklu self-intersection", selfIntersecting, "INVALID_GEOMETRY"],
    ["24 — minimum altı tiny polygon", rectangle(29, 41, 29.000001, 41.000001), "INVALID_GEOMETRY"],
    ["25 — zero-area polygon", zeroArea, "INVALID_GEOMETRY"],
    ["29 — fazla vertex", tooManyVertices, "INVALID_GEOMETRY"],
    ["30 — aşırı büyük bbox", rectangle(29, 41, 29.1, 41.1), "CLAIM_TOO_LARGE"],
    ["31 — aşırı ince sliver", rectangle(29, 41, 29.01, 41.00001), "INVALID_GEOMETRY"],
    ["32 — antimeridian", rectangle(-179, 41, 179, 41.001), "INVALID_GEOMETRY"],
    ["33 — desteklenmeyen latitude", rectangle(29, 85, 29.001, 86), "INVALID_GEOMETRY"],
    ["34 — make-valid büyük değişim gerektiren bow-tie", makeValidWouldChangeShape, "INVALID_GEOMETRY"],
  ] as const)("%s server claim doğrulamasında reddedilir", async (_label, polygon, expectedCode) => {
    const player = preparePlayer("x");
    const candidateId = seedCandidate(player, polygon);

    await expectRejectedCode(
      store.claim({ userId: player.userId, nonce: player.session.serverNonce, command: commandFor(player, candidateId) }),
      expectedCode,
    );
    expect(tableCount("claim_events")).toBe(0);
    expect(tableCount("territory_cells")).toBe(0);
  });

  it("35 — bağımsız geometry parçalarını tek claim olarak kabul etmez", async () => {
    const player = preparePlayer("x");
    const independent: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [rectangle(29, 41, 29.001, 41.001).coordinates, rectangle(30, 42, 30.001, 42.001).coordinates],
    };
    const candidateId = seedCandidate(player, independent);

    await expectRejectedCode(
      store.claim({ userId: player.userId, nonce: player.session.serverNonce, command: commandFor(player, candidateId) }),
      "INVALID_ROUTE",
    );
  });
});

describe("commit sırası, sahiplik ve idempotency", () => {
  const sharedPolygon = rectangle(29, 41, 29.001, 41.001);

  it.each([
    ["1 — X commit ardından Y commit", ["x", "y"], "y"],
    ["2 — Y commit ardından X commit", ["y", "x"], "x"],
  ] as const)("%s sonunda overlap son commit sahibinde kalır", async (_label, order, expectedOwner) => {
    const players = { x: preparePlayer("x"), y: preparePlayer("y") };

    for (const userId of order) await claimPolygon(players[userId], sharedPolygon, [CELL_A]);

    expect(ownerOf(CELL_A)?.owner_id).toBe(expectedOwner);
    expect(score(expectedOwner).unique_owned_area_m2).toBe(100);
    expect(score(expectedOwner === "x" ? "y" : "x").unique_owned_area_m2).toBe(0);
    expect(tableCount("territory_cells")).toBe(1);
    assertScoreInvariant(["x", "y"]);
  });

  it("3 — aynı polygona yarışan iki claimde region versionları kesintisiz sıralar", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    grid.plan(sharedPolygon, [CELL_A]);
    const xCandidate = seedCandidate(x, sharedPolygon);
    const yCandidate = seedCandidate(y, sharedPolygon);

    await Promise.all([
      store.claim({ userId: "x", nonce: x.session.serverNonce, command: commandFor(x, xCandidate) }),
      store.claim({ userId: "y", nonce: y.session.serverNonce, command: commandFor(y, yCandidate, { color: ROUTE_COLORS[1] }) }),
    ]);

    const versions = database.prepare("SELECT previous_version, version FROM realtime_outbox WHERE world_id = ? AND region_id = ? ORDER BY sequence")
      .all(WORLD, REGION);
    expect(versions).toEqual([{ previous_version: 0, version: 1 }, { previous_version: 1, version: 2 }]);
    expect((database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(WORLD, REGION) as { version: number }).version).toBe(2);
    expect(tableCount("territory_cells")).toBe(1);
    assertScoreInvariant(["x", "y"]);
  });

  it("4 — üç oyuncunun aynı hücre yarışında deterministik olarak son commit kazanır", async () => {
    const players = [preparePlayer("x"), preparePlayer("y"), preparePlayer("z")];

    for (const [index, player] of players.entries()) {
      await claimPolygon(player, sharedPolygon, [CELL_A], { color: ROUTE_COLORS[index] });
    }

    expect(ownerOf(CELL_A)).toEqual({ owner_id: "z", paint_color_id: ROUTE_COLORS[2] });
    expect(score("x").unique_owned_area_m2).toBe(0);
    expect(score("y").unique_owned_area_m2).toBe(0);
    expect(score("z").unique_owned_area_m2).toBe(100);
    expect((database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(WORLD, REGION) as { version: number }).version).toBe(3);
  });

  it("5 — partial overlapta yalnız benzersiz hücre alanlarını skorlar", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    const xPolygon = rectangle(29, 41, 29.001, 41.001);
    const yPolygon = rectangle(29.0005, 41, 29.0015, 41.001);

    const xClaim = await claimPolygon(x, xPolygon, [CELL_A, CELL_B]);
    const yClaim = await claimPolygon(y, yPolygon, [CELL_B, CELL_C], { color: ROUTE_COLORS[1] });

    expect(xClaim.result.newlyClaimedAreaM2).toBe(250);
    expect(yClaim.result).toMatchObject({ newlyClaimedAreaM2: 200, capturedFromOthersAreaM2: 150 });
    expect(ownerOf(CELL_A)?.owner_id).toBe("x");
    expect(ownerOf(CELL_B)?.owner_id).toBe("y");
    expect(ownerOf(CELL_C)?.owner_id).toBe("y");
    expect(score("x").unique_owned_area_m2).toBe(100);
    expect(score("y").unique_owned_area_m2).toBe(350);
    expect(score("x").unique_owned_area_m2 + score("y").unique_owned_area_m2).toBe(450);
    assertScoreInvariant(["x", "y"]);
  });

  it("6 — yalnız exact boundary temasında komşu sahipliği transfer etmez", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    const left = rectangle(29, 41, 29.001, 41.001);
    const right = rectangle(29.001, 41, 29.002, 41.001);

    await claimPolygon(x, left, [CELL_A]);
    await claimPolygon(y, right, [CELL_B], { color: ROUTE_COLORS[1] });

    expect(ownerOf(CELL_A)?.owner_id).toBe("x");
    expect(ownerOf(CELL_B)?.owner_id).toBe("y");
    expect(tableCount("claim_cell_changes")).toBe(2);
  });

  it("7/8/40 — claim replay ve timeout retry tek event, tek score artışı döndürür", async () => {
    const player = preparePlayer("x");
    grid.plan(sharedPolygon, [CELL_A, CELL_B]);
    const candidateId = seedCandidate(player, sharedPolygon);
    const command = commandFor(player, candidateId, { idempotencyKey: "claim-timeout-retry-0001" });

    const first = await store.claim({ userId: "x", nonce: player.session.serverNonce, command });
    const replay = await store.claim({ userId: "x", nonce: player.session.serverNonce, command });
    const polled = store.getCommandResult("x", command.idempotencyKey);

    expect(replay).toEqual(first);
    expect(polled.result).toEqual(first);
    expect(tableCount("claim_commands")).toBe(1);
    expect(tableCount("claim_events")).toBe(1);
    expect(tableCount("realtime_outbox")).toBe(1);
    expect(score("x")).toMatchObject({ unique_owned_area_m2: 250, owned_cell_count: 2, claim_count: 1 });
  });

  it("10 — rival paint yarışında commit sırası final owner ve painti belirler", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");

    await claimPolygon(x, sharedPolygon, [CELL_A], { color: ROUTE_COLORS[0] });
    await claimPolygon(y, sharedPolygon, [CELL_A], { color: ROUTE_COLORS[1] });
    await claimPolygon(x, sharedPolygon, [CELL_A], { color: ROUTE_COLORS[2] });

    expect(ownerOf(CELL_A)).toEqual({ owner_id: "x", paint_color_id: ROUTE_COLORS[2] });
    expect(score("x").unique_owned_area_m2).toBe(100);
    expect(score("y").unique_owned_area_m2).toBe(0);
    expect(tableCount("realtime_outbox")).toBe(3);
  });

  it("41 — aynı idempotency key farklı claim payloadında conflict üretir", async () => {
    const player = preparePlayer("x");
    grid.plan(sharedPolygon, [CELL_A]);
    const candidateId = seedCandidate(player, sharedPolygon);
    const idempotencyKey = "claim-payload-conflict-01";
    const first = commandFor(player, candidateId, { idempotencyKey, color: ROUTE_COLORS[0] });
    await store.claim({ userId: "x", nonce: player.session.serverNonce, command: first });

    await expectRejectedCode(
      store.claim({
        userId: "x",
        nonce: player.session.serverNonce,
        command: { ...first, selectedColorId: ROUTE_COLORS[1] },
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(tableCount("claim_events")).toBe(1);
  });
});

describe("claim yetkilendirme ve kötü niyetli girdiler", () => {
  const polygon = rectangle(29, 41, 29.001, 41.001);

  it("36 — client owner spoof girişini session owner kontrolünde reddeder", async () => {
    const x = preparePlayer("x");
    grid.plan(polygon, [CELL_A]);
    const candidateId = seedCandidate(x, polygon);

    await expectRejectedCode(
      store.claim({ userId: "y", nonce: x.session.serverNonce, command: commandFor(x, candidateId) }),
      "NOT_FOUND",
    );
    expect(tableCount("claim_events")).toBe(0);
  });

  it("37 — başka session kimliğiyle candidate claim edilemez", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    grid.plan(polygon, [CELL_A]);
    const xCandidate = seedCandidate(x, polygon);

    await expectRejectedCode(
      store.claim({
        userId: "x",
        nonce: x.session.serverNonce,
        command: commandFor(x, xCandidate, { sessionId: y.session.id }),
      }),
      "NOT_FOUND",
    );
  });

  it("38 — başka kullanıcıya ait candidate mevcut sessiona taşınamaz", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    grid.plan(polygon, [CELL_A]);
    const yCandidate = seedCandidate(y, polygon);

    await expectRejectedCode(
      store.claim({ userId: "x", nonce: x.session.serverNonce, command: commandFor(x, yCandidate) }),
      "NOT_FOUND",
    );
  });

  it("46 — production ortamında simulated GPS sessionını store seviyesinde yasaklar", () => {
    vi.stubEnv("NODE_ENV", "production");

    try {
      startOnly("x");
      throw new Error("production simulation rejection expected");
    } catch (error) {
      expectCode(error, "PRODUCTION_SIMULATION_FORBIDDEN");
    }
    expect(tableCount("competitive_route_sessions")).toBe(0);
  });

  it("49 — palette dışı ve script benzeri color payloadını reddeder", async () => {
    const player = preparePlayer("x");
    const candidateId = seedCandidate(player, polygon);

    await expectRejectedCode(
      store.claim({
        userId: "x",
        nonce: player.session.serverNonce,
        command: commandFor(player, candidateId, { color: "#fff'); DROP TABLE users; --" }),
      }),
      "INVALID_COLOR",
    );
    expect(tableCount("users")).toBe(4);
  });

  it("50 — SQLi-benzeri idempotency ve user payloadları SQL olarak çalışmaz", () => {
    const session = startOnly("x");

    try {
      store.appendPointBatch({
        userId: "x",
        sessionId: session.id,
        nonce: session.serverNonce,
        idempotencyKey: "aaaaaaaaaaaaaaaa'; DROP TABLE users;--",
        points: [pointCommand(1)],
      });
      throw new Error("invalid key expected");
    } catch (error) {
      expectCode(error, "INVALID_REQUEST");
    }
    expect(() => store.getSessionWorld("x' OR 1=1 --", session.id)).toThrow(AuthoritativeGameError);
    expect(tableCount("users")).toBe(4);
    expect(database.prepare("SELECT username FROM users WHERE id = ?").get("x")).toEqual({ username: "user_x" });
  });
});

describe("territory, score, paint ve rollback invariantları", () => {
  const polygon = rectangle(29, 41, 29.001, 41.001);

  it("51/52/54 — capture sonunda hücrenin tek sahibi vardır ve iki skor da cell toplamına eşittir", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    await claimPolygon(x, polygon, [CELL_A, CELL_B]);

    const beforeX = score("x").unique_owned_area_m2;
    const capture = await claimPolygon(y, polygon, [CELL_B], { color: ROUTE_COLORS[1] });

    expect(beforeX).toBe(250);
    expect(capture.result.capturedFromOthersAreaM2).toBe(150);
    expect(score("x").unique_owned_area_m2).toBe(100);
    expect(score("y").unique_owned_area_m2).toBe(150);
    expect(database.prepare("SELECT COUNT(*) AS count FROM territory_cells WHERE world_id = ? AND cell_id = ?")
      .get(WORLD, CELL_B)).toEqual({ count: 1 });
    expect(ownerOf(CELL_B)?.owner_id).toBe("y");
    assertScoreInvariant(["x", "y"]);
  });

  it("53/55 — self-overlap farklı renkle yalnız painti değiştirir, territory score artmaz", async () => {
    const player = preparePlayer("x");
    await claimPolygon(player, polygon, [CELL_A], { color: ROUTE_COLORS[0] });
    const before = score("x");

    const repaint = await claimPolygon(player, polygon, [CELL_A], { color: ROUTE_COLORS[5] });
    const after = score("x");

    expect(repaint.result).toMatchObject({
      newlyClaimedAreaM2: 0,
      capturedFromOthersAreaM2: 0,
      alreadyOwnedAreaM2: 100,
      finalTerritoryAreaM2: 100,
    });
    expect(after.unique_owned_area_m2).toBe(before.unique_owned_area_m2);
    expect(after.owned_cell_count).toBe(before.owned_cell_count);
    expect(after.claim_count).toBe(before.claim_count + 1);
    expect(ownerOf(CELL_A)?.paint_color_id).toBe(ROUTE_COLORS[5]);
    assertScoreInvariant(["x"]);
  });

  it("58 — aynı owner ve aynı renkte no-op repaint claim event veya region patch üretmez", async () => {
    const player = preparePlayer("x");
    await claimPolygon(player, polygon, [CELL_A], { color: ROUTE_COLORS[0] });
    const before = {
      events: tableCount("claim_events"),
      outbox: tableCount("realtime_outbox"),
      version: (database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(WORLD, REGION) as { version: number }).version,
      score: score("x"),
    };

    const noop = await claimPolygon(player, polygon, [CELL_A], { color: ROUTE_COLORS[0] });

    expect(noop.result.status).toBe("rejected");
    expect(noop.result.claimEventId).toMatch(/^noop-/);
    expect(tableCount("claim_events")).toBe(before.events);
    expect(tableCount("realtime_outbox")).toBe(before.outbox);
    expect((database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(WORLD, REGION) as { version: number }).version).toBe(before.version);
    expect(score("x")).toEqual(before.score);
  });

  it("57/60 — transaction ortasında hata tüm cell, score, event, version ve notification deltalarını geri alır", async () => {
    const x = preparePlayer("x");
    const y = preparePlayer("y");
    await claimPolygon(x, polygon, [CELL_A, CELL_B]);
    grid.plan(polygon, [CELL_B, CELL_C]);
    const yCandidate = seedCandidate(y, polygon);
    const yCommand = commandFor(y, yCandidate, { color: ROUTE_COLORS[1] });
    const before = {
      cells: database.prepare("SELECT * FROM territory_cells ORDER BY cell_id").all(),
      scores: database.prepare("SELECT * FROM player_scores ORDER BY user_id").all(),
      events: database.prepare("SELECT * FROM claim_events ORDER BY id").all(),
      changes: database.prepare("SELECT * FROM claim_cell_changes ORDER BY claim_event_id, cell_id").all(),
      regions: database.prepare("SELECT * FROM world_regions ORDER BY region_id").all(),
      outbox: database.prepare("SELECT * FROM realtime_outbox ORDER BY sequence").all(),
      notifications: database.prepare("SELECT * FROM notifications ORDER BY id").all(),
    };
    database.exec(`
      CREATE TRIGGER fail_claim_change_for_test
      BEFORE INSERT ON claim_cell_changes
      BEGIN SELECT RAISE(ABORT, 'forced claim rollback'); END;
    `);

    await expect(store.claim({ userId: "y", nonce: y.session.serverNonce, command: yCommand })).rejects.toThrow(/forced claim rollback/);

    expect(database.prepare("SELECT * FROM territory_cells ORDER BY cell_id").all()).toEqual(before.cells);
    expect(database.prepare("SELECT * FROM player_scores ORDER BY user_id").all()).toEqual(before.scores);
    expect(database.prepare("SELECT * FROM claim_events ORDER BY id").all()).toEqual(before.events);
    expect(database.prepare("SELECT * FROM claim_cell_changes ORDER BY claim_event_id, cell_id").all()).toEqual(before.changes);
    expect(database.prepare("SELECT * FROM world_regions ORDER BY region_id").all()).toEqual(before.regions);
    expect(database.prepare("SELECT * FROM realtime_outbox ORDER BY sequence").all()).toEqual(before.outbox);
    expect(database.prepare("SELECT * FROM notifications ORDER BY id").all()).toEqual(before.notifications);
    expect(database.prepare("SELECT status FROM loop_candidates WHERE id = ?").get(yCandidate)).toEqual({ status: "available" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM claim_commands WHERE idempotency_key = ?").get(yCommand.idempotencyKey)).toEqual({ count: 0 });
    assertScoreInvariant(["x", "y"]);

    database.exec("DROP TRIGGER fail_claim_change_for_test");
    await store.claim({ userId: "y", nonce: y.session.serverNonce, command: yCommand });
    expect(ownerOf(CELL_B)?.owner_id).toBe("y");
    assertScoreInvariant(["x", "y"]);
  });

  it("51–55/59 — deterministik claim fuzz akışında tüm cell/score invariantlarını her committe korur", async () => {
    const players = [preparePlayer("x"), preparePlayer("y"), preparePlayer("z")];
    const cells = [CELL_A, CELL_B, CELL_C, CELL_D];
    let randomState = 0x5eed1234;
    const random = () => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      return randomState / 2 ** 32;
    };

    for (let index = 0; index < 30; index += 1) {
      const player = players[Math.floor(random() * players.length)];
      const firstCellIndex = Math.floor(random() * cells.length);
      const width = random() > 0.55 ? 2 : 1;
      const targetCells = Array.from({ length: width }, (_, offset) => cells[(firstCellIndex + offset) % cells.length]);
      const claimShape = rectangle(29 + index * 0.00001, 41, 29.0005 + index * 0.00001, 41.0005);
      await claimPolygon(player, claimShape, targetCells, { color: ROUTE_COLORS[index % ROUTE_COLORS.length] });

      assertScoreInvariant(["x", "y", "z"]);
      const physicalArea = (database.prepare("SELECT COALESCE(SUM(area_m2), 0) AS area FROM territory_cells WHERE world_id = ?")
        .get(WORLD) as { area: number }).area;
      const scoreTotal = (database.prepare("SELECT COALESCE(SUM(unique_owned_area_m2), 0) AS area FROM player_scores WHERE world_id = ?")
        .get(WORLD) as { area: number }).area;
      expect(scoreTotal).toBeCloseTo(physicalArea, 8);
      expect(database.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT cell_id) AS unique_cells FROM territory_cells WHERE world_id = ?")
        .get(WORLD)).toMatchObject({ total: cells.filter((cellId) => ownerOf(cellId)).length, unique_cells: cells.filter((cellId) => ownerOf(cellId)).length });
    }

    for (const player of players) expect(score(player.userId).unique_owned_area_m2).toBeGreaterThanOrEqual(0);
  });
});

describe("schema ve read model sözleşmeleri", () => {
  it("legacy notifications tablosuna source_event_id ekler ve schema çağrısı idempotenttir", () => {
    ensureAuthoritativeGameSchema(database);
    ensureAuthoritativeGameSchema(database);

    const columns = database.prepare("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("source_event_id");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("snapshot ve outbox okumalarını region ile sınırlar, GPS/rota payloadı yayınlamaz", async () => {
    const player = preparePlayer("x");
    await claimPolygon(player, rectangle(29, 41, 29.001, 41.001), [CELL_A], { color: ROUTE_COLORS[3] });

    const snapshot = store.getRegionSnapshot(WORLD, [REGION, REGION]);
    const events = store.listRegionEvents(WORLD, [REGION], 0);

    expect(snapshot.versions).toEqual({ [REGION]: 1 });
    expect(snapshot.cells).toEqual([{
      cellId: CELL_A,
      regionId: REGION,
      ownerId: "x",
      ownerUsername: "user_x",
      paintColorId: ROUTE_COLORS[3],
    }]);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toMatch(/latitude|longitude|route_points|serverNonce/i);
  });
});

describe("authoritative audit regresyonları", () => {
  const polygon = rectangle(29, 41, 29.001, 41.001);

  it("restricted tek hücrede bile claimi atomik ve idempotent reddeder", async () => {
    const player = preparePlayer("x");
    grid.plan(polygon, [CELL_A, CELL_B]);
    database.prepare(`
      INSERT INTO restricted_regions (world_id, cell_id, reason, active)
      VALUES (?, ?, 'physical_safety', 1)
    `).run(WORLD, CELL_B);
    const candidateId = seedCandidate(player, polygon);
    const command = commandFor(player, candidateId, { idempotencyKey: "restricted-claim-retry-01" });

    const first = await store.claim({ userId: "x", nonce: player.session.serverNonce, command });

    expect(first).toMatchObject({
      status: "rejected",
      newlyClaimedAreaM2: 0,
      capturedFromOthersAreaM2: 0,
      restrictedAreaM2: 150,
      finalTerritoryAreaM2: 0,
      affectedRegionVersions: {},
    });
    expect(tableCount("territory_cells")).toBe(0);
    expect(tableCount("player_scores")).toBe(0);
    expect(tableCount("claim_events")).toBe(0);
    expect(tableCount("claim_cell_changes")).toBe(0);
    expect(tableCount("realtime_outbox")).toBe(0);
    expect(database.prepare("SELECT version FROM world_regions WHERE world_id = ? AND region_id = ?").get(WORLD, REGION)).toEqual({ version: 0 });
    expect(database.prepare("SELECT status, error_code FROM claim_commands WHERE idempotency_key = ?").get(command.idempotencyKey))
      .toEqual({ status: "REJECTED_RESTRICTED", error_code: "RESTRICTED_REGION" });
    expect(database.prepare("SELECT status FROM loop_candidates WHERE id = ?").get(candidateId)).toEqual({ status: "invalid" });

    store.finishSession({ userId: "x", sessionId: player.session.id, nonce: player.session.serverNonce });
    const replay = await store.claim({ userId: "x", nonce: player.session.serverNonce, command });
    expect(replay).toEqual(first);
    expect(tableCount("claim_commands")).toBe(1);
  });

  it("aynı point batch completed session sonrasında özgün yanıtı döndürür", () => {
    const session = startOnly("x");
    const input = {
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      idempotencyKey: "point-after-finish-0001",
      points: [pointCommand(1), pointCommand(2)],
    };
    const first = store.appendPointBatch(input);
    now += 10_000;
    store.finishSession({ userId: "x", sessionId: session.id, nonce: session.serverNonce });

    expect(store.appendPointBatch(input)).toEqual(first);
    expect(tableCount("route_point_batches")).toBe(1);
    expect(tableCount("route_points")).toBe(2);
  });

  it("saklama süresi dolan tamamlanmış ve terk edilmiş oturumların ham konumlarını temizler", () => {
    const completed = startOnly("x");
    appendPoints("x", completed, [pointCommand(1), pointCommand(2)]);
    now += 10_000;
    store.finishSession({ userId: "x", sessionId: completed.id, nonce: completed.serverNonce });

    const abandoned = startOnly("y");
    appendPoints("y", abandoned, [pointCommand(1), pointCommand(2)]);
    expect(tableCount("route_points")).toBe(4);

    now += 31 * 24 * 60 * 60 * 1_000;
    expect(store.purgeExpiredRawLocations()).toBe(4);
    expect(tableCount("route_points")).toBe(0);
    expect(database.prepare("SELECT status FROM competitive_route_sessions WHERE id = ?").get(abandoned.id))
      .toEqual({ status: "expired" });
  });

  it("eşzamanlı finish tekrarında tek saved route ve aynı özet kalır", async () => {
    const session = startOnly("x");
    appendPoints("x", session, [pointCommand(1), pointCommand(2), pointCommand(3)]);
    now += 10_000;

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => store.finishSession({ userId: "x", sessionId: session.id, nonce: session.serverNonce })),
      Promise.resolve().then(() => store.finishSession({ userId: "x", sessionId: session.id, nonce: session.serverNonce })),
    ]);

    expect(second).toEqual(first);
    expect(tableCount("authoritative_saved_routes")).toBe(1);
    expect(database.prepare("SELECT status FROM competitive_route_sessions WHERE id = ?").get(session.id)).toEqual({ status: "completed" });
  });

  it("aynı route ucunu tek candidate yapar; continue/claim yarışı tek terminal karar üretir", async () => {
    const session = startOnly("x");
    const coordinates = [
      [29, 41],
      [29.0005, 41],
      [29.0005, 41.0005],
      [29, 41.0005],
      [29.00001, 41],
    ] as const;
    const response = appendPoints("x", session, coordinates.map(([longitude, latitude], index) => pointCommand(index + 1, longitude, latitude)));
    const candidateInput = {
      userId: "x",
      sessionId: session.id,
      nonce: session.serverNonce,
      lastAcceptedPointSequence: response.lastAcceptedSequence,
    };
    const firstCandidate = store.createLoopCandidate(candidateInput);
    const replayCandidate = store.createLoopCandidate(candidateInput);
    expect(replayCandidate.id).toBe(firstCandidate.id);
    expect(tableCount("loop_candidates")).toBe(1);

    now += (testConfig().sessions.minimumClaimDurationSeconds + 1) * 1_000;
    const player = { userId: "x", session, lastSequence: response.lastAcceptedSequence } satisfies Player;
    const command = commandFor(player, firstCandidate.id, { idempotencyKey: "claim-continue-race-001" });
    const outcomes = await Promise.allSettled([
      store.claim({ userId: "x", nonce: session.serverNonce, command }),
      Promise.resolve().then(() => store.continueCandidate({ userId: "x", candidateId: firstCandidate.id, nonce: session.serverNonce })),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const terminal = database.prepare("SELECT status FROM loop_candidates WHERE id = ?").get(firstCandidate.id) as { status: string };
    expect(["accepted", "continued"]).toContain(terminal.status);
    expect(tableCount("claim_events")).toBe(terminal.status === "accepted" ? 1 : 0);
    expect(tableCount("claim_commands")).toBe(terminal.status === "accepted" ? 1 : 0);
  });
});
