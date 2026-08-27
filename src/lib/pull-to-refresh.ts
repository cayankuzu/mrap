export const PULL_TO_REFRESH_CONFIG = Object.freeze({
  activationDistance: 72,
  intentDistance: 8,
  maximumVisualDistance: 76,
  damping: 0.52,
  horizontalCancelRatio: 0.82,
});

export type PullGesture = {
  phase: "pending" | "cancelled" | "pulling";
  progress: number;
  rawDistance: number;
  visualDistance: number;
  ready: boolean;
};

export function evaluatePullGesture(deltaX: number, deltaY: number): PullGesture {
  const horizontalDistance = Math.abs(deltaX);
  if (deltaY <= 0) {
    return { phase: "cancelled", progress: 0, rawDistance: 0, visualDistance: 0, ready: false };
  }

  if (deltaY < PULL_TO_REFRESH_CONFIG.intentDistance) {
    return { phase: "pending", progress: 0, rawDistance: deltaY, visualDistance: 0, ready: false };
  }

  if (horizontalDistance > deltaY * PULL_TO_REFRESH_CONFIG.horizontalCancelRatio) {
    return { phase: "cancelled", progress: 0, rawDistance: deltaY, visualDistance: 0, ready: false };
  }

  const visualDistance = Math.min(
    PULL_TO_REFRESH_CONFIG.maximumVisualDistance,
    deltaY * PULL_TO_REFRESH_CONFIG.damping,
  );
  const progress = Math.min(1, deltaY / PULL_TO_REFRESH_CONFIG.activationDistance);
  return {
    phase: "pulling",
    progress,
    rawDistance: deltaY,
    visualDistance,
    ready: deltaY >= PULL_TO_REFRESH_CONFIG.activationDistance,
  };
}

