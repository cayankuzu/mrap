import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  deleteUserAccount: vi.fn(),
  destroySession: vi.fn(),
  getCurrentUser: vi.fn(),
  verifyCurrentUserPassword: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  destroySession: mocks.destroySession,
  getCurrentUser: mocks.getCurrentUser,
  verifyCurrentUserPassword: mocks.verifyCurrentUserPassword,
}));
vi.mock("@/lib/repository", () => ({ deleteUserAccount: mocks.deleteUserAccount }));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { DELETE } from "@/app/api/account/route";

function deletionRequest(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("DELETE /api/account yeniden kimlik doğrulama", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-1", username: "oyuncu_1" });
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.destroySession.mockResolvedValue(undefined);
    mocks.deleteUserAccount.mockReturnValue(true);
  });

  it("yanlış parola ve yanlış kullanıcı adı için aynı genel hatayı döndürür", async () => {
    mocks.verifyCurrentUserPassword.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const wrongPassword = await DELETE(deletionRequest({ confirmation: "oyuncu_1", acknowledged: true, password: "yanlis-sifre" }));
    const wrongUsername = await DELETE(deletionRequest({ confirmation: "baska_oyuncu", acknowledged: true, password: "dogru-sifre" }));

    expect(wrongPassword.status).toBe(400);
    expect(wrongUsername.status).toBe(400);
    expect(await wrongPassword.json()).toEqual(await wrongUsername.json());
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("parola sunucuda doğrulanmadan hesabı silmez", async () => {
    mocks.verifyCurrentUserPassword.mockReturnValue(false);
    await DELETE(deletionRequest({ confirmation: "oyuncu_1", acknowledged: true, password: "yanlis-sifre" }));

    expect(mocks.verifyCurrentUserPassword).toHaveBeenCalledWith("user-1", "yanlis-sifre");
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
  });

  it("tam onay ve doğru parola sonrası hesabı silip oturumu kapatır", async () => {
    mocks.verifyCurrentUserPassword.mockReturnValue(true);
    const response = await DELETE(deletionRequest({ confirmation: "oyuncu_1", acknowledged: true, password: "dogru-sifre" }));

    expect(response.status).toBe(200);
    expect(mocks.verifyCurrentUserPassword).toHaveBeenCalledWith("user-1", "dogru-sifre");
    expect(mocks.deleteUserAccount).toHaveBeenCalledWith("user-1");
    expect(mocks.destroySession).toHaveBeenCalledOnce();
  });

  it("veritabanı işlemi başarısızsa güvenli hata döndürür ve oturumu korur", async () => {
    mocks.verifyCurrentUserPassword.mockReturnValue(true);
    mocks.deleteUserAccount.mockImplementation(() => { throw new Error("database detail"); });

    const response = await DELETE(deletionRequest({ confirmation: "oyuncu_1", acknowledged: true, password: "dogru-sifre" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Hesap şu anda silinemedi. Hiçbir verin değiştirilmedi; lütfen yeniden dene." });
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("beklenmeyen alan içeren gövdeyi parola kontrolünden önce reddeder", async () => {
    const response = await DELETE(deletionRequest({ confirmation: "oyuncu_1", acknowledged: true, password: "dogru-sifre", extra: true }));

    expect(response.status).toBe(400);
    expect(mocks.verifyCurrentUserPassword).not.toHaveBeenCalled();
    expect(mocks.deleteUserAccount).not.toHaveBeenCalled();
  });
});
