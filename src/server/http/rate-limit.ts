import "server-only";

import { createHash } from "node:crypto";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";

function scopeHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function rateLimitClientAddress(request: Request) {
  if (process.env.MRAP_TRUST_PROXY_HEADERS !== "1") return "güvenilmeyen-ağ";
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || "bilinmeyen-ağ";
}

type RateLimitDecision = Readonly<{
  allowed: boolean;
  retryAfterSeconds: number;
}>;

async function consumeSupabaseRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const { createMrapSupabaseAdminClient } = await import("@/lib/supabase/admin-client");
  const { data, error } = await createMrapSupabaseAdminClient().rpc("mrap_consume_rate_limit", {
    p_scope_hash: key,
    p_maximum_hits: limit,
    p_window_ms: windowMs,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("Dağıtık hız sınırı geçerli bir karar döndürmedi.");
  const allowed = (row as Record<string, unknown>).allowed;
  const retryAfterSeconds = Number((row as Record<string, unknown>).retry_after_seconds);
  if (typeof allowed !== "boolean" || !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0) {
    throw new Error("Dağıtık hız sınırı kararı geçersiz.");
  }
  return { allowed, retryAfterSeconds };
}

async function consumeSqliteRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
  const { database } = await import("@/lib/database");
  const now = Date.now();
  let count = 0;
  let resetAt = now + windowMs;
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare("SELECT hit_count, reset_at_ms FROM api_rate_limits WHERE scope_hash = ?").get(key) as { hit_count: number; reset_at_ms: number } | undefined;
    if (!current || current.reset_at_ms <= now) {
      database.prepare(`
          INSERT INTO api_rate_limits (scope_hash, hit_count, reset_at_ms, updated_at)
          VALUES (?, 1, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(scope_hash) DO UPDATE SET hit_count = 1, reset_at_ms = excluded.reset_at_ms, updated_at = CURRENT_TIMESTAMP
        `).run(key, resetAt);
      count = 1;
    } else {
      count = current.hit_count + 1;
      resetAt = current.reset_at_ms;
      database.prepare("UPDATE api_rate_limits SET hit_count = ?, updated_at = CURRENT_TIMESTAMP WHERE scope_hash = ?").run(count, key);
    }
    database.prepare("DELETE FROM api_rate_limits WHERE reset_at_ms <= ?").run(now);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* Transaction başlamamış olabilir. */ }
    throw error;
  }
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

export async function checkRateLimit(request: Request, bucketName: string, limit: number, windowMs: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1_000) {
    return Response.json({ error: "Hız sınırı yapılandırması geçersiz." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const testNamespace = process.env.NODE_ENV === "production" ? "" : process.env.MRAP_RATE_LIMIT_NAMESPACE?.trim().slice(0, 80) || "";
  const requestScope = `${bucketName.slice(0, 180)}:${rateLimitClientAddress(request).slice(0, 120)}`;
  const key = scopeHash(testNamespace ? `${testNamespace}:${requestScope}` : requestScope);
  let decision: RateLimitDecision;
  try {
    decision = supabaseProviderEnabled()
      ? await consumeSupabaseRateLimit(key, limit, windowMs)
      : await consumeSqliteRateLimit(key, limit, windowMs);
  } catch {
    return Response.json({ error: "İstek güvenle sınırlandırılamadı. Lütfen yeniden dene." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (decision.allowed) return null;
  return Response.json({ error: "Çok fazla deneme yaptın. Lütfen kısa süre sonra yeniden dene." }, {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, decision.retryAfterSeconds)), "Cache-Control": "no-store" },
  });
}
