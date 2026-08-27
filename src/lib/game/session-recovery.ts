import type { RouteSessionDto } from "@/lib/game/authoritative-types";

const STORAGE_VERSION = 1;
const KEY_PREFIX = "mrap:active-route:";
const ACTIVE_STATUSES = new Set(["active", "paused", "closing"]);

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedRouteSession = {
  version: typeof STORAGE_VERSION;
  userId: string;
  session: RouteSessionDto;
};

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

function validSession(value: unknown): value is RouteSessionDto {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<RouteSessionDto>;
  return typeof session.id === "string" && session.id.length >= 8
    && typeof session.worldId === "string" && session.worldId.length >= 1
    && (session.mode === "real_gps" || session.mode === "development_simulation")
    && typeof session.status === "string" && ACTIVE_STATUSES.has(session.status)
    && typeof session.serverNonce === "string" && session.serverNonce.length >= 32
    && Number.isSafeInteger(session.lastReceivedSequence) && session.lastReceivedSequence! >= 0
    && Number.isSafeInteger(session.lastAcceptedSequence) && session.lastAcceptedSequence! >= 0
    && Number.isSafeInteger(session.currentSegmentIndex) && session.currentSegmentIndex! >= 0
    && Number.isFinite(session.riskScore) && session.riskScore! >= 0
    && typeof session.leaseExpiresAt === "string" && Number.isFinite(Date.parse(session.leaseExpiresAt))
    && typeof session.startedAtServer === "string" && Number.isFinite(Date.parse(session.startedAtServer));
}

export function persistActiveRouteSession(storage: SessionStorageLike, userId: string, session: RouteSessionDto) {
  const payload: PersistedRouteSession = { version: STORAGE_VERSION, userId, session };
  try {
    storage.setItem(key(userId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function readActiveRouteSession(storage: SessionStorageLike, userId: string) {
  try {
    const raw = storage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRouteSession>;
    if (parsed.version !== STORAGE_VERSION || parsed.userId !== userId || !validSession(parsed.session)) {
      storage.removeItem(key(userId));
      return null;
    }
    if (Date.parse(parsed.session.leaseExpiresAt) <= Date.now()) {
      storage.removeItem(key(userId));
      return null;
    }
    return parsed.session;
  } catch {
    try { storage.removeItem(key(userId)); } catch { /* Depolama kullanılamıyor. */ }
    return null;
  }
}

export function clearActiveRouteSession(storage: SessionStorageLike, userId: string) {
  try {
    storage.removeItem(key(userId));
  } catch {
    // Private browsing veya kapalı depolama oyun oturumunun sunucuda bitirilmesini engellemez.
  }
}
