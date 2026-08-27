import { describe, expect, it } from "vitest";
import { decodeCommentCursor, encodeCommentCursor } from "@/lib/comment-cursor";

describe("yorum keyset imleci", () => {
  it("oluşturduğu opak imleci kayıpsız çözer", () => {
    const cursor = { createdAt: "2026-08-27 12:34:56", id: "184f6f1d-0a04-49b1-bd2c-c5ff285c27ae" };
    const encoded = encodeCommentCursor(cursor);

    expect(encoded).not.toContain(cursor.createdAt);
    expect(decodeCommentCursor(encoded)).toEqual(cursor);
  });

  it.each([
    "",
    "%%%",
    "a".repeat(513),
    Buffer.from(JSON.stringify({ v: 2, t: "2026-08-27 12:34:56", i: "comment-1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, t: "geçersiz", i: "comment-1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ v: 1, t: "2026-08-27 12:34:56", i: "../comment" })).toString("base64url"),
  ])("bozuk veya desteklenmeyen imleci reddeder: %s", (encoded) => {
    expect(decodeCommentCursor(encoded)).toBeNull();
  });
});
