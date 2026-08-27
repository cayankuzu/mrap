import { describe, expect, it } from "vitest";
import { locationCaptureDisposition, requiresOnlineSegmentBoundary } from "@/lib/game/offline-route-policy";

describe("competitive çevrimdışı rota politikası", () => {
  it("tarayıcı offline iken GPS örneğini yalnız kişisel taslağa yönlendirir", () => {
    expect(locationCaptureDisposition(false, "TRACKING")).toBe("personal_offline_draft");
    expect(locationCaptureDisposition(false, "LOOP_AVAILABLE")).toBe("personal_offline_draft");
  });

  it("navigator online görünse bile bağlantı hatası doğrulanana kadar authoritative kuyruğa dönmez", () => {
    expect(locationCaptureDisposition(true, "PAUSED_OFFLINE")).toBe("personal_offline_draft");
    expect(locationCaptureDisposition(true, "RESYNCING_MAP")).toBe("authoritative_online");
  });

  it("kişisel taslak varsa reconnect sonrası ayrı server segmenti zorunlu kılar", () => {
    expect(requiresOnlineSegmentBoundary(0)).toBe(false);
    expect(requiresOnlineSegmentBoundary(1)).toBe(true);
    expect(requiresOnlineSegmentBoundary(512)).toBe(true);
  });
});
