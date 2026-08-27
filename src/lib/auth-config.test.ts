import { describe, expect, it } from "vitest";
import { hasOptimisticSessionCookie } from "@/lib/auth-config";

describe("iyimser oturum çerezi sınırı", () => {
  it("SQLite sağlayıcısında yalnız mrap oturum çerezini kabul eder", () => {
    expect(hasOptimisticSessionCookie([{ name: "mrap_session", value: "oturum" }], {
      MRAP_DATA_PROVIDER: "sqlite",
    })).toBe(true);
    expect(hasOptimisticSessionCookie([{ name: "başka", value: "oturum" }], {
      MRAP_DATA_PROVIDER: "sqlite",
    })).toBe(false);
  });

  it("Supabase sağlayıcısında projeye ait normal veya parçalı SSR çerezini kabul eder", () => {
    const environment = { MRAP_DATA_PROVIDER: "supabase", SUPABASE_PROJECT_REF: "kpsiqurdxumsouimjmvc" };
    expect(hasOptimisticSessionCookie([
      { name: "sb-kpsiqurdxumsouimjmvc-auth-token", value: "oturum" },
    ], environment)).toBe(true);
    expect(hasOptimisticSessionCookie([
      { name: "sb-kpsiqurdxumsouimjmvc-auth-token.0", value: "parça" },
    ], environment)).toBe(true);
  });

  it("boş, farklı proje veya eksik proje ref çerezlerini reddeder", () => {
    expect(hasOptimisticSessionCookie([
      { name: "sb-baskaproje00000000000-auth-token", value: "oturum" },
    ], { MRAP_DATA_PROVIDER: "supabase", SUPABASE_PROJECT_REF: "kpsiqurdxumsouimjmvc" })).toBe(false);
    expect(hasOptimisticSessionCookie([
      { name: "sb-kpsiqurdxumsouimjmvc-auth-token", value: "" },
    ], { MRAP_DATA_PROVIDER: "supabase", SUPABASE_PROJECT_REF: "kpsiqurdxumsouimjmvc" })).toBe(false);
    expect(hasOptimisticSessionCookie([], { MRAP_DATA_PROVIDER: "supabase" })).toBe(false);
  });
});
