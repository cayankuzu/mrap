import area from "@turf/area";
import { feature } from "@turf/helpers";
import type { Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { TerritoryEngine } from "@/lib/territory/territory-engine";

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

describe("TerritoryEngine", () => {
  const engine = new TerritoryEngine();

  it("örtüşen claimleri union ile birleştirir ve yalnız benzersiz alanı ekler", () => {
    const existing = rectangle(29, 41, 29.01, 41.01);
    const incoming = rectangle(29.005, 41, 29.015, 41.01);
    const incomingAreaM2 = area(feature(incoming));

    const result = engine.calculateUniqueArea(existing, incoming);
    const overlapM2 = engine.calculateOverlap(existing, incoming);

    expect(result.afterM2).toBeGreaterThan(result.beforeM2);
    expect(result.newlyAddedAreaM2).toBeCloseTo(result.afterM2 - result.beforeM2, 5);
    expect(result.newlyAddedAreaM2).toBeLessThan(incomingAreaM2);
    expect(overlapM2).toBeGreaterThan(0);
    expect(overlapM2).toBeLessThan(incomingAreaM2);
    expect(result.afterM2).toBeCloseTo(result.beforeM2 + incomingAreaM2 - overlapM2, 2);
  });

  it("ayrık bölgeleri yapay olarak doldurmadan MultiPolygon olarak saklar", () => {
    const first = rectangle(29, 41, 29.005, 41.005);
    const second = rectangle(29.02, 41.02, 29.025, 41.025);

    const merged = engine.mergeTerritory(first, second);

    expect(merged.type).toBe("MultiPolygon");
    if (merged.type === "MultiPolygon") expect(merged.coordinates).toHaveLength(2);
    expect(area(feature(merged))).toBeCloseTo(area(feature(first)) + area(feature(second)), 2);
  });

  it("rakip alanından geçen claimi difference ile sahiplikten çıkarır", () => {
    const enemy = rectangle(29, 41, 29.02, 41.01);
    const capture = rectangle(29.008, 40.999, 29.012, 41.011);
    const beforeM2 = area(feature(enemy));

    const remaining = engine.applyEnemyCapture(enemy, capture);

    expect(remaining).not.toBeNull();
    expect(remaining?.type).toBe("MultiPolygon");
    expect(area(feature(remaining!))).toBeLessThan(beforeM2);
  });

  it("geçersiz, kendi kendini kesen ve çok küçük polygonları reddeder", () => {
    const bowTie: Polygon = {
      type: "Polygon",
      coordinates: [[[29, 41], [29.01, 41.01], [29, 41.01], [29.01, 41], [29, 41]]],
    };
    const tiny = rectangle(29, 41, 29.000001, 41.000001);

    expect(engine.validateClaim(bowTie, 1).valid).toBe(false);
    expect(engine.validateClaim(tiny, 100).valid).toBe(false);
    expect(engine.validateClaim(rectangle(29, 41, 29.01, 41.01), 100).valid).toBe(true);
  });
});
