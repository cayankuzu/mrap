import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCommentCursor } from "@/lib/comment-cursor";
import { IdempotencyPayloadConflictError } from "@/lib/mutation-idempotency-store";

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  checkRateLimit: vi.fn(),
  getCurrentUser: vi.fn(),
  listPostComments: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/repository", () => ({
  addComment: mocks.addComment,
  listPostComments: mocks.listPostComments,
}));
vi.mock("@/server/http/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET, POST } from "@/app/api/posts/[id]/comments/route";

const context = { params: Promise.resolve({ id: "post-1" }) };
const idempotencyKey = "comment-attempt-12345678";
const comment = {
  id: "comment-1",
  postId: "post-1",
  body: "Harika bir rota!",
  createdAt: "2026-08-27 12:00:00",
  user: {
    id: "user-2",
    username: "gezgin",
    displayName: "Ada Yılmaz",
    initials: "AY",
    color: "#0D8BFF",
    avatarData: null,
  },
};

function getRequest(query = "") {
  return new Request(`http://localhost/api/posts/post-1/comments${query}`);
}

function postRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/posts/post-1/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue(null);
  mocks.getCurrentUser.mockResolvedValue({ id: "viewer-1" });
});

describe("GET /api/posts/[id]/comments", () => {
  it("oturumsuz isteği reddeder", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(getRequest(), context);

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.listPostComments).not.toHaveBeenCalled();
  });

  it.each(["?limit=0", "?limit=51", "?limit=1e2", "?cursor=bozuk"])("geçersiz sayfalama girdisini reddeder: %s", async (query) => {
    const response = await GET(getRequest(query), context);

    expect(response.status).toBe(400);
    expect(mocks.listPostComments).not.toHaveBeenCalled();
  });

  it("doğrulanmış cursor ve limiti repository sözleşmesine geçirir", async () => {
    const cursor = { createdAt: "2026-08-27 11:59:00", id: "comment-0" };
    const page = { comments: [comment], nextCursor: null, total: 1 };
    mocks.listPostComments.mockReturnValue(page);

    const response = await GET(getRequest(`?cursor=${encodeURIComponent(encodeCommentCursor(cursor))}&limit=12`), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "post-comments-list:viewer-1", 120, 3_600_000);
    expect(mocks.listPostComments).toHaveBeenCalledWith("viewer-1", "post-1", { cursor, limit: 12 });
  });

  it("canViewPost denetiminden geçmeyen repository sonucunu varlık sızdırmadan 404 yapar", async () => {
    mocks.listPostComments.mockReturnValue(null);
    const response = await GET(getRequest(), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Gönderi bulunamadı." });
  });
});

describe("POST /api/posts/[id]/comments", () => {
  it("JSON olmayan ve boyut sınırını aşan gövdeleri güvenli okuyucuyla reddeder", async () => {
    const wrongMedia = new Request("http://localhost/api/posts/post-1/comments", { method: "POST", body: "yorum" });
    const tooLarge = postRequest({ body: "yorum" }, { "Content-Length": "4097" });

    expect((await POST(wrongMedia, context)).status).toBe(415);
    expect((await POST(tooLarge, context)).status).toBe(413);
    expect(mocks.addComment).not.toHaveBeenCalled();
  });

  it.each([
    [{ body: "yorum", idempotencyKey, extra: true }, 400],
    [{ body: 42, idempotencyKey }, 400],
    [{ body: "   ", idempotencyKey }, 400],
    [{ body: "x".repeat(301), idempotencyKey }, 400],
    [{ body: "yorum" }, 400],
    [{ body: "yorum", idempotencyKey: "kısa" }, 400],
  ] as const)("geçersiz yorum gövdesini reddeder", async (payload, status) => {
    const response = await POST(postRequest(payload), context);

    expect(response.status).toBe(status);
    expect(mocks.addComment).not.toHaveBeenCalled();
  });

  it("kullanıcı bazlı rate limit yanıtını geçirir", async () => {
    mocks.checkRateLimit.mockReturnValue(new Response(null, { status: 429 }));
    const response = await POST(postRequest({ body: "yorum" }), context);

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "post-comment-create:viewer-1", 30, 600_000);
    expect(mocks.addComment).not.toHaveBeenCalled();
  });

  it("tam yorum DTO'su ve güncel toplamı 201 ile döndürür", async () => {
    const result = { comment, total: 7, replayed: false };
    mocks.addComment.mockReturnValue(result);
    const response = await POST(postRequest({ body: "  Harika bir rota!  ", idempotencyKey }), context);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ comment, total: 7 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.addComment).toHaveBeenCalledWith("viewer-1", "post-1", "Harika bir rota!", idempotencyKey);
  });

  it("görülemeyen veya bulunmayan gönderide 404 döndürür", async () => {
    mocks.addComment.mockReturnValue(null);
    const response = await POST(postRequest({ body: "yorum", idempotencyKey }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Gönderi bulunamadı." });
  });

  it("aynı anahtar farklı yorum metniyle kullanılırsa 409 conflict döndürür", async () => {
    mocks.addComment.mockImplementation(() => { throw new IdempotencyPayloadConflictError(); });

    const response = await POST(postRequest({ body: "Değişen yorum", idempotencyKey }), context);

    expect(response.status).toBe(409);
    expect(mocks.addComment).toHaveBeenCalledTimes(1);
  });
});
