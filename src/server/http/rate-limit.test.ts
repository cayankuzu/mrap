import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { checkRateLimit, rateLimitClientAddress } from "@/server/http/rate-limit";

const originalTrustSetting = process.env.MRAP_TRUST_PROXY_HEADERS;

afterEach(() => {
  if (originalTrustSetting === undefined) delete process.env.MRAP_TRUST_PROXY_HEADERS;
  else process.env.MRAP_TRUST_PROXY_HEADERS = originalTrustSetting;
});

describe("hız sınırı istemci kimliği", () => {
  it("proxy güveni açılmadan istemcinin yazdığı IP başlıklarını kullanmaz", () => {
    delete process.env.MRAP_TRUST_PROXY_HEADERS;
    const request = new Request("http://localhost/api/auth/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "x-vercel-forwarded-for": "198.51.100.8",
        "x-forwarded-for": "198.51.100.7",
      },
    });
    expect(rateLimitClientAddress(request)).toBe("güvenilmeyen-ağ");
  });

  it("yalnızca açık güven ayarında Vercel tarafından yönetilen başlığı kullanır", () => {
    process.env.MRAP_TRUST_PROXY_HEADERS = "1";
    const request = new Request("http://localhost/api/auth/login", {
      headers: {
        "cf-connecting-ip": "203.0.113.42",
        "x-vercel-forwarded-for": "198.51.100.7, 10.0.0.2",
        "x-forwarded-for": "198.51.100.9, 10.0.0.3",
      },
    });
    expect(rateLimitClientAddress(request)).toBe("198.51.100.7");
  });

  it("sınırı SQLite üzerinde atomik sayar ve Retry-After ile 429 döndürür", async () => {
    const request = new Request("http://localhost/api/auth/login");
    const bucket = `vitest-${randomUUID()}`;
    expect(await checkRateLimit(request, bucket, 2, 60_000)).toBeNull();
    expect(await checkRateLimit(request, bucket, 2, 60_000)).toBeNull();
    const limited = await checkRateLimit(request, bucket, 2, 60_000);
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
