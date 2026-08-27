import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server-config", () => ({ supabaseProviderEnabled: () => true }));
vi.mock("@/lib/supabase/admin-client", () => ({
  createMrapSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { checkRateLimit } from "@/server/http/rate-limit";

describe("Supabase dağıtık hız sınırı", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    vi.stubEnv("MRAP_TRUST_PROXY_HEADERS", "1");
    vi.stubEnv("MRAP_RATE_LIMIT_NAMESPACE", "supabase-test");
  });

  it("service-role RPC kararını kullanır ve ham istemci adresini göndermeden izin verir", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: true, remaining: 4, retry_after_seconds: 0 }],
      error: null,
    });
    const response = await checkRateLimit(new Request("https://mrap.test", {
      headers: {
        "cf-connecting-ip": "203.0.113.99",
        "x-vercel-forwarded-for": "203.0.113.10",
      },
    }), "kayıt", 5, 60_000);

    expect(response).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const [name, payload] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("mrap_consume_rate_limit");
    expect(payload).toMatchObject({ p_maximum_hits: 5, p_window_ms: 60_000 });
    expect(payload.p_scope_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(payload)).not.toContain("203.0.113.10");
    expect(JSON.stringify(payload)).not.toContain("203.0.113.99");
  });

  it("engellenen kararı Retry-After başlığıyla döndürür", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: false, remaining: 0, retry_after_seconds: 17 }],
      error: null,
    });
    const response = await checkRateLimit(new Request("https://mrap.test"), "giriş", 2, 60_000);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("17");
  });

  it("RPC hatasında fail-closed davranır", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000" } });
    const response = await checkRateLimit(new Request("https://mrap.test"), "giriş", 2, 60_000);
    expect(response?.status).toBe(503);
  });
});
