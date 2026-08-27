import type { Feature, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import booleanValid from "@turf/boolean-valid";
import distance from "@turf/distance";
import { lineString, point, polygon } from "@turf/helpers";
import kinks from "@turf/kinks";
import length from "@turf/length";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import type { GameConfig } from "@/lib/game/config";
import type { Coordinate, LocationMode, LoopDiagnostic, LoopInvalidReason, LoopSource, PotentialLoop } from "@/lib/game/types";

type Candidate = {
  source: LoopSource;
  startIndex: number;
  endIndex: number;
  polygonCoordinates: Coordinate[];
  routeCoordinates: Coordinate[];
  contactDistanceM: number;
};

type RingContact = { coordinate: Coordinate; segmentIndex: number; distanceM: number };

export class LoopDetector {
  private handledUntilIndex = -1;
  private lastHandledAt = 0;

  constructor(private readonly config: GameConfig["loop"]) {}

  detect(route: Coordinate[], mode: LocationMode, ownTerritory?: Polygon | MultiPolygon | null, now = Date.now()) {
    const endIndex = route.length - 1;
    if (endIndex < this.config.minimumIndexGap || endIndex <= this.handledUntilIndex) return { loop: null, diagnostic: null };
    if (now - this.lastHandledAt < this.config.detectionCooldownMs) return { loop: null, diagnostic: null };

    const thresholdM = mode === "real" ? this.config.realProximityM : this.config.simulatedProximityM;
    const candidates = [
      ...this.activeRouteCandidates(route, thresholdM),
      ...this.territoryCandidates(route, ownTerritory, thresholdM),
    ].sort((a, b) => a.contactDistanceM - b.contactDistanceM || b.startIndex - a.startIndex);

    let diagnostic: LoopDiagnostic | null = null;
    for (const candidate of candidates) {
      const result = this.validateCandidate(candidate, now);
      if ("polygon" in result) return { loop: result, diagnostic: null };
      diagnostic ??= result;
    }
    return { loop: null, diagnostic };
  }

  markHandled(loop: PotentialLoop, now = Date.now()) {
    this.handledUntilIndex = loop.endIndex + this.config.minimumIndexGap;
    this.lastHandledAt = now;
  }

  reset() {
    this.handledUntilIndex = -1;
    this.lastHandledAt = 0;
  }

  private activeRouteCandidates(route: Coordinate[], thresholdM: number): Candidate[] {
    const endIndex = route.length - 1;
    const previous = route[endIndex - 1];
    const current = route[endIndex];
    const newestSegment = lineString([previous, current]);
    const maximumOldSegment = endIndex - this.config.minimumIndexGap;
    const candidates: Candidate[] = [];

    for (let index = 0; index <= maximumOldSegment; index += 1) {
      const oldSegment = lineString([route[index], route[index + 1]]);
      const exact = lineIntersect(newestSegment, oldSegment).features[0];
      let contact = exact?.geometry.coordinates as Coordinate | undefined;
      let contactDistanceM = 0;
      if (!contact) {
        const nearest = nearestPointOnLine(oldSegment, point(current), { units: "meters" });
        contactDistanceM = Number(nearest.properties.dist ?? Infinity);
        if (contactDistanceM > thresholdM) continue;
        contact = nearest.geometry.coordinates as Coordinate;
      }
      const routeCoordinates = dedupeSequential([contact, ...route.slice(index + 1, endIndex + 1)]);
      const polygonCoordinates = closeRing(routeCoordinates);
      candidates.push({ source: "ACTIVE_ROUTE", startIndex: index, endIndex, polygonCoordinates, routeCoordinates, contactDistanceM });
    }
    return candidates;
  }

  private territoryCandidates(route: Coordinate[], territory: Polygon | MultiPolygon | null | undefined, thresholdM: number): Candidate[] {
    if (!territory) return [];
    const endIndex = route.length - 1;
    const rings = territory.type === "Polygon" ? [territory.coordinates[0] as Coordinate[]] : territory.coordinates.map((part) => part[0] as Coordinate[]);
    const candidates: Candidate[] = [];

    rings.forEach((ring) => {
      const endContact = closestRingContact(ring, route[endIndex]);
      if (!endContact || endContact.distanceM > thresholdM) return;
      for (let index = endIndex - this.config.minimumIndexGap; index >= 0; index -= 1) {
        const startContact = closestRingContact(ring, route[index]);
        if (!startContact || startContact.distanceM > thresholdM) continue;
        const tracked = dedupeSequential([startContact.coordinate, ...route.slice(index + 1, endIndex), endContact.coordinate]);
        const boundary = shortestBoundaryPath(ring, endContact, startContact);
        const polygonCoordinates = [...tracked, ...boundary.slice(1)];
        candidates.push({ source: "OWN_TERRITORY", startIndex: index, endIndex, polygonCoordinates, routeCoordinates: tracked, contactDistanceM: endContact.distanceM + startContact.distanceM });
        break;
      }
    });
    return candidates;
  }

  private validateCandidate(candidate: Candidate, now: number): PotentialLoop | LoopDiagnostic {
    const invalid = (reason: LoopInvalidReason): LoopDiagnostic => ({ source: candidate.source, startIndex: candidate.startIndex, endIndex: candidate.endIndex, validity: false, reason, detectedAt: new Date(now).toISOString() });
    const uniquePoints = new Set(candidate.polygonCoordinates.slice(0, -1).map((value) => `${value[0].toFixed(7)},${value[1].toFixed(7)}`));
    if (uniquePoints.size < 3 || candidate.polygonCoordinates.length < 4) return invalid("TOO_FEW_POINTS");
    const routeLengthM = length(lineString(candidate.routeCoordinates), { units: "kilometers" }) * 1000;
    if (routeLengthM < this.config.minimumRouteLengthM) return invalid("TOO_SHORT");
    let shape: Feature<Polygon>;
    try { shape = polygon([candidate.polygonCoordinates]); } catch { return invalid("INVALID_POLYGON"); }
    if (!booleanValid(shape)) return invalid("INVALID_POLYGON");
    if (kinks(shape).features.length > 0) return invalid("SELF_INTERSECTION");
    const estimatedAreaM2 = area(shape);
    if (estimatedAreaM2 < this.config.minimumAreaM2) return invalid("TOO_SMALL");
    const signature = `${candidate.source}:${candidate.startIndex}:${candidate.endIndex}:${candidate.polygonCoordinates[0].map((value) => value.toFixed(6)).join(",")}`;
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `${now}-${candidate.startIndex}-${candidate.endIndex}`,
      signature,
      source: candidate.source,
      startIndex: candidate.startIndex,
      endIndex: candidate.endIndex,
      coordinates: candidate.polygonCoordinates,
      routeCoordinates: candidate.routeCoordinates,
      polygon: shape.geometry,
      estimatedAreaM2,
      routeLengthM,
      validity: true,
      detectedAt: new Date(now).toISOString(),
    };
  }
}

