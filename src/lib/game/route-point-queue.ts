import type { LocationPointCommand } from "@/lib/game/authoritative-types";

const STORAGE_VERSION = 1;
const KEY_PREFIX = "mrap:route-point-queue:";

export const ROUTE_POINT_QUEUE_LIMITS = Object.freeze({
  maximumPoints: 512,
  ttlMs: 5 * 60 * 1_000,
  maximumSerializedBytes: 256_000,
});

export type RoutePointQueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type QueueSummary = {
  totalDistanceM: number;
  claimCount: number;
};

type PersistedRoutePointQueue = {
  version: typeof STORAGE_VERSION;
  userId: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  points: LocationPointCommand[];
  summary: QueueSummary;
};

export type RoutePointQueueReadResult =
  | { status: "ready"; points: LocationPointCommand[]; summary: QueueSummary; expiresAt: string }
  | { status: "empty" | "expired" | "invalid" | "unavailable"; points: []; summary: null };

export type RoutePointQueueWriteResult =
  | { status: "stored"; count: number; expiresAt: string }
  | { status: "empty" | "expired" | "overflow" | "unavailable"; count: number };

type QueueLimits = {
  maximumPoints: number;
  ttlMs: number;
  maximumSerializedBytes: number;
};

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

function validPoint(value: unknown): value is LocationPointCommand {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<LocationPointCommand>;
  return Number.isSafeInteger(point.sequence) && point.sequence! > 0
    && Number.isFinite(point.latitude) && point.latitude! >= -90 && point.latitude! <= 90
    && Number.isFinite(point.longitude) && point.longitude! >= -180 && point.longitude! <= 180
    && Number.isFinite(point.accuracyM) && point.accuracyM! >= 0 && point.accuracyM! <= 10_000
    && typeof point.clientObservedAt === "string"
    && Number.isFinite(Date.parse(point.clientObservedAt))
    && (point.altitudeM === undefined || Number.isFinite(point.altitudeM))
    && (point.speedMps === undefined || Number.isFinite(point.speedMps))
    && (point.heading === undefined || Number.isFinite(point.heading));
}

function validPointSequence(points: unknown, maximumPoints: number): points is LocationPointCommand[] {
  if (!Array.isArray(points) || points.length === 0 || points.length > maximumPoints) return false;
  return points.every((point, index) => validPoint(point)
    && (index === 0 || point.sequence === (points[index - 1] as LocationPointCommand).sequence + 1));
}

function validSummary(value: unknown): value is QueueSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<QueueSummary>;
  return Number.isFinite(summary.totalDistanceM) && summary.totalDistanceM! >= 0
    && Number.isSafeInteger(summary.claimCount) && summary.claimCount! >= 0;
}

function remove(storage: RoutePointQueueStorage, userId: string) {
  try {
    storage.removeItem(key(userId));
  } catch {
    // Private browsing can deny storage; server session cleanup remains authoritative.
  }
}

export function writeRoutePointQueue(
  storage: RoutePointQueueStorage,
  input: {
    userId: string;
    sessionId: string;
    sessionLeaseExpiresAt: string;
    points: readonly LocationPointCommand[];
    summary: QueueSummary;
  },
  now = Date.now(),
  limits: QueueLimits = ROUTE_POINT_QUEUE_LIMITS,
): RoutePointQueueWriteResult {
  if (input.points.length === 0) {
    remove(storage, input.userId);
    return { status: "empty", count: 0 };
  }
  if (input.points.length > limits.maximumPoints) {
    return { status: "overflow", count: input.points.length };
  }
  if (!validPointSequence(input.points, limits.maximumPoints) || !validSummary(input.summary)) {
    remove(storage, input.userId);
    return { status: "unavailable", count: 0 };
  }

  const firstObservedAt = Date.parse(input.points[0].clientObservedAt!);
  const leaseExpiresAt = Date.parse(input.sessionLeaseExpiresAt);
  const expiresAtMs = Math.min(firstObservedAt + limits.ttlMs, leaseExpiresAt);
  if (!Number.isFinite(expiresAtMs) || now >= expiresAtMs) {
    remove(storage, input.userId);
    return { status: "expired", count: 0 };
  }

  const payload: PersistedRoutePointQueue = {
    version: STORAGE_VERSION,
    userId: input.userId,
    sessionId: input.sessionId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    points: input.points.map((point) => ({ ...point })),
    summary: { ...input.summary },
  };
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > limits.maximumSerializedBytes) {
    return { status: "overflow", count: input.points.length };
  }
  try {
    storage.setItem(key(input.userId), serialized);
    return { status: "stored", count: input.points.length, expiresAt: payload.expiresAt };
  } catch {
    return { status: "unavailable", count: input.points.length };
  }
}

export function readRoutePointQueue(
  storage: RoutePointQueueStorage,
  userId: string,
  sessionId: string,
  now = Date.now(),
  limits: QueueLimits = ROUTE_POINT_QUEUE_LIMITS,
): RoutePointQueueReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(key(userId));
  } catch {
    return { status: "unavailable", points: [], summary: null };
  }
  if (!raw) return { status: "empty", points: [], summary: null };
  if (new TextEncoder().encode(raw).byteLength > limits.maximumSerializedBytes) {
    remove(storage, userId);
    return { status: "invalid", points: [], summary: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRoutePointQueue>;
    if (parsed.version !== STORAGE_VERSION
      || parsed.userId !== userId
      || parsed.sessionId !== sessionId
      || typeof parsed.createdAt !== "string"
      || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.expiresAt !== "string"
      || !Number.isFinite(Date.parse(parsed.expiresAt))
      || !validPointSequence(parsed.points, limits.maximumPoints)
      || !validSummary(parsed.summary)) {
      remove(storage, userId);
      return { status: "invalid", points: [], summary: null };
    }
    if (now >= Date.parse(parsed.expiresAt)) {
      remove(storage, userId);
      return { status: "expired", points: [], summary: null };
    }
    return {
      status: "ready",
      points: parsed.points.map((point) => ({ ...point })),
      summary: { ...parsed.summary },
      expiresAt: parsed.expiresAt,
    };
  } catch {
    remove(storage, userId);
    return { status: "invalid", points: [], summary: null };
  }
}

export function clearRoutePointQueue(storage: RoutePointQueueStorage, userId: string) {
  remove(storage, userId);
}

export function reconcileQueuedRoutePoints(points: readonly LocationPointCommand[], serverLastReceivedSequence: number) {
  if (!Number.isSafeInteger(serverLastReceivedSequence) || serverLastReceivedSequence < 0) {
    return { status: "gap" as const, points: [] as LocationPointCommand[] };
  }
  const replay = points.filter((point) => point.sequence > serverLastReceivedSequence).map((point) => ({ ...point }));
  if (replay.length === 0) return { status: "acknowledged" as const, points: replay };
  if (replay[0].sequence !== serverLastReceivedSequence + 1) return { status: "gap" as const, points: [] as LocationPointCommand[] };
  return { status: "replay" as const, points: replay };
}

export function routePointQueueStorageKey(userId: string) {
  return key(userId);
}
