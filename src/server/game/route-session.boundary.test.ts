import { afterEach, describe, expect, it, vi } from "vitest";

const configKeys = [
  "MRAP_ROUTE_SESSION_MAX_POINTS",
  "MRAP_ROUTE_SESSION_MAX_DISTANCE_M",
  "MRAP_ROUTE_SESSION_MAX_DURATION_SECONDS",
  "MRAP_ROUTE_SESSION_MAX_REAL_SPEED_MPS",
  "MRAP_ROUTE_SESSION_MAX_DEV_SPEED_MPS",
] as const;

async function loadRouteSession(overrides: Record<string, string>) {
  vi.unstubAllEnvs();
  for (const key of configKeys) vi.stubEnv(key, "invalid");
  vi.stubEnv("NODE_ENV", "test");
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("@/server/game/route-session");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("rota oturumu config ve hız sınırları", () => {
  it("geçerli pozitif değerleri kabul eder ve storage üst sınırında clamp eder", async () => {
    const { ROUTE_SESSION_CONFIG: config } = await loadRouteSession({
      MRAP_ROUTE_SESSION_MAX_POINTS: "20000",
      MRAP_ROUTE_SESSION_MAX_DISTANCE_M: "300000",
      MRAP_ROUTE_SESSION_MAX_DURATION_SECONDS: "90000",
      MRAP_ROUTE_SESSION_MAX_REAL_SPEED_MPS: "15.5",
      MRAP_ROUTE_SESSION_MAX_DEV_SPEED_MPS: "180",
    });

    expect(config).toEqual({
      maximumPoints: 10_000,
      maximumDistanceM: 250_000,
      maximumDurationSeconds: 86_400,
      maximumRealAverageSpeedMps: 15.5,
      maximumDevelopmentAverageSpeedMps: 180,
    });
  });

  it("sıfır, negatif, kesirli integer ve sonsuz değerlerde güvenli fallback kullanır", async () => {
    const { ROUTE_SESSION_CONFIG: config } = await loadRouteSession({
      MRAP_ROUTE_SESSION_MAX_POINTS: "1.5",
      MRAP_ROUTE_SESSION_MAX_DISTANCE_M: "0",
      MRAP_ROUTE_SESSION_MAX_DURATION_SECONDS: "-1",
      MRAP_ROUTE_SESSION_MAX_REAL_SPEED_MPS: "Infinity",
      MRAP_ROUTE_SESSION_MAX_DEV_SPEED_MPS: "-20",
    });

    expect(config.maximumPoints).toBe(10_000);
    expect(config.maximumDistanceM).toBe(250_000);
    expect(config.maximumDurationSeconds).toBe(86_400);
    expect(config.maximumRealAverageSpeedMps).toBe(12);
    expect(config.maximumDevelopmentAverageSpeedMps).toBe(100);
  });

  it("production gerçek GPS için gerçek hız limitini, diğer modlarda development limitini seçer", async () => {
    const routeSession = await loadRouteSession({
      MRAP_ROUTE_SESSION_MAX_REAL_SPEED_MPS: "12",
      MRAP_ROUTE_SESSION_MAX_DEV_SPEED_MPS: "100",
      NODE_ENV: "production",
    });

    expect(routeSession.maximumAllowedAverageSpeedMps("real")).toBe(12);
    expect(routeSession.maximumAllowedAverageSpeedMps("simulation")).toBe(100);
    vi.stubEnv("NODE_ENV", "test");
    expect(routeSession.maximumAllowedAverageSpeedMps("real")).toBe(100);
  });
});
