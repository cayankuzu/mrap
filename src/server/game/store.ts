import "server-only";

import type { CloseLoopCommand, CompetitiveLocationMode, LocationPointCommand } from "@/lib/game/authoritative-types";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";
import type { AuthoritativeGameStore } from "@/server/game/authoritative-store";
import type { SupabaseAuthoritativeGameStore } from "@/server/game/supabase-authoritative-store";

type StoreImplementation = AuthoritativeGameStore | SupabaseAuthoritativeGameStore;
const gameGlobal = globalThis as typeof globalThis & {
  mrapAuthoritativeGameStorePromise?: Promise<StoreImplementation>;
  mrapAuthoritativeGameStoreProvider?: "sqlite" | "supabase";
};

async function createStore(): Promise<StoreImplementation> {
  if (supabaseProviderEnabled()) {
    const { SupabaseAuthoritativeGameStore } = await import("@/server/game/supabase-authoritative-store");
    return new SupabaseAuthoritativeGameStore();
  }
  const [{ database }, { AuthoritativeGameStore }] = await Promise.all([
    import("@/lib/database"),
    import("@/server/game/authoritative-store"),
  ]);
  return new AuthoritativeGameStore(database);
}

async function loadStore() {
  const provider = supabaseProviderEnabled() ? "supabase" as const : "sqlite" as const;
  if (!gameGlobal.mrapAuthoritativeGameStorePromise || gameGlobal.mrapAuthoritativeGameStoreProvider !== provider) {
    gameGlobal.mrapAuthoritativeGameStoreProvider = provider;
    gameGlobal.mrapAuthoritativeGameStorePromise = createStore();
  }
  return gameGlobal.mrapAuthoritativeGameStorePromise;
}

export const authoritativeGameStore = {
  async startSession(userId: string, mode: CompetitiveLocationMode, correlationId?: string) {
    return (await loadStore()).startSession(userId, mode, correlationId);
  },
  async takeOverActiveSession(userId: string, mode: CompetitiveLocationMode, correlationId?: string) {
    return (await loadStore()).takeOverActiveSession(userId, mode, correlationId);
  },
  async beginOnlineSegment(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    expectedCurrentSegmentIndex: number;
    correlationId?: string;
  }) {
    return (await loadStore()).beginOnlineSegment(input);
  },
  async revokeActiveSessionsForUser(userId: string, correlationId?: string) {
    return (await loadStore()).revokeActiveSessionsForUser(userId, correlationId);
  },
  async appendPointBatch(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    idempotencyKey: string;
    points: LocationPointCommand[];
  }) {
    return (await loadStore()).appendPointBatch(input);
  },
  async createLoopCandidate(input: {
    userId: string;
    sessionId: string;
    nonce: string;
    lastAcceptedPointSequence: number;
  }) {
    return (await loadStore()).createLoopCandidate(input);
  },
  async continueCandidate(input: { userId: string; candidateId: string; nonce: string }) {
    return (await loadStore()).continueCandidate(input);
  },
  async claim(input: { userId: string; nonce: string; command: CloseLoopCommand }) {
    return (await loadStore()).claim(input);
  },
  async finishSession(input: { userId: string; sessionId: string; nonce: string }) {
    return (await loadStore()).finishSession(input);
  },
  async getCommandResult(userId: string, idempotencyKey: string) {
    return (await loadStore()).getCommandResult(userId, idempotencyKey);
  },
  async getSessionWorld(userId: string, sessionId: string) {
    return (await loadStore()).getSessionWorld(userId, sessionId);
  },
  async getSessionRecovery(input: { userId: string; sessionId: string; nonce: string }) {
    return (await loadStore()).getSessionRecovery(input);
  },
  async getRegionSnapshot(worldId: string, regionIds: readonly string[]) {
    return (await loadStore()).getRegionSnapshot(worldId, regionIds);
  },
  async listRegionEvents(worldId: string, regionIds: readonly string[], afterSequence: number, limit?: number) {
    return (await loadStore()).listRegionEvents(worldId, regionIds, afterSequence, limit);
  },
  async getMapState(worldId: string, regionIds?: readonly string[]) {
    return (await loadStore()).getMapState(worldId, regionIds);
  },
  async consumeRateLimit(scopeKey: string, maximumHits: number, windowMs: number) {
    return (await loadStore()).consumeRateLimit(scopeKey, maximumHits, windowMs);
  },
  async health() {
    return (await loadStore()).health();
  },
  async recordMetric(key: string, amount?: number) {
    return (await loadStore()).recordMetric(key, amount);
  },
  async purgeExpiredRawLocations(now?: number) {
    return (await loadStore()).purgeExpiredRawLocations(now);
  },
};
