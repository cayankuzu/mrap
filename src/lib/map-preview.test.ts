import { describe, expect, it } from "vitest";
import { createDemoGeometry, normalizeMapCamera } from "@/lib/map-preview";

describe("gönderi harita kadrajı", () => {
  it("geçerli kamerayı güvenli hassasiyete indirger", () => {
    expect(normalizeMapCamera({ center: [29.123456789, 40.987654321], zoom: 15.678, bearing: -12.345, pitch: 24.567 })).toEqual({
      center: [29.123457, 40.987654],
      zoom: 15.68,
      bearing: -12.35,
      pitch: 24.57,
    });
  });

  it("sınır dışındaki veya eksik kamerayı reddeder", () => {
    expect(normalizeMapCamera({ center: [181, 41], zoom: 15, bearing: 0, pitch: 0 })).toBeNull();
    expect(normalizeMapCamera({ center: [29, 41], zoom: 28, bearing: 0, pitch: 0 })).toBeNull();
    expect(normalizeMapCamera({ center: [29, 41], zoom: 15, bearing: 0 })).toBeNull();
  });

  it("demo alanı için kapanmış bir polygon üretir", () => {
    const geometry = createDemoGeometry({ name: "Moda", district: "Kadıköy, İstanbul", color: "#12cdb0", variant: 3 });
    expect(geometry.coordinates[0].length).toBeGreaterThan(4);
    expect(geometry.coordinates[0][0]).toEqual(geometry.coordinates[0].at(-1));
  });
});
