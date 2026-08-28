import { describe, expect, it } from "vitest";
import { resolvePublicOrigin } from "@/lib/public-origin";

describe("resolvePublicOrigin", () => {
  it("canonical origin'i normalize eder", () => {
    expect(resolvePublicOrigin({ MRAP_CANONICAL_ORIGIN: "https://mrap.example/path/", VERCEL_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined })).toBe("https://mrap.example");
  });

  it("Vercel production hostunu preview hostuna tercih eder", () => {
    expect(resolvePublicOrigin({ MRAP_CANONICAL_ORIGIN: undefined, VERCEL_PROJECT_PRODUCTION_URL: "mrap.example", VERCEL_URL: "preview.vercel.app" })).toBe("https://mrap.example");
  });

  it("yerelde standart geliştirme origin'ine döner", () => {
    expect(resolvePublicOrigin({ MRAP_CANONICAL_ORIGIN: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined, VERCEL_URL: undefined })).toBe("http://127.0.0.1:3100");
  });
});
