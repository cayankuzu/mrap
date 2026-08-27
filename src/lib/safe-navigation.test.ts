import { describe, expect, it } from "vitest";
import { normalizeProtectedReturnPath } from "@/lib/safe-navigation";

describe("giriş sonrası güvenli dönüş yolu", () => {
  it("korumalı göreli rota ve sorguyu korur", () => {
    expect(normalizeProtectedReturnPath("/users/ada?post=p-1")).toBe("/users/ada?post=p-1");
    expect(normalizeProtectedReturnPath("/posts/post-1?comments=1")).toBe("/posts/post-1?comments=1");
    expect(normalizeProtectedReturnPath("/play")).toBe("/play");
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example",
    "/login",
    "/unknown",
    "javascript:alert(1)",
  ])("açık yönlendirme girdisini ana akışa kapatır: %s", (value) => {
    expect(normalizeProtectedReturnPath(value)).toBe("/home");
  });
});
