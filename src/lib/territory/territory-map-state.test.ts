import area from "@turf/area";
import { feature } from "@turf/helpers";
import type { Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import type { CurrentTerritory, TerritoryMapState, TerritoryPaint } from "@/lib/models";
import { applyLocalTerritoryClaim, mergeTerritoryMapPatch, territoryMapCollections } from "@/lib/territory/territory-map-state";

function rectangle(west: number, south: number, east: number, north: number): Polygon {
  return { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

const owner = { id: "user-1", username: "cayan", color: "#1488FF", pattern: 0 };

function territory(userId: string, geometry: Polygon, color = "#1488FF"): CurrentTerritory {
  return { userId, ownerUsername: userId, geometry, areaM2: area(feature(geometry)), color, pattern: 0, updatedAt: "2026-08-28T12:00:00.000Z" };
}

function paint(id: string, userId: string, geometry: Polygon, color: string): TerritoryPaint {
  return { id, userId, geometry, color, updatedAt: "2026-08-28T12:00:00.000Z" };
}

describe("territory map state reducer", () => {
  it("aynı oturumdaki iki ayrık claimi MultiPolygon ve iki dolu paint parçası olarak korur", () => {
    const first = rectangle(29, 41, 29.001, 41.001);
    const second = rectangle(29.003, 41, 29.004, 41.001);

    const afterFirst = applyLocalTerritoryClaim({ territories: [], paints: [] }, owner, first, "#1488FF", "2026-08-28T12:00:00.000Z");
    const afterSecond = applyLocalTerritoryClaim(afterFirst.mapState, owner, second, "#1488FF", "2026-08-28T12:01:00.000Z");

    expect(afterSecond.mapState.territories).toHaveLength(1);
    expect(afterSecond.mapState.territories[0].geometry.type).toBe("MultiPolygon");
    expect(afterSecond.mapState.paints).toHaveLength(1);
    expect(afterSecond.mapState.paints[0].geometry.type).toBe("MultiPolygon");
    expect(area(feature(afterSecond.mapState.paints[0].geometry))).toBeCloseTo(area(feature(first)) + area(feature(second)), 2);
    expect(afterSecond.newlyAddedAreaM2).toBeCloseTo(area(feature(second)), 2);

    const rendered = territoryMapCollections(afterSecond.mapState);
    expect(rendered.ownership.features).toHaveLength(1);
    expect(rendered.ownership.features[0].geometry.type).toBe("MultiPolygon");
    expect(rendered.boundaries.features).toHaveLength(2);
    expect(rendered.paints.features).toHaveLength(1);
    expect(rendered.paints.features[0].geometry.type).toBe("MultiPolygon");
  });

  it("yeniden boyamada son rengi kullanır ve benzersiz sahiplik alanını artırmaz", () => {
    const claim = rectangle(29, 41, 29.001, 41.001);
    const first = applyLocalTerritoryClaim({ territories: [], paints: [] }, owner, claim, "#1488FF");
    const repaint = applyLocalTerritoryClaim(first.mapState, owner, claim, "#FF5C7A");

    expect(repaint.newlyAddedAreaM2).toBeCloseTo(0, 5);
    expect(repaint.mapState.territories[0].color).toBe(owner.color);
    expect(repaint.mapState.paints).toHaveLength(1);
    expect(repaint.mapState.paints[0].color).toBe("#FF5C7A");
  });

  it("seçili claim rengini yalnız boya katmanına uygular", () => {
    const claim = rectangle(29, 41, 29.001, 41.001);
    const result = applyLocalTerritoryClaim({ territories: [], paints: [] }, owner, claim, "#FFB82E");

    expect(result.mapState.territories[0].color).toBe(owner.color);
    expect(result.mapState.paints[0].color).toBe("#FFB82E");
  });

  it("dar kapsamlı sunucu patchini mevcut diğer bölgeyi silmeden birleştirir", () => {
    const firstRegion = rectangle(29, 41, 29.001, 41.001);
    const secondRegion = rectangle(29.02, 41.02, 29.021, 41.021);
    const current: TerritoryMapState = {
      territories: [territory(owner.id, firstRegion)],
      paints: [paint("first", owner.id, firstRegion, "#1488FF")],
    };
    const patch: TerritoryMapState = {
      territories: [territory(owner.id, secondRegion, "#FF5C7A")],
      paints: [paint("second", owner.id, secondRegion, "#FF5C7A")],
    };

    const merged = mergeTerritoryMapPatch(current, patch);

    expect(merged.territories).toHaveLength(1);
    expect(merged.territories[0].geometry.type).toBe("MultiPolygon");
    expect(merged.paints).toHaveLength(2);
    expect(new Set(merged.paints.map((entry) => entry.color))).toEqual(new Set(["#1488FF", "#FF5C7A"]));
  });

  it("aynı renkteki ikinci region patchini tek MultiPolygon paint kaynağında doldurur", () => {
    const firstRegion = rectangle(29, 41, 29.001, 41.001);
    const secondRegion = rectangle(29.02, 41.02, 29.021, 41.021);
    const current: TerritoryMapState = {
      territories: [territory(owner.id, firstRegion)],
      paints: [paint("first", owner.id, firstRegion, "#1488FF")],
    };
    const patch: TerritoryMapState = {
      territories: [territory(owner.id, secondRegion)],
      paints: [paint("second", owner.id, secondRegion, "#1488FF")],
    };

    const merged = mergeTerritoryMapPatch(current, patch);

    expect(merged.paints).toHaveLength(1);
    expect(merged.paints[0].geometry.type).toBe("MultiPolygon");
    expect(area(feature(merged.paints[0].geometry))).toBeCloseTo(area(feature(firstRegion)) + area(feature(secondRegion)), 2);
  });

  it("patchteki yeni sahipliği eski sahibin geometry ve paint alanından çıkarır", () => {
    const whole = rectangle(29, 41, 29.004, 41.002);
    const capture = rectangle(29.002, 41, 29.004, 41.002);
    const current: TerritoryMapState = {
      territories: [territory("enemy", whole, "#FF9F1C")],
      paints: [paint("enemy-paint", "enemy", whole, "#FF9F1C")],
    };
    const patch: TerritoryMapState = {
      territories: [territory(owner.id, capture)],
      paints: [paint("capture", owner.id, capture, "#1488FF")],
    };

    const merged = mergeTerritoryMapPatch(current, patch);
    const enemy = merged.territories.find((entry) => entry.userId === "enemy");
    const enemyPaint = merged.paints.find((entry) => entry.userId === "enemy");

    expect(enemy).toBeDefined();
    expect(enemyPaint).toBeDefined();
    expect(area(feature(enemy!.geometry))).toBeLessThan(area(feature(whole)));
    expect(area(feature(enemyPaint!.geometry))).toBeCloseTo(area(feature(enemy!.geometry)), 2);
  });
});
