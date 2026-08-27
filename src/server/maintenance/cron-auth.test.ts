import { describe, expect, it } from "vitest";
import { hasValidCronAuthorization } from "@/server/maintenance/cron-auth";

describe("cron authorization", () => {
  const secret = "0123456789abcdef0123456789abcdef";

  it("accepts only the exact bearer secret", () => {
    expect(hasValidCronAuthorization(`Bearer ${secret}`, secret)).toBe(true);
    expect(hasValidCronAuthorization(`bearer ${secret}`, secret)).toBe(false);
    expect(hasValidCronAuthorization(`Bearer ${secret}x`, secret)).toBe(false);
  });

  it("fails closed for missing or weak configuration", () => {
    expect(hasValidCronAuthorization(null, secret)).toBe(false);
    expect(hasValidCronAuthorization("Bearer short", "short")).toBe(false);
    expect(hasValidCronAuthorization("Bearer anything", undefined)).toBe(false);
  });
});
