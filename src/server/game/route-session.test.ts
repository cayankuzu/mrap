import { describe, expect, it } from "vitest";
import { calculateTrackedDistanceM, isRouteCoordinate } from "@/server/game/route-session";

describe("tam rota oturumu mesafesi", () => {
  it("yalnız son claim segmentini değil izlenen bütün yolu toplar", () => {
    const coordinates: [number, number][] = [
      [0, 0],
      [0, 0.002258],
      [0.000899, 0.002258],
    ];
    const fullDistanceM = calculateTrackedDistanceM(coordinates);
    const lastSegmentM = calculateTrackedDistanceM(coordinates.slice(-2));

    expect(fullDistanceM).toBeGreaterThan(349);
    expect(fullDistanceM).toBeLessThan(353);
    expect(lastSegmentM).toBeGreaterThan(99);
    expect(lastSegmentM).toBeLessThan(101);
  });

  it("harita koordinat sınırlarını doğrular", () => {
    expect(isRouteCoordinate([29.02, 41.01])).toBe(true);
    expect(isRouteCoordinate([181, 41.01])).toBe(false);
    expect(isRouteCoordinate([29.02, Number.NaN])).toBe(false);
  });
});
