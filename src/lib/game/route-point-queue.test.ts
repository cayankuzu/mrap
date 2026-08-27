import { describe, expect, it } from "vitest";
import type { LocationPointCommand } from "@/lib/game/authoritative-types";
import {
  clearRoutePointQueue,
  readRoutePointQueue,
  reconcileQueuedRoutePoints,
  routePointQueueStorageKey,
  writeRoutePointQueue,
  type RoutePointQueueStorage,
} from "@/lib/game/route-point-queue";

class MemoryStorage implements RoutePointQueueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

function point(sequence: number): LocationPointCommand {
  return {
    sequence,
    latitude: 41 + sequence / 100_000,
    longitude: 29 + sequence / 100_000,
    accuracyM: 5,
    clientObservedAt: new Date(NOW + sequence * 1_000).toISOString(),
  };
}

function write(storage: RoutePointQueueStorage, points: LocationPointCommand[], now = NOW) {
  return writeRoutePointQueue(storage, {
    userId: "user-1",
    sessionId: "session-1",
    sessionLeaseExpiresAt: new Date(NOW + 30 * 60_000).toISOString(),
    points,
    summary: { totalDistanceM: 42, claimCount: 1 },
  }, now);
}

describe("sekme kapsamlı rota noktası kuyruğu", () => {
  it("ham GPS noktalarını kullanıcı ve oturum kapsamıyla bounded biçimde geri yükler", () => {
    const storage = new MemoryStorage();
    expect(write(storage, [point(7), point(8)])).toMatchObject({ status: "stored", count: 2 });

    expect(readRoutePointQueue(storage, "user-1", "session-1", NOW)).toMatchObject({
      status: "ready",
      points: [point(7), point(8)],
      summary: { totalDistanceM: 42, claimCount: 1 },
    });
    expect(readRoutePointQueue(storage, "user-1", "other-session", NOW).status).toBe("invalid");
  });

  it("TTL dolduğunda raw noktaları otomatik siler", () => {
    const storage = new MemoryStorage();
    const limits = { maximumPoints: 10, ttlMs: 5_000, maximumSerializedBytes: 32_000 };
    writeRoutePointQueue(storage, {
      userId: "user-1",
      sessionId: "session-1",
      sessionLeaseExpiresAt: new Date(NOW + 60_000).toISOString(),
      points: [point(1)],
      summary: { totalDistanceM: 0, claimCount: 0 },
    }, NOW, limits);

    expect(readRoutePointQueue(storage, "user-1", "session-1", NOW + 6_000, limits).status).toBe("expired");
    expect(storage.getItem(routePointQueueStorageKey("user-1"))).toBeNull();
  });

  it("kapasite aşımında mevcut kuyruğu ezmez ve sıra boşluğunu reddeder", () => {
    const storage = new MemoryStorage();
    expect(write(storage, [point(1)])).toMatchObject({ status: "stored" });
    const original = storage.getItem(routePointQueueStorageKey("user-1"));
    const limits = { maximumPoints: 1, ttlMs: 300_000, maximumSerializedBytes: 32_000 };

    expect(writeRoutePointQueue(storage, {
      userId: "user-1",
      sessionId: "session-1",
      sessionLeaseExpiresAt: new Date(NOW + 60_000).toISOString(),
      points: [point(1), point(2)],
      summary: { totalDistanceM: 1, claimCount: 0 },
    }, NOW, limits).status).toBe("overflow");
    expect(storage.getItem(routePointQueueStorageKey("user-1"))).toBe(original);

    expect(write(storage, [point(1), point(3)]).status).toBe("unavailable");
    expect(storage.getItem(routePointQueueStorageKey("user-1"))).toBeNull();
  });

  it("logout/hesap silme temizliği için açıkça silinir ve storage reddi çökmez", () => {
    const storage = new MemoryStorage();
    write(storage, [point(1)]);
    clearRoutePointQueue(storage, "user-1");
    expect(readRoutePointQueue(storage, "user-1", "session-1", NOW).status).toBe("empty");

    const denied: RoutePointQueueStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(write(denied, [point(1)]).status).toBe("unavailable");
    expect(readRoutePointQueue(denied, "user-1", "session-1", NOW).status).toBe("unavailable");
    expect(() => clearRoutePointQueue(denied, "user-1")).not.toThrow();
  });

  it("reload sonrası yalnız sunucunun ACK etmediği ardışık online noktaları replay eder", () => {
    const queued = [point(3), point(4), point(5), point(6)];
    expect(reconcileQueuedRoutePoints(queued, 4)).toEqual({ status: "replay", points: [point(5), point(6)] });
    expect(reconcileQueuedRoutePoints(queued, 6)).toEqual({ status: "acknowledged", points: [] });
    expect(reconcileQueuedRoutePoints(queued, 1)).toEqual({ status: "gap", points: [] });
  });
});
