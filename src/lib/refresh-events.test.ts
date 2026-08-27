import { describe, expect, it } from "vitest";
import { MRAP_REFRESH_EVENT, readMrapRefreshDetail } from "@/lib/refresh-events";

function refreshEvent(type: string, detail: unknown) {
  return { type, detail } as CustomEvent<unknown>;
}

describe("mrap yenileme olayı", () => {
  it("ekran ve panel yenileme ayrıntılarını doğrular", () => {
    expect(readMrapRefreshDetail(refreshEvent(MRAP_REFRESH_EVENT, { source: "button", scope: "screen" })))
      .toEqual({ source: "button", scope: "screen" });
    expect(readMrapRefreshDetail(refreshEvent(MRAP_REFRESH_EVENT, { source: "pull", scope: "panel" })))
      .toEqual({ source: "pull", scope: "panel" });
  });

  it("başka olayları ve bozuk payload'ları yok sayar", () => {
    expect(readMrapRefreshDetail(refreshEvent("storage", { source: "pull", scope: "panel" }))).toBeNull();
    expect(readMrapRefreshDetail(refreshEvent(MRAP_REFRESH_EVENT, { source: "touch", scope: "panel" }))).toBeNull();
    expect(readMrapRefreshDetail(refreshEvent(MRAP_REFRESH_EVENT, { source: "pull", scope: "modal" }))).toBeNull();
  });
});
