import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const numericEnvironmentKeys = [
  "MRAP_CELL_ZOOM",
  "MRAP_REGION_ZOOM",
  "MRAP_MAX_CANDIDATE_CELLS",
  "MRAP_MAX_VIEWPORT_REGIONS",
  "MRAP_SESSION_LEASE_SECONDS",
  "MRAP_CANDIDATE_TTL_SECONDS",
  "MRAP_MIN_CLAIM_DURATION_SECONDS",
  "MRAP_COMPETITIVE_MAX_POINTS",
  "MRAP_MAX_POINT_BATCH",
  "MRAP_MAX_POINT_BATCH_BYTES",
  "MRAP_MAX_GPS_ACCURACY_M",
  "MRAP_SUSPICIOUS_GPS_ACCURACY_M",
  "MRAP_MIN_POINT_SPACING_M",
  "MRAP_MAX_REAL_SPEED_MPS",
  "MRAP_SUSPICIOUS_REAL_SPEED_MPS",
  "MRAP_MAX_SIM_SPEED_MPS",
  "MRAP_MAX_ACCELERATION_MPS2",
  "MRAP_MAX_CLIENT_BACKFILL_SECONDS",
  "MRAP_MAX_CLIENT_FUTURE_SKEW_SECONDS",
  "MRAP_INITIAL_SAMPLE_GRACE_SECONDS",
  "MRAP_SUBSEQUENT_SAMPLE_GRACE_SECONDS",
  "MRAP_MAX_TRACKING_GAP_SECONDS",
  "MRAP_SERVER_DISTANCE_BUDGET_SLACK_M",
  "MRAP_MAX_CLAIM_RISK_SCORE",
  "MRAP_MIN_POINT_INTERVAL_MS",
  "MRAP_MAX_SUSPICIOUS_POINT_RATIO",
  "MRAP_REAL_LOOP_PROXIMITY_M",
  "MRAP_SIM_LOOP_PROXIMITY_M",
  "MRAP_MIN_LOOP_AREA_M2",
  "MRAP_MIN_LOOP_ROUTE_M",
  "MRAP_MIN_LOOP_INDEX_GAP",
  "MRAP_LOOP_COOLDOWN_MS",
  "MRAP_MAX_CLAIM_AREA_M2",
  "MRAP_MAX_CLAIM_BBOX_KM",
  "MRAP_MAX_CLAIM_ASPECT_RATIO",
  "MRAP_MAX_CLAIM_VERTICES",
  "MRAP_MIN_CLAIM_CELL_COUNT",
  "MRAP_MAX_AREA_PER_ROUTE_METER_M2",
  "MRAP_MAX_INLINE_PATCH_CELLS",
  "MRAP_MAX_REALTIME_REPLAY_EVENTS",
  "MRAP_STREAM_POLL_MS",
  "MRAP_STREAM_HEARTBEAT_MS",
  "MRAP_RAW_LOCATION_RETENTION_DAYS",
  "MRAP_SHARED_IP_RATE_LIMIT_MULTIPLIER",
  "MRAP_SESSION_STARTS_PER_HOUR",
  "MRAP_POINT_BATCHES_PER_MINUTE",
  "MRAP_CANDIDATES_PER_MINUTE",
  "MRAP_CLAIMS_PER_TEN_MINUTES",
  "MRAP_SNAPSHOTS_PER_MINUTE",
  "MRAP_REALTIME_SUBSCRIPTIONS_PER_MINUTE",
  "MRAP_TRANSACTION_MAX_RETRIES",
  "MRAP_TRANSACTION_RETRY_BASE_DELAY_MS",
  "MRAP_TRANSACTION_RETRY_JITTER_MS",
] as const;

async function loadConfig(overrides: Record<string, string> = {}) {
  vi.unstubAllEnvs();
  for (const key of numericEnvironmentKeys) vi.stubEnv(key, "not-a-number");
  vi.stubEnv("MRAP_PRODUCTION_WORLD_ID", "");
  vi.stubEnv("MRAP_DEVELOPMENT_WORLD_ID", "");
  vi.stubEnv("NODE_ENV", "test");
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("@/server/game/authoritative-config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("authoritative oyun yapılandırması", () => {
  it("eksik veya sayısal olmayan değerlerde güvenli varsayılanlara döner", async () => {
    const { AUTHORITATIVE_GAME_CONFIG: config } = await loadConfig();

    expect(config.worlds).toEqual({
      production: "world-main",
      development: "development-sandbox",
    });
    expect(config.grid.cellZoom).toBe(22);
    expect(config.location.maximumAccuracyM).toBe(65);
    expect(config.location.maximumClientBackfillSeconds).toBe(30);
    expect(config.location.maximumClientFutureSkewSeconds).toBe(10);
    expect(config.location.subsequentSampleGraceSeconds).toBe(1);
    expect(config.location.maximumTrackingGapSeconds).toBe(20);
    expect(config.location.serverDistanceBudgetSlackM).toBe(10);
    expect(config.location.maximumClaimRiskScore).toBe(15);
    expect(config.geometry.detectionCooldownMs).toBe(4_500);
    expect(config.transaction.maximumRetries).toBe(3);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("integer ve decimal değerlerde alt/üst sınırı kabul edip sınır dışını reddeder", async () => {
    const { AUTHORITATIVE_GAME_CONFIG: config } = await loadConfig({
      MRAP_CELL_ZOOM: "16",
      MRAP_REGION_ZOOM: "18.5",
      MRAP_MAX_CANDIDATE_CELLS: "99",
      MRAP_MAX_VIEWPORT_REGIONS: "257",
      MRAP_TRANSACTION_MAX_RETRIES: "8",
      MRAP_MAX_GPS_ACCURACY_M: "5",
      MRAP_SUSPICIOUS_GPS_ACCURACY_M: "Infinity",
      MRAP_MIN_POINT_SPACING_M: "0.24",
      MRAP_MAX_REAL_SPEED_MPS: "61",
      MRAP_MAX_SUSPICIOUS_POINT_RATIO: "1",
    });

    expect(config.grid.cellZoom).toBe(16);
    expect(config.grid.regionZoom).toBe(14);
    expect(config.grid.maximumCandidateCells).toBe(25_000);
    expect(config.grid.maximumViewportRegions).toBe(64);
    expect(config.transaction.maximumRetries).toBe(8);
    expect(config.location.maximumAccuracyM).toBe(5);
    expect(config.location.suspiciousAccuracyM).toBe(35);
    expect(config.location.minimumPointSpacingM).toBe(2);
    expect(config.location.maximumRealSpeedMps).toBe(12);
    expect(config.location.maximumSuspiciousRatio).toBe(1);
  });

  it("dünya kimliklerini trim eder ve moda göre doğru dünyayı seçer", async () => {
    const configModule = await loadConfig({
      MRAP_PRODUCTION_WORLD_ID: "  mrap-live  ",
      MRAP_DEVELOPMENT_WORLD_ID: "  mrap-test  ",
    });

    expect(configModule.authoritativeWorldForMode("real_gps")).toBe("mrap-live");
    expect(configModule.authoritativeWorldForMode("development_simulation")).toBe("mrap-test");
  });

  it("production ortamında simülasyon dünyasına geçişi kapatır", async () => {
    const configModule = await loadConfig({ NODE_ENV: "production" });

    expect(() => configModule.authoritativeWorldForMode("development_simulation"))
      .toThrow("PRODUCTION_SIMULATION_FORBIDDEN");
    expect(configModule.authoritativeWorldForMode("real_gps")).toBe("world-main");
  });
});
