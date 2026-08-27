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

describe("TerritoryEngine boundary sözleşmeleri", () => {
  const engine = new TerritoryEngine();

  it("kapanmamış GeoJSON halkasını INVALID_GEOMETRY olarak reddeder", () => {
    const unclosed: Polygon = {
      type: "Polygon",
      coordinates: [[[29, 41], [29.01, 41], [29.01, 41.01], [29, 41.01]]],
    };

    expect(engine.validateClaim(unclosed, 1)).toEqual({ valid: false, reason: "INVALID_GEOMETRY" });
  });

  it("ilk claimde geometry'yi değiştirmeden döndürür ve before alanını sıfır kabul eder", () => {
    const incoming = rectangle(29, 41, 29.01, 41.01);

    expect(engine.mergeTerritory(null, incoming)).toBe(incoming);
    const result = engine.calculateUniqueArea(null, incoming);
    expect(result.geometry).toBe(incoming);
    expect(result.beforeM2).toBe(0);
    expect(result.newlyAddedAreaM2).toBe(result.afterM2);
  });

  it("existing olmadığında ve tamamen ayrık geometry'de overlapı sıfır hesaplar", () => {
    const first = rectangle(29, 41, 29.01, 41.01);
    const far = rectangle(30, 42, 30.01, 42.01);

    expect(engine.calculateOverlap(null, first)).toBe(0);
    expect(engine.calculateOverlap(first, far)).toBe(0);
  });

  it("yalnız ortak sınıra temas eden polygonlarda alan overlapı üretmez", () => {
    const left = rectangle(29, 41, 29.01, 41.01);
    const right = rectangle(29.01, 41, 29.02, 41.01);

    expect(engine.calculateOverlap(left, right)).toBe(0);
  });

  it("ayrık claimde rakip geometry'yi korur, tam kapsamada tamamen kaldırır", () => {
    const enemy = rectangle(29, 41, 29.01, 41.01);
    const far = rectangle(30, 42, 30.01, 42.01);
    const covering = rectangle(28.99, 40.99, 29.02, 41.02);

    expect(engine.applyEnemyCapture(enemy, far)).toBe(enemy);
    expect(engine.applyEnemyCapture(enemy, covering)).toBeNull();
    expect(engine.subtractPaint(enemy, far)).toBe(enemy);
  });
});
