import "server-only";

function integer(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function decimal(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export const AUTHORITATIVE_GAME_CONFIG = Object.freeze({
  worlds: {
    production: process.env.MRAP_PRODUCTION_WORLD_ID?.trim() || "world-main",
    development: process.env.MRAP_DEVELOPMENT_WORLD_ID?.trim() || "development-sandbox",
  },
  grid: {
    cellZoom: integer("MRAP_CELL_ZOOM", 22, 16, 24),
    regionZoom: integer("MRAP_REGION_ZOOM", 14, 8, 18),
    maximumCandidateCells: integer("MRAP_MAX_CANDIDATE_CELLS", 25_000, 100, 100_000),
    maximumViewportRegions: integer("MRAP_MAX_VIEWPORT_REGIONS", 64, 1, 256),
  },
  sessions: {
    leaseSeconds: integer("MRAP_SESSION_LEASE_SECONDS", 1_800, 60, 21_600),
    candidateTtlSeconds: integer("MRAP_CANDIDATE_TTL_SECONDS", 300, 30, 3_600),
    minimumClaimDurationSeconds: integer("MRAP_MIN_CLAIM_DURATION_SECONDS", 3, 1, 300),
    maximumPoints: integer("MRAP_COMPETITIVE_MAX_POINTS", 10_000, 10, 25_000),
    maximumBatchPoints: integer("MRAP_MAX_POINT_BATCH", 100, 1, 500),
    maximumBatchBytes: integer("MRAP_MAX_POINT_BATCH_BYTES", 96_000, 1_024, 512_000),
  },
  location: {
    maximumAccuracyM: decimal("MRAP_MAX_GPS_ACCURACY_M", 65, 5, 500),
    suspiciousAccuracyM: decimal("MRAP_SUSPICIOUS_GPS_ACCURACY_M", 35, 3, 250),
    minimumPointSpacingM: decimal("MRAP_MIN_POINT_SPACING_M", 2, 0.25, 25),
    maximumRealSpeedMps: decimal("MRAP_MAX_REAL_SPEED_MPS", 12, 2, 60),
    suspiciousRealSpeedMps: decimal("MRAP_SUSPICIOUS_REAL_SPEED_MPS", 8, 1, 50),
    maximumSimulationSpeedMps: decimal("MRAP_MAX_SIM_SPEED_MPS", 125, 10, 500),
    maximumAccelerationMps2: decimal("MRAP_MAX_ACCELERATION_MPS2", 12, 1, 80),
    maximumClientBackfillSeconds: integer("MRAP_MAX_CLIENT_BACKFILL_SECONDS", 30, 5, 300),
    maximumClientFutureSkewSeconds: integer("MRAP_MAX_CLIENT_FUTURE_SKEW_SECONDS", 10, 1, 60),
    initialSampleGraceSeconds: integer("MRAP_INITIAL_SAMPLE_GRACE_SECONDS", 15, 1, 60),
    subsequentSampleGraceSeconds: integer("MRAP_SUBSEQUENT_SAMPLE_GRACE_SECONDS", 1, 0, 5),
    maximumTrackingGapSeconds: integer("MRAP_MAX_TRACKING_GAP_SECONDS", 20, 5, 300),
    serverDistanceBudgetSlackM: decimal("MRAP_SERVER_DISTANCE_BUDGET_SLACK_M", 10, 1, 100),
    maximumClaimRiskScore: integer("MRAP_MAX_CLAIM_RISK_SCORE", 15, 1, 100),
    minimumPointIntervalMs: integer("MRAP_MIN_POINT_INTERVAL_MS", 150, 20, 5_000),
    maximumSuspiciousRatio: decimal("MRAP_MAX_SUSPICIOUS_POINT_RATIO", 0.5, 0.05, 1),
  },
  geometry: {
    realProximityM: decimal("MRAP_REAL_LOOP_PROXIMITY_M", 12, 2, 50),
    simulatedProximityM: decimal("MRAP_SIM_LOOP_PROXIMITY_M", 4, 0.5, 25),
    minimumAreaM2: decimal("MRAP_MIN_LOOP_AREA_M2", 35, 1, 10_000),
    minimumRouteLengthM: decimal("MRAP_MIN_LOOP_ROUTE_M", 25, 3, 2_000),
    minimumIndexGap: integer("MRAP_MIN_LOOP_INDEX_GAP", 4, 2, 100),
    detectionCooldownMs: integer("MRAP_LOOP_COOLDOWN_MS", 4_500, 0, 60_000),
    maximumAreaM2: decimal("MRAP_MAX_CLAIM_AREA_M2", 25_000_000, 1_000, 500_000_000),
    maximumBoundingBoxKm: decimal("MRAP_MAX_CLAIM_BBOX_KM", 15, 0.1, 100),
    maximumAspectRatio: decimal("MRAP_MAX_CLAIM_ASPECT_RATIO", 150, 2, 5_000),
    maximumVertices: integer("MRAP_MAX_CLAIM_VERTICES", 3_500, 10, 10_000),
    minimumCellCount: integer("MRAP_MIN_CLAIM_CELL_COUNT", 1, 1, 100),
    maximumAreaPerRouteMeterM2: decimal("MRAP_MAX_AREA_PER_ROUTE_METER_M2", 5_000, 10, 100_000),
  },
  realtime: {
    maximumInlinePatchCells: integer("MRAP_MAX_INLINE_PATCH_CELLS", 350, 1, 5_000),
    maximumReplayEvents: integer("MRAP_MAX_REALTIME_REPLAY_EVENTS", 2_000, 100, 100_000),
    streamPollMs: integer("MRAP_STREAM_POLL_MS", 750, 100, 10_000),
    streamHeartbeatMs: integer("MRAP_STREAM_HEARTBEAT_MS", 15_000, 2_000, 60_000),
  },
  privacy: {
    rawLocationRetentionDays: integer("MRAP_RAW_LOCATION_RETENTION_DAYS", 30, 1, 365),
  },
  limits: {
    sharedIpMultiplier: integer("MRAP_SHARED_IP_RATE_LIMIT_MULTIPLIER", 20, 2, 1_000),
    sessionStartsPerHour: integer("MRAP_SESSION_STARTS_PER_HOUR", 20, 1, 500),
    pointBatchesPerMinute: integer("MRAP_POINT_BATCHES_PER_MINUTE", 120, 10, 2_000),
    candidatesPerMinute: integer("MRAP_CANDIDATES_PER_MINUTE", 30, 1, 1_000),
    claimsPerTenMinutes: integer("MRAP_CLAIMS_PER_TEN_MINUTES", 40, 1, 500),
    snapshotsPerMinute: integer("MRAP_SNAPSHOTS_PER_MINUTE", 120, 10, 2_000),
    realtimeSubscriptionsPerMinute: integer("MRAP_REALTIME_SUBSCRIPTIONS_PER_MINUTE", 30, 5, 500),
  },
  transaction: {
    maximumRetries: integer("MRAP_TRANSACTION_MAX_RETRIES", 3, 0, 8),
    retryBaseDelayMs: integer("MRAP_TRANSACTION_RETRY_BASE_DELAY_MS", 20, 1, 1_000),
    retryJitterMs: integer("MRAP_TRANSACTION_RETRY_JITTER_MS", 25, 0, 1_000),
  },
});

export type AuthoritativeGameConfig = typeof AUTHORITATIVE_GAME_CONFIG;

export function authoritativeWorldForMode(mode: "real_gps" | "development_simulation") {
  if (mode === "development_simulation") {
    if (process.env.NODE_ENV === "production") throw new Error("PRODUCTION_SIMULATION_FORBIDDEN");
    return AUTHORITATIVE_GAME_CONFIG.worlds.development;
  }
  return AUTHORITATIVE_GAME_CONFIG.worlds.production;
}
