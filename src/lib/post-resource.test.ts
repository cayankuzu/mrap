import { describe, expect, it } from "vitest";
import { normalizePostResourceId, postDetailPath } from "@/lib/post-resource";

describe("tekil gönderi kaynağı", () => {
  it("güvenli kimlik için kararlı uygulama içi bağlantı üretir", () => {
    expect(postDetailPath("post_2026-08")).toBe("/posts/post_2026-08");
    expect(normalizePostResourceId("post-1")).toBe("post-1");
  });

  it.each(["", "../settings", "post/1", "%2Fsettings", "x".repeat(129), "%E0%A4%A"])("güvensiz kimliği reddeder: %s", (value) => {
    expect(normalizePostResourceId(value)).toBeNull();
    expect(() => postDetailPath(value)).toThrow(RangeError);
  });
});
