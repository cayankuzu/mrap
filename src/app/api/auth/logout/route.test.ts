import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  destroySession: vi.fn(),
  getCurrentUser: vi.fn(),
  revokeActiveSessionsForUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ destroySession: mocks.destroySession, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/game/store", () => ({
  authoritativeGameStore: { revokeActiveSessionsForUser: mocks.revokeActiveSessionsForUser },
}));

import { POST } from "@/app/api/auth/logout/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.revokeActiveSessionsForUser.mockReturnValue(1);
});

describe("güvenli çıkış", () => {
  it("cookie'yi silmeden önce etkin rota lease'ini sunucuda iptal eder", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mocks.revokeActiveSessionsForUser).toHaveBeenCalledWith("user-1");
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });

  it("rota iptali başarısızsa oturumu açık bırakarak güvenli retry sağlar", async () => {
    mocks.revokeActiveSessionsForUser.mockImplementation(() => { throw new Error("db busy"); });
    const response = await POST();
    expect(response.status).toBe(503);
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });
});
