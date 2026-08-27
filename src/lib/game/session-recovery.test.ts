import { describe, expect, it, vi } from "vitest";
import type { RouteSessionDto } from "@/lib/game/authoritative-types";
import {
  clearActiveRouteSession,
  persistActiveRouteSession,
  readActiveRouteSession,
  type SessionStorageLike,
} from "@/lib/game/session-recovery";

function storage(): SessionStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function session(): RouteSessionDto {
  return {
    id: "session-12345678",
    worldId: "world-main",
    mode: "real_gps",
    status: "active",
    serverNonce: "a".repeat(43),
    lastReceivedSequence: 4,
    lastAcceptedSequence: 3,
    currentSegmentIndex: 1,
    riskScore: 0,
    leaseExpiresAt: "2026-08-27T13:00:00.000Z",
    startedAtServer: "2026-08-27T12:00:00.000Z",
  };
}

describe("aktif rota oturumu kurtarma kaydı", () => {
  it("yalnız oturum kimliği ve nonce'u aynı kullanıcı sekmesinde geri yükler", () => {
    vi.setSystemTime(new Date("2026-08-27T12:30:00.000Z"));
    const target = storage();

    expect(persistActiveRouteSession(target, "user-1", session())).toBe(true);
    expect(readActiveRouteSession(target, "user-1")).toEqual(session());
    expect(readActiveRouteSession(target, "user-2")).toBeNull();

    vi.useRealTimers();
  });

  it("süresi dolmuş veya bozuk kaydı otomatik temizler", () => {
    vi.setSystemTime(new Date("2026-08-27T14:00:00.000Z"));
    const target = storage();
    persistActiveRouteSession(target, "user-1", session());

    expect(readActiveRouteSession(target, "user-1")).toBeNull();
    expect(readActiveRouteSession(target, "user-1")).toBeNull();

    vi.useRealTimers();
  });

  it("açıkça temizlenebilir ve depolama hatası oturumu çökertmez", () => {
    const target = storage();
    persistActiveRouteSession(target, "user-1", session());
    clearActiveRouteSession(target, "user-1");
    expect(readActiveRouteSession(target, "user-1")).toBeNull();

    const denied: SessionStorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(persistActiveRouteSession(denied, "user-1", session())).toBe(false);
    expect(readActiveRouteSession(denied, "user-1")).toBeNull();
  });
});
