import { describe, expect, it } from "vitest";
import { desiredStateRequest } from "@/lib/desired-state-request";

describe("desired-state mutation isteği", () => {
  it.each([true, false])("%s durumunu kesin JSON sözleşmesiyle gönderir", (desired) => {
    expect(desiredStateRequest(desired)).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desired }),
    });
  });
});
