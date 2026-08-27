import "server-only";

import type { AppUser } from "@/lib/models";
import { AUTHORITATIVE_GAME_CONFIG } from "@/server/game/authoritative-config";
import { gameError } from "@/server/game/authoritative-error";
import { authoritativeGameStore } from "@/server/game/store";
import { rateLimitClientAddress } from "@/server/http/rate-limit";

export function noStoreJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, private");
  return Response.json(value, { ...init, headers });
}

export function requireSessionNonce(request: Request) {
  const nonce = request.headers.get("x-mrap-session-nonce")?.trim() ?? "";
  if (nonce.length < 20 || nonce.length > 200) gameError("NONCE_MISMATCH", "Rota oturumu doğrulanamadı.", 403);
  return nonce;
}

export async function enforceGameLimit(user: AppUser, request: Request, action: string, maximumHits: number, windowMs: number, secondaryScope?: string) {
  const scopes = [{ key: `user:${user.id}:${action}`, maximumHits }];
  if (process.env.MRAP_TRUST_PROXY_HEADERS === "1") {
    const forwarded = rateLimitClientAddress(request);
    if (/^[a-fA-F0-9:.]{2,64}$/.test(forwarded)) {
      scopes.push({
        key: `ip:${forwarded}:${action}`,
        maximumHits: maximumHits * AUTHORITATIVE_GAME_CONFIG.limits.sharedIpMultiplier,
      });
    }
  }
  if (secondaryScope) scopes.push({ key: `resource:${secondaryScope}:${action}`, maximumHits });
  let minimumRemaining = maximumHits;
  for (const scope of scopes) {
    const limit = await authoritativeGameStore.consumeRateLimit(scope.key, scope.maximumHits, windowMs);
    if (scope.maximumHits === maximumHits) minimumRemaining = Math.min(minimumRemaining, limit.remaining);
    if (!limit.allowed) {
      await authoritativeGameStore.recordMetric("rate_limit_block_total");
      gameError("RATE_LIMITED", `Çok sık deneme yapıldı. ${limit.retryAfterSeconds} saniye sonra yeniden dene.`, 429, true);
    }
  }
  return { allowed: true, remaining: minimumRemaining };
}

export function requestedWorld(request: Request) {
  const requested = new URL(request.url).searchParams.get("worldId")?.trim();
  if (!requested || requested === AUTHORITATIVE_GAME_CONFIG.worlds.production) return AUTHORITATIVE_GAME_CONFIG.worlds.production;
  if (requested === AUTHORITATIVE_GAME_CONFIG.worlds.development && process.env.NODE_ENV !== "production") return requested;
  gameError("FORBIDDEN", "İstenen oyun dünyasına erişilemiyor.", 403);
}

export function exactObjectKeys(body: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) gameError("INVALID_REQUEST", "İstek izin verilmeyen alanlar içeriyor.");
}

export const API_BODY_LIMITS = Object.freeze({
  session: 1_024,
  candidate: 2_048,
  claim: 4_096,
  points: AUTHORITATIVE_GAME_CONFIG.sessions.maximumBatchBytes,
});
