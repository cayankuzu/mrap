function numericConfig(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const GAME_CONFIG = Object.freeze({
  location: {
    minimumPointSpacingM: numericConfig(process.env.NEXT_PUBLIC_MRAP_MIN_POINT_SPACING_M, 2),
    maximumGpsAccuracyM: numericConfig(process.env.NEXT_PUBLIC_MRAP_MAX_GPS_ACCURACY_M, 65),
  },
  loop: {
    realProximityM: numericConfig(process.env.NEXT_PUBLIC_MRAP_REAL_LOOP_PROXIMITY_M, 12),
    simulatedProximityM: numericConfig(process.env.NEXT_PUBLIC_MRAP_SIM_LOOP_PROXIMITY_M, 4),
    minimumAreaM2: numericConfig(process.env.NEXT_PUBLIC_MRAP_MIN_LOOP_AREA_M2, 35),
    minimumRouteLengthM: numericConfig(process.env.NEXT_PUBLIC_MRAP_MIN_LOOP_ROUTE_M, 25),
    minimumIndexGap: Math.round(numericConfig(process.env.NEXT_PUBLIC_MRAP_MIN_LOOP_INDEX_GAP, 4)),
    detectionCooldownMs: numericConfig(process.env.NEXT_PUBLIC_MRAP_LOOP_COOLDOWN_MS, 4500),
  },
  developerControls: process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS !== "false",
});

export type GameConfig = typeof GAME_CONFIG;
