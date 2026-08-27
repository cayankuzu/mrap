import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { database } from "@/lib/database";
import { checkRateLimit, rateLimitClientAddress } from "@/server/http/rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
});

afterEach(() => {
  database.prepare("DELETE FROM api_rate_limits WHERE scope_hash LIKE 'ffff%'").run();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("kalıcı ve atomik hız sınırı davranışları", () => {
  it("yalnız Vercel tarafından yönetilen istemci IP başlığını kabul eder", () => {
    vi.stubEnv("MRAP_TRUST_PROXY_HEADERS", "1");

    expect(rateLimitClientAddress(new Request("https://mrap.test", {
      headers: {
        "cf-connecting-ip": "203.0.113.1",
        "x-vercel-forwarded-for": "203.0.113.2, 10.0.0.1",
        "x-forwarded-for": "203.0.113.3, 10.0.0.2",
      },
    }))).toBe("203.0.113.2");
    expect(rateLimitClientAddress(new Request("https://mrap.test", {
      headers: { "x-vercel-forwarded-for": "203.0.113.2, 10.0.0.1" },
    }))).toBe("203.0.113.2");
    expect(rateLimitClientAddress(new Request("https://mrap.test", {
      headers: { "x-forwarded-for": "203.0.113.3, 10.0.0.2" },
    }))).toBe("bilinmeyen-ağ");
    expect(rateLimitClientAddress(new Request("https://mrap.test", {
      headers: { "cf-connecting-ip": "203.0.113.1" },
    }))).toBe("bilinmeyen-ağ");
    expect(rateLimitClientAddress(new Request("https://mrap.test"))).toBe("bilinmeyen-ağ");
  });

  it("pencere içinde limiti uygular ve süre dolunca yeni pencere açar", async () => {
    const incoming = new Request("https://mrap.test/api/auth/login");
    const bucket = `login-${randomUUID()}`;

    expect(await checkRateLimit(incoming, bucket, 2, 10_000)).toBeNull();
    expect(await checkRateLimit(incoming, bucket, 2, 10_000)).toBeNull();
    const limited = await checkRateLimit(incoming, bucket, 2, 10_000);
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("retry-after")).toBe("10");

    vi.advanceTimersByTime(10_000);
    expect(await checkRateLimit(incoming, bucket, 2, 10_000)).toBeNull();
  });

  it("süresi dolan kalıcı kayıtları temizler", async () => {
    const now = Date.now();
    const expiredHash = `ffff${"0".repeat(60)}`;
    const futureHash = `ffff${"1".repeat(60)}`;
    database.prepare("INSERT OR REPLACE INTO api_rate_limits (scope_hash, hit_count, reset_at_ms) VALUES (?, 1, ?)").run(expiredHash, now - 1);
    database.prepare("INSERT OR REPLACE INTO api_rate_limits (scope_hash, hit_count, reset_at_ms) VALUES (?, 1, ?)").run(futureHash, now + 60_000);

    expect(await checkRateLimit(new Request("https://mrap.test"), `fresh-${randomUUID()}`, 1, 10_000)).toBeNull();
    expect(database.prepare("SELECT 1 FROM api_rate_limits WHERE scope_hash = ?").get(expiredHash)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM api_rate_limits WHERE scope_hash = ?").get(futureHash)).toBeDefined();
  });

  it("bucket ve IP metnini saklamayıp yalnız SHA-256 scope hash'i kalıcılaştırır", async () => {
    vi.stubEnv("MRAP_TRUST_PROXY_HEADERS", "1");
    const bucket = `private-${randomUUID()}`;
    const address = "198.51.100.77";
    expect(await checkRateLimit(new Request("https://mrap.test", { headers: { "x-vercel-forwarded-for": address } }), bucket, 1, 10_000)).toBeNull();

    const rawLeak = database.prepare("SELECT 1 FROM api_rate_limits WHERE scope_hash LIKE ? OR scope_hash LIKE ?").get(`%${bucket}%`, `%${address}%`);
    expect(rawLeak).toBeUndefined();
    const latest = database.prepare("SELECT scope_hash FROM api_rate_limits ORDER BY updated_at DESC LIMIT 1").get() as { scope_hash: string };
    expect(latest.scope_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("üretim dışında test koşularını ayrı hız sınırı ad alanlarında yalıtır", async () => {
    const bucket = `isolated-${randomUUID()}`;
    const request = new Request("https://mrap.test");
    vi.stubEnv("MRAP_RATE_LIMIT_NAMESPACE", "koşu-a");
    expect(await checkRateLimit(request, bucket, 1, 10_000)).toBeNull();
    expect((await checkRateLimit(request, bucket, 1, 10_000))?.status).toBe(429);

    vi.stubEnv("MRAP_RATE_LIMIT_NAMESPACE", "koşu-b");
    expect(await checkRateLimit(request, bucket, 1, 10_000)).toBeNull();
  });
});
