import { describe, expect, it } from "vitest";
import {
  appendOfflineRouteDraftPoint,
  clearOfflineRouteDraft,
  offlineRouteDraftStorageKey,
  readOfflineRouteDraft,
  type OfflineRouteDraftStorage,
} from "@/lib/game/offline-route-draft";
import type { LocationSample } from "@/lib/game/types";

class MemoryStorage implements OfflineRouteDraftStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const lease = new Date(NOW + 30 * 60_000).toISOString();

function sample(index: number): LocationSample {
  return { coordinate: [29 + index / 100_000, 41], accuracyM: 5, timestamp: NOW + index * 1_000 };
}

describe("competitive olmayan çevrimdışı rota taslağı", () => {
  it("GPS örneklerini authoritative sequence olmadan sekme kapsamında korur", () => {
    const storage = new MemoryStorage();
    expect(appendOfflineRouteDraftPoint(storage, {
      userId: "user-1", sessionId: "session-1", sessionLeaseExpiresAt: lease,
      sample: sample(1), summary: { totalDistanceM: 5, claimCount: 0 },
    }, NOW).status).toBe("stored");
    expect(appendOfflineRouteDraftPoint(storage, {
      userId: "user-1", sessionId: "session-1", sessionLeaseExpiresAt: lease,
      sample: sample(2), summary: { totalDistanceM: 8, claimCount: 0 },
    }, NOW + 1_000).status).toBe("stored");

    const restored = readOfflineRouteDraft(storage, "user-1", "session-1", NOW + 2_000);
    expect(restored).toMatchObject({ status: "ready", samples: [sample(1), sample(2)] });
    const raw = storage.getItem(offlineRouteDraftStorageKey("user-1"))!;
    expect(raw).not.toContain("sequence");
    expect(raw).not.toContain("idempotencyKey");
  });

  it("TTL ve kapasite sınırında claim girdisine dönüşmeden güvenli biçimde durur", () => {
    const storage = new MemoryStorage();
    const limits = { maximumPoints: 1, ttlMs: 5_000, maximumSerializedBytes: 32_000 };
    appendOfflineRouteDraftPoint(storage, {
      userId: "user-1", sessionId: "session-1", sessionLeaseExpiresAt: lease,
      sample: sample(1), summary: { totalDistanceM: 1, claimCount: 0 },
    }, NOW, limits);
    expect(appendOfflineRouteDraftPoint(storage, {
      userId: "user-1", sessionId: "session-1", sessionLeaseExpiresAt: lease,
      sample: sample(2), summary: { totalDistanceM: 2, claimCount: 0 },
    }, NOW + 1_000, limits).status).toBe("overflow");
    expect(readOfflineRouteDraft(storage, "user-1", "session-1", NOW + 6_001, limits).status).toBe("expired");
  });

  it("logout ve hesap silme için kullanıcı kapsamındaki taslağı temizler", () => {
    const storage = new MemoryStorage();
    appendOfflineRouteDraftPoint(storage, {
      userId: "user-1", sessionId: "session-1", sessionLeaseExpiresAt: lease,
      sample: sample(1), summary: { totalDistanceM: 1, claimCount: 0 },
    }, NOW);
    clearOfflineRouteDraft(storage, "user-1");
    expect(readOfflineRouteDraft(storage, "user-1", "session-1", NOW).status).toBe("empty");
  });
});
