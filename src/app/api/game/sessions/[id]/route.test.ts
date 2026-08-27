import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  beginOnlineSegment: vi.fn(),
  finishSession: vi.fn(),
  getSessionRecovery: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordMetric: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/game/store", () => ({
  authoritativeGameStore: {
    beginOnlineSegment: mocks.beginOnlineSegment,
    finishSession: mocks.finishSession,
    getSessionRecovery: mocks.getSessionRecovery,
    consumeRateLimit: mocks.consumeRateLimit,
    recordMetric: mocks.recordMetric,
  },
}));

import { PATCH } from "@/app/api/game/sessions/[id]/route";

const nonce = "n".repeat(43);
const context = { params: Promise.resolve({ id: "session-1" }) };

function request(body: unknown) {
  return new Request("http://localhost/api/game/sessions/session-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-mrap-session-nonce": nonce },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.consumeRateLimit.mockReturnValue({ allowed: true, remaining: 20, retryAfterSeconds: 0 });
  mocks.beginOnlineSegment.mockReturnValue({
    id: "session-1",
    currentSegmentIndex: 2,
    serverNonce: nonce,
  });
});

describe("online rota segmenti API sözleşmesi", () => {
  it("çevrimdışı taslaktan sonra yalnız segment indeksini sunucuya iletir", async () => {
    const response = await PATCH(request({ action: "resume_online", expectedCurrentSegmentIndex: 1 }), context);

    expect(response.status).toBe(200);
    expect(mocks.beginOnlineSegment).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      sessionId: "session-1",
      nonce,
      expectedCurrentSegmentIndex: 1,
    }));
    const serializedCall = JSON.stringify(mocks.beginOnlineSegment.mock.calls[0][0]);
    expect(serializedCall).not.toContain("latitude");
    expect(serializedCall).not.toContain("longitude");
    expect(serializedCall).not.toContain("points");
  });

  it("raw GPS veya istemci segment bayrağı eklenmiş payloadı reddeder", async () => {
    const response = await PATCH(request({
      action: "resume_online",
      expectedCurrentSegmentIndex: 1,
      points: [{ latitude: 41, longitude: 29 }],
    }), context);

    expect(response.status).toBe(400);
    expect(mocks.beginOnlineSegment).not.toHaveBeenCalled();
  });
});
