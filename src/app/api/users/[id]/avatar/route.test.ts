import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserAvatarData: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({ getUserAvatarData: mocks.getUserAvatarData }));

import { GET } from "@/app/api/users/[id]/avatar/route";
import { jpegDataUrl } from "@/test/image-fixtures";

function context(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-1" });
  mocks.getUserAvatarData.mockReturnValue(jpegDataUrl());
});

describe("profil fotoğrafı GET", () => {
  it("oturum ve kullanıcı kimliği sınırlarını uygular", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/users/user-1/avatar"), context())).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/users/bad/avatar"), context("../bad"))).status).toBe(400);
    expect(mocks.getUserAvatarData).not.toHaveBeenCalled();
  });

  it("doğrulanmış JPEG'i byte yanıtı olarak sunar", async () => {
    const response = await GET(new Request("http://localhost/api/users/user-1/avatar"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(jpegDataUrl().split(",")[1], "base64"));
  });

  it("eksik fotoğrafı 404, bozuk saklı veriyi 422 ile kapatır", async () => {
    mocks.getUserAvatarData.mockReturnValueOnce(null);
    expect((await GET(new Request("http://localhost/api/users/user-1/avatar"), context())).status).toBe(404);
    mocks.getUserAvatarData.mockReturnValueOnce("data:image/jpeg;base64,AAAA");
    expect((await GET(new Request("http://localhost/api/users/user-1/avatar"), context())).status).toBe(422);
  });
});
