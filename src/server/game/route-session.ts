import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type { Coordinate, LocationMode } from "@/lib/game/types";

const STORAGE_LIMITS = Object.freeze({
  maximumPoints: 10_000,
  maximumDistanceM: 250_000,
  maximumDurationSeconds: 24 * 60 * 60,
});

function boundedPositiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function boundedPositiveNumber(value: string | undefined, fallback: number, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export const ROUTE_SESSION_CONFIG = Object.freeze({
  maximumPoints: boundedPositiveInteger(process.env.MRAP_ROUTE_SESSION_MAX_POINTS, STORAGE_LIMITS.maximumPoints, STORAGE_LIMITS.maximumPoints),
  maximumDistanceM: boundedPositiveNumber(process.env.MRAP_ROUTE_SESSION_MAX_DISTANCE_M, STORAGE_LIMITS.maximumDistanceM, STORAGE_LIMITS.maximumDistanceM),
  maximumDurationSeconds: boundedPositiveInteger(process.env.MRAP_ROUTE_SESSION_MAX_DURATION_SECONDS, STORAGE_LIMITS.maximumDurationSeconds, STORAGE_LIMITS.maximumDurationSeconds),
  maximumRealAverageSpeedMps: boundedPositiveNumber(process.env.MRAP_ROUTE_SESSION_MAX_REAL_SPEED_MPS, 12),
  maximumDevelopmentAverageSpeedMps: boundedPositiveNumber(process.env.MRAP_ROUTE_SESSION_MAX_DEV_SPEED_MPS, 100),
});

export function isRouteCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value)
    && value.length === 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -85
    && value[1] <= 85;
}

export function calculateTrackedDistanceM(coordinates: readonly Coordinate[]) {
  let totalDistanceM = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    totalDistanceM += distance(point(coordinates[index - 1]), point(coordinates[index]), { units: "meters" });
  }
  return totalDistanceM;
}

export function maximumAllowedAverageSpeedMps(locationMode: LocationMode) {
  return process.env.NODE_ENV === "production" && locationMode === "real"
    ? ROUTE_SESSION_CONFIG.maximumRealAverageSpeedMps
    : ROUTE_SESSION_CONFIG.maximumDevelopmentAverageSpeedMps;
}
