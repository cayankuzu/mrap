import { beforeEach, describe, expect, it, vi } from "vitest";
import { API_BODY_BYTE_LIMITS } from "@/server/http/api-security";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getCurrentUser: vi.fn(),
  markNotificationsRead: vi.fn(),
  resolveFollowRequest: vi.fn(),
  setFollowState: vi.fn(),
  setLikeState: vi.fn(),
  setSaveState: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({
  listNotifications: vi.fn(() => []),
  markNotificationsRead: mocks.markNotificationsRead,
  resolveFollowRequest: mocks.resolveFollowRequest,
  setFollowState: mocks.setFollowState,
  setLikeState: mocks.setLikeState,
  setSaveState: mocks.setSaveState,
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST as resolveFollowRequest } from "@/app/api/follow-requests/[id]/route";
import { POST as toggleFollow } from "@/app/api/follows/[id]/route";
import { PUT as markNotificationsRead } from "@/app/api/notifications/route";
import { POST as toggleLike } from "@/app/api/posts/[id]/like/route";
import { POST as toggleSave } from "@/app/api/posts/[id]/save/route";

const context = { params: Promise.resolve({ id: "target-1" }) };

function request(url: string, method = "POST", body?: unknown, contentLength?: number) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : {
      "Content-Type": "application/json",
      ...(contentLength === undefined ? {} : { "Content-Length": String(contentLength) }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.resolveFollowRequest.mockReturnValue(true);
  mocks.setFollowState.mockReturnValue({ status: "following" });
  mocks.setLikeState.mockReturnValue({ liked: true, count: 1 });
  mocks.setSaveState.mockReturnValue({ saved: true });
});

describe("takip isteği çözümleme gövdesi", () => {
  it("JSON olmayan ve sınırı aşan gövdeleri reddeder", async () => {
    const wrongType = new Request("http://localhost/api/follow-requests/target-1", { method: "POST", body: "{}" });
    const tooLarge = request("http://localhost/api/follow-requests/target-1", "POST", { action: "accept" }, API_BODY_BYTE_LIMITS.followRequestResolution + 1);

    expect((await resolveFollowRequest(wrongType, context)).status).toBe(415);
    expect((await resolveFollowRequest(tooLarge, context)).status).toBe(413);
    expect(mocks.resolveFollowRequest).not.toHaveBeenCalled();
  });

  it("geçerli işlemi kullanıcı kapsamlı rate-limit ile çözer", async () => {
    const response = await resolveFollowRequest(request("http://localhost/api/follow-requests/target-1", "POST", { action: "accept" }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "follow-request-resolution:user-1", 120, 600_000);
  });
});

describe("gövdesiz sosyal mutation rate-limitleri", () => {
  it("takip, beğeni, kaydetme ve bildirim işlemlerini ayrı kullanıcı kovalarında sınırlar", async () => {
    expect((await toggleFollow(request("http://localhost/api/follows/target-1", "POST", { desired: true }), context)).status).toBe(200);
    expect((await toggleLike(request("http://localhost/api/posts/target-1/like", "POST", { desired: true }), context)).status).toBe(200);
    expect((await toggleSave(request("http://localhost/api/posts/target-1/save", "POST", { desired: true }), context)).status).toBe(200);
    expect((await markNotificationsRead(request("http://localhost/api/notifications", "PUT"))).status).toBe(200);

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "follow-toggle:user-1", 120, 600_000);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "post-like:user-1", 300, 600_000);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "post-save:user-1", 240, 600_000);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "notification-read:user-1", 120, 600_000);
  });

  it("aynı hedef durumu tekrar göndermeyi idempotent repository sözleşmesine taşır", async () => {
    await toggleLike(request("http://localhost/api/posts/target-1/like", "POST", { desired: true }), context);
    await toggleLike(request("http://localhost/api/posts/target-1/like", "POST", { desired: true }), context);

    expect(mocks.setLikeState).toHaveBeenNthCalledWith(1, "user-1", "target-1", true);
    expect(mocks.setLikeState).toHaveBeenNthCalledWith(2, "user-1", "target-1", true);
  });

  it("geçersiz sosyal mutation gövdelerini reddeder", async () => {
    expect((await toggleFollow(request("http://localhost/api/follows/target-1", "POST", { desired: "evet" }), context)).status).toBe(400);
    expect((await toggleSave(request("http://localhost/api/posts/target-1/save", "POST", { desired: true, extra: true }), context)).status).toBe(400);
  });
});