function closestRingContact(ring: Coordinate[], target: Coordinate): RingContact | null {
  const open = isSameCoordinate(ring[0], ring.at(-1)!) ? ring.slice(0, -1) : ring;
  let best: RingContact | null = null;
  for (let index = 0; index < open.length; index += 1) {
    const segment = lineString([open[index], open[(index + 1) % open.length]]);
    const nearest = nearestPointOnLine(segment, point(target), { units: "meters" });
    const distanceM = Number(nearest.properties.dist ?? distance(point(target), nearest, { units: "meters" }));
    if (!best || distanceM < best.distanceM) best = { coordinate: nearest.geometry.coordinates as Coordinate, segmentIndex: index, distanceM };
  }
  return best;
}

function shortestBoundaryPath(ring: Coordinate[], from: RingContact, to: RingContact) {
  const open = isSameCoordinate(ring[0], ring.at(-1)!) ? ring.slice(0, -1) : ring;
  const forward = walkBoundaryForward(open, from, to);
  const backward = walkBoundaryForward(open, to, from).reverse();
  return length(lineString(forward), { units: "meters" }) <= length(lineString(backward), { units: "meters" }) ? forward : backward;
}

function walkBoundaryForward(ring: Coordinate[], from: RingContact, to: RingContact) {
  const result: Coordinate[] = [from.coordinate];
  let index = (from.segmentIndex + 1) % ring.length;
  const stop = (to.segmentIndex + 1) % ring.length;
  while (index !== stop) {
    result.push(ring[index]);
    index = (index + 1) % ring.length;
  }
  result.push(to.coordinate);
  return result;
}

function isSameCoordinate(a: Coordinate, b: Coordinate) {
  return a[0] === b[0] && a[1] === b[1];
}

function closeRing(coordinates: Coordinate[]) {
  return isSameCoordinate(coordinates[0], coordinates.at(-1)!) ? coordinates : [...coordinates, coordinates[0]];
}

function dedupeSequential(coordinates: Coordinate[]) {
  return coordinates.filter((coordinate, index) => index === 0 || !isSameCoordinate(coordinate, coordinates[index - 1]));
}
