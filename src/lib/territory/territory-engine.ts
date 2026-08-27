import type { Feature, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import booleanIntersects from "@turf/boolean-intersects";
import booleanValid from "@turf/boolean-valid";
import difference from "@turf/difference";
import { feature, featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import kinks from "@turf/kinks";
import union from "@turf/union";

export type TerritoryGeometry = Polygon | MultiPolygon;

export type GeometryValidation =
  | { valid: true; feature: Feature<Polygon>; areaM2: number }
  | { valid: false; reason: "INVALID_GEOMETRY" | "SELF_INTERSECTION" | "TOO_SMALL" };

export class TerritoryEngine {
  validateClaim(polygon: Polygon, minimumAreaM2: number): GeometryValidation {
    const incoming = feature(polygon);
    if (!booleanValid(incoming)) return { valid: false, reason: "INVALID_GEOMETRY" };
    if (kinks(incoming).features.length > 0) return { valid: false, reason: "SELF_INTERSECTION" };
    const areaM2 = area(incoming);
    if (!Number.isFinite(areaM2) || areaM2 < minimumAreaM2) return { valid: false, reason: "TOO_SMALL" };
    return { valid: true, feature: incoming, areaM2 };
  }

  mergeTerritory(existing: TerritoryGeometry | null, incoming: Polygon): TerritoryGeometry {
    if (!existing) return incoming;
    const merged = union(featureCollection([feature(existing), feature(incoming)]));
    if (!merged || (merged.geometry.type !== "Polygon" && merged.geometry.type !== "MultiPolygon")) throw new Error("Sahiplik alanları birleştirilemedi.");
    return merged.geometry;
  }

  calculateUniqueArea(existing: TerritoryGeometry | null, incoming: Polygon) {
    const beforeM2 = existing ? area(feature(existing)) : 0;
    const merged = this.mergeTerritory(existing, incoming);
    const afterM2 = area(feature(merged));
    return { geometry: merged, beforeM2, afterM2, newlyAddedAreaM2: Math.max(0, afterM2 - beforeM2) };
  }

  calculateOverlap(existing: TerritoryGeometry | null, incoming: Polygon) {
    if (!existing || !booleanIntersects(feature(existing), feature(incoming))) return 0;
    const overlap = intersect(featureCollection([feature(existing), feature(incoming)]));
    return overlap ? area(overlap) : 0;
  }

  applyEnemyCapture(enemy: TerritoryGeometry, incoming: Polygon): TerritoryGeometry | null {
    if (!booleanIntersects(feature(enemy), feature(incoming))) return enemy;
    const remaining = difference(featureCollection([feature(enemy), feature(incoming)]));
    if (!remaining) return null;
    if (remaining.geometry.type !== "Polygon" && remaining.geometry.type !== "MultiPolygon") throw new Error("Sahiplik alanı farkı hesaplanamadı.");
    return remaining.geometry;
  }

  subtractPaint(existing: TerritoryGeometry, incoming: Polygon): TerritoryGeometry | null {
    return this.applyEnemyCapture(existing, incoming);
  }
}

export const territoryEngine = new TerritoryEngine();
