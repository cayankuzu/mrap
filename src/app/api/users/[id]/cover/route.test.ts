import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserCoverData: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({ getUserCoverData: mocks.getUserCoverData }));

import { GET } from "@/app/api/users/[id]/cover/route";
import { jpegDataUrl } from "@/test/image-fixtures";

function context(id = "user-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-1" });
  mocks.getUserCoverData.mockReturnValue(jpegDataUrl());
});

describe("kapak fotoğrafı GET", () => {
  it("oturum ve kullanıcı kimliği sınırlarını uygular", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/users/user-1/cover"), context())).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/users/bad/cover"), context("../bad"))).status).toBe(400);
    expect(mocks.getUserCoverData).not.toHaveBeenCalled();
  });

  it("doğrulanmış JPEG'i private byte yanıtı olarak sunar", async () => {
    const response = await GET(new Request("http://localhost/api/users/user-1/cover"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(jpegDataUrl().split(",")[1], "base64"));
  });

  it("eksik fotoğrafı 404, bozuk saklı veriyi 422 ile kapatır", async () => {
    mocks.getUserCoverData.mockReturnValueOnce(null);
    expect((await GET(new Request("http://localhost/api/users/user-1/cover"), context())).status).toBe(404);
    mocks.getUserCoverData.mockReturnValueOnce("data:image/jpeg;base64,AAAA");
    expect((await GET(new Request("http://localhost/api/users/user-1/cover"), context())).status).toBe(422);
  });
});
