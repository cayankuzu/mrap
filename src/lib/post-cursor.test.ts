import { describe, expect, it } from "vitest";
import { decodePostCursor, encodePostCursor } from "@/lib/post-cursor";

describe("gönderi cursor sözleşmesi", () => {
  it("zaman ve kimlik eşitlik bozucusunu kayıpsız kodlar", () => {
    const cursor = { createdAt: "2026-08-27 10:00:00", id: "post_42" };
    expect(decodePostCursor(encodePostCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "%%%", "a".repeat(513), Buffer.from("{}", "utf8").toString("base64url")])(
    "bozuk cursor değerini reddeder: %s",
    (value) => expect(decodePostCursor(value)).toBeNull(),
  );

  it("geçersiz zaman veya kimlik üretimine izin vermez", () => {
    expect(() => encodePostCursor({ createdAt: "bugün", id: "post-1" })).toThrow(RangeError);
    expect(() => encodePostCursor({ createdAt: "2026-08-27 10:00:00", id: "../post" })).toThrow(RangeError);
  });
});
