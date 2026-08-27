import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUser } from "@/lib/models";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  recordMetric: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/game/store", () => ({
  authoritativeGameStore: mocks,
}));

import { enforceGameLimit } from "@/server/game/api-helpers";

const user = { id: "player-1" } as AppUser;

describe("oyun hız sınırı istemci adresi", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("MRAP_TRUST_PROXY_HEADERS", "1");
    mocks.consumeRateLimit.mockReset().mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterSeconds: 0,
    });
    mocks.recordMetric.mockReset().mockResolvedValue(undefined);
  });

  it("IP kapsamını yalnız Vercel tarafından yönetilen başlıktan üretir", async () => {
    const request = new Request("https://mrap.test/api/game/claims", {
      headers: {
        "cf-connecting-ip": "203.0.113.99",
        "x-vercel-forwarded-for": "198.51.100.7, 10.0.0.2",
        "x-forwarded-for": "203.0.113.98, 10.0.0.3",
      },
    });

    await enforceGameLimit(user, request, "claim", 4, 60_000);

    expect(mocks.consumeRateLimit.mock.calls.map(([scope]) => scope)).toEqual([
      "user:player-1:claim",
      "ip:198.51.100.7:claim",
    ]);
  });

  it("yalnız istemcinin yazabildiği başlıklar varsa IP kapsamı eklemez", async () => {
    const request = new Request("https://mrap.test/api/game/claims", {
      headers: {
        "cf-connecting-ip": "203.0.113.99",
        "x-forwarded-for": "203.0.113.98, 10.0.0.3",
      },
    });

    await enforceGameLimit(user, request, "claim", 4, 60_000);

    expect(mocks.consumeRateLimit.mock.calls.map(([scope]) => scope)).toEqual([
      "user:player-1:claim",
    ]);
  });
});
