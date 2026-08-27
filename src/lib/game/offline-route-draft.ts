import type { LocationSample } from "@/lib/game/types";

const STORAGE_VERSION = 1;
const KEY_PREFIX = "mrap:offline-route-draft:";

export const OFFLINE_ROUTE_DRAFT_LIMITS = Object.freeze({
  maximumPoints: 512,
  ttlMs: 5 * 60 * 1_000,
  maximumSerializedBytes: 256_000,
});

export type OfflineRouteDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type DraftPoint = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  observedAt: string;
};

type DraftSummary = { totalDistanceM: number; claimCount: number };

type PersistedOfflineRouteDraft = {
  version: typeof STORAGE_VERSION;
  userId: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  points: DraftPoint[];
  summary: DraftSummary;
};

type DraftLimits = { maximumPoints: number; ttlMs: number; maximumSerializedBytes: number };

export type OfflineRouteDraftReadResult =
  | { status: "ready"; samples: LocationSample[]; summary: DraftSummary; expiresAt: string }
  | { status: "empty" | "expired" | "invalid" | "unavailable"; samples: []; summary: null };

export type OfflineRouteDraftWriteResult =
  | { status: "stored"; count: number; expiresAt: string }
  | { status: "expired" | "overflow" | "unavailable"; count: number };

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

function remove(storage: OfflineRouteDraftStorage, userId: string) {
  try { storage.removeItem(key(userId)); } catch { /* Best effort: server data is unaffected. */ }
}

function validPoint(value: unknown): value is DraftPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<DraftPoint>;
  return Number.isFinite(point.latitude) && point.latitude! >= -90 && point.latitude! <= 90
    && Number.isFinite(point.longitude) && point.longitude! >= -180 && point.longitude! <= 180
    && Number.isFinite(point.accuracyM) && point.accuracyM! >= 0 && point.accuracyM! <= 10_000
    && typeof point.observedAt === "string" && Number.isFinite(Date.parse(point.observedAt));
}

function validSummary(value: unknown): value is DraftSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<DraftSummary>;
  return Number.isFinite(summary.totalDistanceM) && summary.totalDistanceM! >= 0
    && Number.isSafeInteger(summary.claimCount) && summary.claimCount! >= 0;
}

function samplesToPoints(samples: readonly LocationSample[]): DraftPoint[] {
  return samples.map((sample) => ({
    longitude: sample.coordinate[0],
    latitude: sample.coordinate[1],
    accuracyM: sample.accuracyM,
    observedAt: new Date(sample.timestamp).toISOString(),
  }));
}

function pointsToSamples(points: readonly DraftPoint[]): LocationSample[] {
  return points.map((point) => ({
    coordinate: [point.longitude, point.latitude],
    accuracyM: point.accuracyM,
    timestamp: Date.parse(point.observedAt),
  }));
}

export function readOfflineRouteDraft(
  storage: OfflineRouteDraftStorage,
  userId: string,
  sessionId: string,
  now = Date.now(),
  limits: DraftLimits = OFFLINE_ROUTE_DRAFT_LIMITS,
): OfflineRouteDraftReadResult {
  let raw: string | null;
  try { raw = storage.getItem(key(userId)); }
  catch { return { status: "unavailable", samples: [], summary: null }; }
  if (!raw) return { status: "empty", samples: [], summary: null };
  if (new TextEncoder().encode(raw).byteLength > limits.maximumSerializedBytes) {
    remove(storage, userId);
    return { status: "invalid", samples: [], summary: null };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedOfflineRouteDraft>;
    const pointsValid = Array.isArray(parsed.points)
      && parsed.points.length > 0
      && parsed.points.length <= limits.maximumPoints
      && parsed.points.every((point, index) => validPoint(point)
        && (index === 0 || Date.parse(point.observedAt) >= Date.parse((parsed.points![index - 1] as DraftPoint).observedAt)));
    if (parsed.version !== STORAGE_VERSION
      || parsed.userId !== userId
      || parsed.sessionId !== sessionId
      || typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.expiresAt !== "string" || !Number.isFinite(Date.parse(parsed.expiresAt))
      || !pointsValid || !validSummary(parsed.summary)) {
      remove(storage, userId);
      return { status: "invalid", samples: [], summary: null };
    }
    if (now >= Date.parse(parsed.expiresAt)) {
      remove(storage, userId);
      return { status: "expired", samples: [], summary: null };
    }
    const validPoints = parsed.points as DraftPoint[];
    return { status: "ready", samples: pointsToSamples(validPoints), summary: { ...parsed.summary }, expiresAt: parsed.expiresAt };
  } catch {
    remove(storage, userId);
    return { status: "invalid", samples: [], summary: null };
  }
}

export function appendOfflineRouteDraftPoint(
  storage: OfflineRouteDraftStorage,
  input: {
    userId: string;
    sessionId: string;
    sessionLeaseExpiresAt: string;
    sample: LocationSample;
    summary: DraftSummary;
  },
  now = Date.now(),
  limits: DraftLimits = OFFLINE_ROUTE_DRAFT_LIMITS,
): OfflineRouteDraftWriteResult {
  const existing = readOfflineRouteDraft(storage, input.userId, input.sessionId, now, limits);
  if (existing.status === "expired") return { status: "expired", count: 0 };
  if (existing.status === "invalid" || existing.status === "unavailable") return { status: "unavailable", count: 0 };
  const samples = existing.status === "ready" ? [...existing.samples, input.sample] : [input.sample];
  if (samples.length > limits.maximumPoints) return { status: "overflow", count: samples.length };
  if (!validSummary(input.summary) || samples.some((sample) => !validPoint(samplesToPoints([sample])[0]))) {
    return { status: "unavailable", count: existing.status === "ready" ? existing.samples.length : 0 };
  }
  const firstObservedAt = samples[0].timestamp;
  const leaseExpiresAt = Date.parse(input.sessionLeaseExpiresAt);
  const expiresAtMs = Math.min(firstObservedAt + limits.ttlMs, leaseExpiresAt);
  if (!Number.isFinite(expiresAtMs) || now >= expiresAtMs) {
    remove(storage, input.userId);
    return { status: "expired", count: 0 };
  }
  const payload: PersistedOfflineRouteDraft = {
    version: STORAGE_VERSION,
    userId: input.userId,
    sessionId: input.sessionId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    points: samplesToPoints(samples),
    summary: { ...input.summary },
  };
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > limits.maximumSerializedBytes) {
    return { status: "overflow", count: samples.length };
  }
  try {
    storage.setItem(key(input.userId), serialized);
    return { status: "stored", count: samples.length, expiresAt: payload.expiresAt };
  } catch {
    return { status: "unavailable", count: existing.status === "ready" ? existing.samples.length : 0 };
  }
}

export function clearOfflineRouteDraft(storage: OfflineRouteDraftStorage, userId: string) {
  remove(storage, userId);
}

export function offlineRouteDraftStorageKey(userId: string) {
  return key(userId);
}
