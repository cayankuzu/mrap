import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getPostImageForViewer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({ getPostImageForViewer: mocks.getPostImageForViewer }));

import { GET } from "@/app/api/posts/[id]/images/[index]/route";
import { jpegDataUrl } from "@/test/image-fixtures";

function context(id = "post-1", index = "0") {
  return { params: Promise.resolve({ id, index }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-1" });
  mocks.getPostImageForViewer.mockReturnValue(jpegDataUrl());
});

describe("gönderi fotoğrafı GET", () => {
  it("oturumsuz erişimi ve geçersiz fotoğraf sırasını reddeder", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/posts/post-1/images/0"), context())).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/posts/post-1/images/8"), context("post-1", "8"))).status).toBe(400);
    expect(mocks.getPostImageForViewer).not.toHaveBeenCalled();
  });

  it("yetkili kullanıcıya doğrulanmış JPEG byte yanıtı döndürür", async () => {
    const response = await GET(new Request("http://localhost/api/posts/post-1/images/0"), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(jpegDataUrl().split(",")[1], "base64"));
    expect(mocks.getPostImageForViewer).toHaveBeenCalledWith("viewer-1", "post-1", 0);
  });

  it("görünmeyen kaydı 404, bozuk saklı medyayı 422 ile kapatır", async () => {
    mocks.getPostImageForViewer.mockReturnValueOnce(null);
    expect((await GET(new Request("http://localhost/api/posts/post-1/images/0"), context())).status).toBe(404);
    mocks.getPostImageForViewer.mockReturnValueOnce("data:image/jpeg;base64,AAAA");
    expect((await GET(new Request("http://localhost/api/posts/post-1/images/0"), context())).status).toBe(422);
  });
});
