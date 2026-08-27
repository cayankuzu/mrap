import { describe, expect, it } from "vitest";
import { decodeConnectionCursor, encodeConnectionCursor } from "@/lib/connection-cursor";

describe("bağlantı sayfalama imleci", () => {
  it("Türkçe arama anahtarını güvenli şekilde round-trip eder", () => {
    const cursor = { searchKey: "cayan akin", id: "user_24" };
    expect(decodeConnectionCursor(encodeConnectionCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "***", Buffer.from(JSON.stringify({ v: 2, k: "x", i: "u1" })).toString("base64url")])("geçersiz imleci reddeder", (value) => {
    expect(decodeConnectionCursor(value)).toBeNull();
  });

  it("geçersiz kimlik içeren imleci üretmez", () => {
    expect(() => encodeConnectionCursor({ searchKey: "oyuncu", id: "../user" })).toThrow(RangeError);
  });
});
