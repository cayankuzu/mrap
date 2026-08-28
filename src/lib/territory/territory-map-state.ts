import area from "@turf/area";
import { feature } from "@turf/helpers";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import type { AppUser, CurrentTerritory, TerritoryMapState, TerritoryPaint } from "@/lib/models";
import { territoryEngine, type TerritoryGeometry } from "@/lib/territory/territory-engine";

type TerritoryOwner = Pick<AppUser, "id" | "username" | "color" | "pattern">;

export type LocalTerritoryClaim = {
  mapState: TerritoryMapState;
  newlyAddedAreaM2: number;
  overlapAreaM2: number;
  totalAreaM2: number;
};

export function territoryMapCollections(state: TerritoryMapState) {
  const ownership: Feature<Polygon | MultiPolygon>[] = [];
  const boundaries: Feature<LineString>[] = [];
  const paints: Feature<Polygon | MultiPolygon>[] = [];
  for (const territory of state.territories) {
    ownership.push({
      type: "Feature",
      properties: {
        color: territory.color,
        username: territory.ownerUsername,
        userId: territory.userId,
        pattern: territory.pattern,
        areaM2: territory.areaM2,
      },
      geometry: territory.geometry,
    });
    const polygons = territory.geometry.type === "Polygon" ? [territory.geometry.coordinates] : territory.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        boundaries.push({
          type: "Feature",
          properties: { color: territory.color, username: territory.ownerUsername },
          geometry: { type: "LineString", coordinates: ring },
        });
      }
    }
  }
  for (const paint of state.paints) {
    paints.push({ type: "Feature", properties: { color: paint.color, userId: paint.userId }, geometry: paint.geometry });
  }
  return {
    ownership: { type: "FeatureCollection", features: ownership } as FeatureCollection<Polygon | MultiPolygon>,
    boundaries: { type: "FeatureCollection", features: boundaries } as FeatureCollection<LineString>,
    paints: { type: "FeatureCollection", features: paints } as FeatureCollection<Polygon | MultiPolygon>,
  };
}

function geometryArea(geometry: TerritoryGeometry) {
  return area(feature(geometry));
}

function consolidateTerritories(territories: readonly CurrentTerritory[]) {
  const byOwner = new Map<string, CurrentTerritory>();
  for (const territory of territories) {
    const existing = byOwner.get(territory.userId);
    if (!existing) {
      byOwner.set(territory.userId, { ...territory });
      continue;
    }
    const geometry = territoryEngine.mergeTerritory(existing.geometry, territory.geometry);
    const latest = territory.updatedAt >= existing.updatedAt ? territory : existing;
    byOwner.set(territory.userId, { ...latest, geometry, areaM2: geometryArea(geometry) });
  }
  return [...byOwner.values()];
}

function paintKey(paint: Pick<TerritoryPaint, "userId" | "color">) {
  return `${paint.userId}\u0000${paint.color.toUpperCase()}`;
}

function consolidatePaints(paints: readonly TerritoryPaint[]) {
  const byOwnerAndColor = new Map<string, TerritoryPaint>();
  for (const paint of paints) {
    const key = paintKey(paint);
    const existing = byOwnerAndColor.get(key);
    if (!existing) {
      byOwnerAndColor.set(key, { ...paint });
      continue;
    }
    const geometry = territoryEngine.mergeTerritory(existing.geometry, paint.geometry);
    const latest = paint.updatedAt >= existing.updatedAt ? paint : existing;
    byOwnerAndColor.set(key, { ...latest, geometry });
  }
  return [...byOwnerAndColor.values()];
}

/**
 * Applies a complete authoritative region patch without discarding geometry
 * that belongs to other regions already visible on the map.
 */
export function mergeTerritoryMapPatch(current: TerritoryMapState, patch: TerritoryMapState): TerritoryMapState {
  let territories = consolidateTerritories(current.territories);
  for (const incoming of consolidateTerritories(patch.territories)) {
    let sameOwner: CurrentTerritory | null = null;
    const next: CurrentTerritory[] = [];
    for (const existing of territories) {
      if (existing.userId === incoming.userId) {
        sameOwner = existing;
        continue;
      }
      const remaining = territoryEngine.applyEnemyCapture(existing.geometry, incoming.geometry);
      if (remaining) next.push({ ...existing, geometry: remaining, areaM2: geometryArea(remaining) });
    }
    const geometry = territoryEngine.mergeTerritory(sameOwner?.geometry ?? null, incoming.geometry);
    next.push({ ...incoming, geometry, areaM2: geometryArea(geometry) });
    territories = next;
  }

  const patchOwnership = consolidateTerritories(patch.territories).map((territory) => territory.geometry);
  let paints = consolidatePaints(current.paints).flatMap((paint) => {
    let geometry: TerritoryGeometry | null = paint.geometry;
    for (const ownedGeometry of patchOwnership) {
      if (!geometry) break;
      geometry = territoryEngine.subtractPaint(geometry, ownedGeometry);
    }
    return geometry ? [{ ...paint, geometry }] : [];
  });
  paints = consolidatePaints([...paints, ...patch.paints]);

  return { territories: consolidateTerritories(territories), paints };
}

/** Local/demo equivalent of the server-authoritative claim transaction. */
export function applyLocalTerritoryClaim(
  current: TerritoryMapState,
  owner: TerritoryOwner,
  incoming: Polygon,
  color: string,
  updatedAt = new Date().toISOString(),
): LocalTerritoryClaim {
  const normalizedTerritories = consolidateTerritories(current.territories);
  const own = normalizedTerritories.find((territory) => territory.userId === owner.id) ?? null;
  const ownership = territoryEngine.calculateUniqueArea(own?.geometry ?? null, incoming);
  const overlapAreaM2 = territoryEngine.calculateOverlap(own?.geometry ?? null, incoming);
  const territories: CurrentTerritory[] = [];

  for (const territory of normalizedTerritories) {
    if (territory.userId === owner.id) continue;
    const remaining = territoryEngine.applyEnemyCapture(territory.geometry, incoming);
    if (remaining) territories.push({ ...territory, geometry: remaining, areaM2: geometryArea(remaining), updatedAt });
  }
  territories.push({
    userId: owner.id,
    ownerUsername: owner.username,
    geometry: ownership.geometry,
    areaM2: ownership.afterM2,
    color: owner.color,
    pattern: owner.pattern,
    updatedAt,
  });

  const paints = current.paints.flatMap((paint) => {
    const remaining = territoryEngine.subtractPaint(paint.geometry, incoming);
    return remaining ? [{ ...paint, geometry: remaining }] : [];
  });
  paints.push({
    id: `demo-paint-${owner.id}-${color.slice(1).toLowerCase()}`,
    userId: owner.id,
    geometry: incoming,
    color,
    updatedAt,
  });

  return {
    mapState: { territories: consolidateTerritories(territories), paints: consolidatePaints(paints) },
    newlyAddedAreaM2: ownership.newlyAddedAreaM2,
    overlapAreaM2,
    totalAreaM2: ownership.afterM2,
  };
}
