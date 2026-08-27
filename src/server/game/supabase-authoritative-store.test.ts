import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { AuthoritativeGameError } from "@/server/game/authoritative-error";
import { SupabaseAuthoritativeGameStore } from "@/server/game/supabase-authoritative-store";

describe("SupabaseAuthoritativeGameStore", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
  });

  it("starts a hosted session without sending the bearer nonce to Postgres", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        worldId: "world-main",
        mode: "real_gps",
        status: "active",
        lastReceivedSequence: 0,
        lastAcceptedSequence: 0,
        currentSegmentIndex: 0,
        riskScore: 0,
        leaseExpiresAt: "2026-08-27T20:30:00.000Z",
        startedAtServer: "2026-08-27T20:00:00.000Z",
      },
      error: null,
    });
    const store = new SupabaseAuthoritativeGameStore();

    const result = await store.startSession(
      "22222222-2222-4222-8222-222222222222",
      "real_gps",
      "33333333-3333-4333-8333-333333333333",
    );

    expect(result.worldId).toBe("world-main");
    expect(result.serverNonce).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe("mrap_game_start_session");
    expect(mocks.rpc.mock.calls[1]?.[0]).toBe("mrap_game_record_metric");
    const [, payload] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty("p_nonce");
    expect(payload.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.p_nonce_hash).not.toBe(result.serverNonce);
  });

  it("fails closed while the shared production world is not active", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "WORLD_NOT_ACTIVE", code: "55000" },
    });
    const store = new SupabaseAuthoritativeGameStore();

    const error = await store.startSession(
      "22222222-2222-4222-8222-222222222222",
      "real_gps",
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AuthoritativeGameError);
    expect(error).toMatchObject({
      code: "RETRYABLE",
      status: 503,
      retryable: true,
    });
  });

  it("uses the distributed service-role rate-limit bridge", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ allowed: false, remaining: 0, retry_after_seconds: 17 }],
      error: null,
    });
    const store = new SupabaseAuthoritativeGameStore();

    await expect(store.consumeRateLimit("user:42:claim", 10, 60_000)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
    });
    const [, payload] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.p_scope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload).not.toHaveProperty("p_scope_key");
  });

  it("does not emit invalid or zero-value metrics", async () => {
    const store = new SupabaseAuthoritativeGameStore();
    await store.recordMetric("route_points_accepted_total", 0);
    await store.recordMetric("INVALID-METRIC", 2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not turn a committed mutation into a failure when telemetry is unavailable", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: {
          session: {
            id: "11111111-1111-4111-8111-111111111111",
            worldId: "world-main",
            mode: "real_gps",
            status: "completed",
            lastReceivedSequence: 8,
            lastAcceptedSequence: 8,
            currentSegmentIndex: 0,
            riskScore: 0,
            leaseExpiresAt: "2026-08-27T20:30:00.000Z",
            startedAtServer: "2026-08-27T20:00:00.000Z",
          },
          route: {
            distanceM: 120,
            durationSeconds: 90,
            acceptedPointCount: 8,
            closedClaimCount: 1,
          },
        },
        error: null,
      })
      .mockRejectedValueOnce(new Error("metrics unavailable"));
    const store = new SupabaseAuthoritativeGameStore();

    await expect(store.finishSession({
      userId: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
      nonce: "trusted-nonce",
    })).resolves.toMatchObject({
      route: { distanceM: 120, closedClaimCount: 1 },
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "mrap_game_finish_session",
      "mrap_game_record_metric",
    ]);
  });

  it("maps PostgreSQL deadlocks to a safe retryable conflict", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "deadlock detected", code: "40P01" },
    });
    const store = new SupabaseAuthoritativeGameStore();

    const error = await store.startSession(
      "22222222-2222-4222-8222-222222222222",
      "real_gps",
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AuthoritativeGameError);
    expect(error).toMatchObject({ code: "RETRYABLE", status: 409, retryable: true });
  });

  it("retries a serialization failure only through the idempotent RPC path", async () => {
    const store = new SupabaseAuthoritativeGameStore();
    const operation = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "40001", message: "serialization" } })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const retry = Reflect.get(store, "retryIdempotentRpc") as (
      callback: () => Promise<{ data: unknown; error: { code?: string } | null }>
    ) => Promise<{ data: unknown; error: { code?: string } | null }>;

    await expect(retry.call(store, operation)).resolves.toEqual({ data: { ok: true }, error: null });
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("uses the dissolved service-role territory geometry for loop detection", async () => {
    const geometry = {
      type: "Polygon",
      coordinates: [[[29, 41], [29.001, 41], [29.001, 41.001], [29, 41]]],
    };
    mocks.rpc.mockResolvedValueOnce({ data: { geometry }, error: null });
    const store = new SupabaseAuthoritativeGameStore();
    const readGeometry = Reflect.get(store, "currentTerritoryGeometry") as (
      userId: string,
      worldId: string,
    ) => Promise<unknown>;

    await expect(readGeometry.call(
      store,
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    )).resolves.toEqual(geometry);
    expect(mocks.rpc).toHaveBeenCalledWith("mrap_game_owned_territory", {
      p_user_id: "22222222-2222-4222-8222-222222222222",
      p_world_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("renders ownership and paint from the dissolved region map RPC", async () => {
    const dissolved = {
      type: "MultiPolygon",
      coordinates: [[[[29, 41], [29.002, 41], [29.002, 41.002], [29, 41.002], [29, 41]]]],
    } as const;
    const worldQuery: Record<string, unknown> = {};
    worldQuery.select = vi.fn(() => worldQuery);
    worldQuery.eq = vi.fn(() => worldQuery);
    worldQuery.maybeSingle = vi.fn(async () => ({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "world-main",
        status: "active",
        environment: "production",
        grid_resolution: 22,
        region_resolution: 14,
      },
      error: null,
    }));
    const regionQuery: Record<string, unknown> = {};
    regionQuery.select = vi.fn(() => regionQuery);
    regionQuery.eq = vi.fn(() => regionQuery);
    regionQuery.in = vi.fn(async () => ({
      data: [{
        id: "33333333-3333-4333-8333-333333333333",
        region_key: "14/9217/6142",
        version: 7,
      }],
      error: null,
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "worlds") return worldQuery;
      if (table === "world_regions") return regionQuery;
      throw new Error(`unexpected raw table read: ${table}`);
    });
    mocks.rpc.mockResolvedValueOnce({
      data: {
        territories: [{
          userId: "22222222-2222-4222-8222-222222222222",
          ownerUsername: "atlas",
          geometry: dissolved,
          areaM2: 40_000,
          color: "#1488FF",
          pattern: 2,
          updatedAt: "2026-08-27T20:00:00.000Z",
        }],
        paints: [{
          id: "0123456789abcdef0123456789abcdef",
          userId: "22222222-2222-4222-8222-222222222222",
          geometry: dissolved,
          color: "#FF6B35",
          updatedAt: "2026-08-27T20:00:00.000Z",
        }],
      },
      error: null,
    });
    const store = new SupabaseAuthoritativeGameStore();

    await expect(store.getMapState("world-main", ["14/9217/6142"])).resolves.toEqual({
      territories: [expect.objectContaining({ geometry: dissolved, ownerUsername: "atlas", areaM2: 40_000 })],
      paints: [expect.objectContaining({ geometry: dissolved, color: "#FF6B35" })],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mrap_game_region_map_state", {
      p_world_id: "11111111-1111-4111-8111-111111111111",
      p_region_ids: ["33333333-3333-4333-8333-333333333333"],
    });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it("rejects an unbounded hosted map read before touching Supabase", async () => {
    const store = new SupabaseAuthoritativeGameStore();

    await expect(store.getMapState("world-main")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("captures the outbox cursor before region and cell snapshot reads", async () => {
    const order: string[] = [];
    const worldResult = {
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        slug: "world-main",
        status: "active",
        environment: "production",
        grid_resolution: 22,
        region_resolution: 14,
      },
      error: null,
    };
    const builder = (label: string, result: unknown, terminal: "single" | "then") => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "in"]) {
        query[method] = vi.fn(() => query);
      }
      query.maybeSingle = vi.fn(async () => {
        order.push(label);
        return result;
      });
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (terminal !== "then") return Promise.reject(new Error("unexpected then")).then(resolve, reject);
        order.push(label);
        return Promise.resolve(result).then(resolve, reject);
      };
      return query;
    };
    let worldReads = 0;
    let regionReads = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "worlds") {
        worldReads += 1;
        return builder(`world:${worldReads}`, worldResult, "single");
      }
      if (table === "realtime_outbox") {
        return builder("cursor", { data: { sequence: 41 }, error: null }, "single");
      }
      if (table === "world_regions") {
        regionReads += 1;
        return builder(`regions:${regionReads}`, { data: [], error: null }, "then");
      }
      throw new Error(`unexpected table ${table}`);
    });
    const store = new SupabaseAuthoritativeGameStore();

    const snapshot = await store.getRegionSnapshot("world-main", ["14/9217/6142"]);

    expect(snapshot.latestOutboxSequence).toBe(41);
    expect(order.indexOf("cursor")).toBeLessThan(order.indexOf("regions:1"));
    expect(order).toEqual(["world:1", "cursor", "regions:1", "world:2", "regions:2"]);
  });
});
