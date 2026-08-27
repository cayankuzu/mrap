import type { Polygon } from "geojson";
import area from "@turf/area";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon as turfPolygon } from "@turf/helpers";

const MAX_MERCATOR_LATITUDE = 85.05112878;

export interface SpatialOwnershipGrid {
  polygonToCells(polygon: Polygon): Promise<string[]>;
  cellToGeometry(cellId: string): Polygon;
  getRegionId(cellId: string): string;
  calculateCellAreaM2(cellId: string): number;
}

export type TileOwnershipGridOptions = {
  cellZoom: number;
  regionZoom: number;
  maximumCandidateCells: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function longitudeToTileX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudeToTileY(latitude: number, zoom: number) {
  const bounded = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const radians = bounded * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function tileXToLongitude(x: number, zoom: number) {
  return x / 2 ** zoom * 360 - 180;
}

function tileYToLatitude(y: number, zoom: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zoom))) * 180 / Math.PI;
}

function parseCellId(cellId: string) {
  if (!/^(?:[1-9]|1\d|2[0-6])\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)$/.test(cellId)) {
    throw new Error("Geçersiz kanonik hücre kimliği.");
  }
  const parts = cellId.split("/").map(Number);
  const [zoom, x, y] = parts;
  const size = 2 ** zoom;
  if (x >= size || y >= size) throw new Error("Kanonik hücre sınır dışında.");
  return { zoom, x, y };
}

function validatePolygonCoordinates(input: Polygon) {
  if (input.type !== "Polygon" || input.coordinates.length !== 1) {
    throw new Error("Kanonik ızgara yalnızca tek halkalı çokgen kabul eder.");
  }
  const ring = input.coordinates[0];
  if (ring.length < 4) throw new Error("Çokgen halkası en az dört koordinat içermelidir.");
  for (const coordinate of ring) {
    const [longitude, latitude] = coordinate;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error("Çokgen koordinatları geçersiz.");
    if (longitude < -180 || longitude > 180) throw new Error("Çokgen boylam sınırı desteklenmiyor.");
    if (latitude < -MAX_MERCATOR_LATITUDE || latitude > MAX_MERCATOR_LATITUDE) {
      throw new Error("Çokgen enlemi Web Mercator izdüşümü sınırını aşıyor.");
    }
  }
  const first = ring[0];
  const last = ring.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) throw new Error("Çokgen halkası kapalı olmalıdır.");
}

export class TileOwnershipGrid implements SpatialOwnershipGrid {
  readonly cellZoom: number;
  readonly regionZoom: number;
  readonly maximumCandidateCells: number;

  constructor(options: TileOwnershipGridOptions) {
    if (!Number.isSafeInteger(options.cellZoom) || options.cellZoom < 1 || options.cellZoom > 26) throw new Error("Hücre yakınlaştırma düzeyi geçersiz.");
    if (!Number.isSafeInteger(options.regionZoom) || options.regionZoom < 1 || options.regionZoom > options.cellZoom) throw new Error("Bölge yakınlaştırma düzeyi geçersiz.");
    if (!Number.isSafeInteger(options.maximumCandidateCells) || options.maximumCandidateCells < 1) throw new Error("Hücre işlem sınırı geçersiz.");
    this.cellZoom = options.cellZoom;
    this.regionZoom = options.regionZoom;
    this.maximumCandidateCells = options.maximumCandidateCells;
  }

  async polygonToCells(input: Polygon) {
    validatePolygonCoordinates(input);
    const bounds = bbox(input);
    if (bounds.some((value) => !Number.isFinite(value)) || bounds[2] - bounds[0] > 180) throw new Error("Tarih değiştirme meridyenini geçen alan desteklenmiyor.");
    const size = 2 ** this.cellZoom;
    const minimumX = clamp(Math.floor(longitudeToTileX(bounds[0], this.cellZoom)), 0, size - 1);
    const maximumX = clamp(Math.floor(longitudeToTileX(bounds[2], this.cellZoom)), 0, size - 1);
    const minimumY = clamp(Math.floor(latitudeToTileY(bounds[3], this.cellZoom)), 0, size - 1);
    const maximumY = clamp(Math.floor(latitudeToTileY(bounds[1], this.cellZoom)), 0, size - 1);
    const candidateCount = (maximumX - minimumX + 1) * (maximumY - minimumY + 1);
    if (candidateCount > this.maximumCandidateCells) throw new Error("Alan kanonik hücre işlem sınırını aşıyor.");

    const cells: string[] = [];
    for (let x = minimumX; x <= maximumX; x += 1) {
      for (let y = minimumY; y <= maximumY; y += 1) {
        const center = [tileXToLongitude(x + 0.5, this.cellZoom), tileYToLatitude(y + 0.5, this.cellZoom)];
        if (booleanPointInPolygon(point(center), input, { ignoreBoundary: false })) cells.push(`${this.cellZoom}/${x}/${y}`);
      }
    }
    return cells.sort();
  }

  cellToGeometry(cellId: string): Polygon {
    const { zoom, x, y } = parseCellId(cellId);
    const west = tileXToLongitude(x, zoom);
    const east = tileXToLongitude(x + 1, zoom);
    const north = tileYToLatitude(y, zoom);
    const south = tileYToLatitude(y + 1, zoom);
    return turfPolygon([[[west, north], [east, north], [east, south], [west, south], [west, north]]]).geometry;
  }

  getRegionId(cellId: string) {
    const { zoom, x, y } = parseCellId(cellId);
    if (zoom < this.regionZoom) throw new Error("Hücre yakınlaştırma düzeyi bölge yakınlaştırma düzeyinden küçük olamaz.");
    const factor = 2 ** (zoom - this.regionZoom);
    return `${this.regionZoom}/${Math.floor(x / factor)}/${Math.floor(y / factor)}`;
  }

  calculateCellAreaM2(cellId: string) {
    return area(this.cellToGeometry(cellId));
  }
}

export function viewportToRegionIds(bounds: [number, number, number, number], regionZoom: number, maximumRegions = 64) {
  const [west, south, east, north] = bounds;
  if (
    !Number.isSafeInteger(regionZoom)
    || regionZoom < 1
    || regionZoom > 26
    || !Number.isSafeInteger(maximumRegions)
    || maximumRegions < 1
    || ![west, south, east, north].every(Number.isFinite)
    || west < -180
    || east > 180
    || south < -MAX_MERCATOR_LATITUDE
    || north > MAX_MERCATOR_LATITUDE
    || west > east
    || south > north
    || east - west > 180
  ) return [];
  const size = 2 ** regionZoom;
  const minimumX = clamp(Math.floor(longitudeToTileX(west, regionZoom)), 0, size - 1);
  const maximumX = clamp(Math.floor(longitudeToTileX(east, regionZoom)), 0, size - 1);
  const minimumY = clamp(Math.floor(latitudeToTileY(north, regionZoom)), 0, size - 1);
  const maximumY = clamp(Math.floor(latitudeToTileY(south, regionZoom)), 0, size - 1);
  const result: string[] = [];
  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      if (result.length >= maximumRegions) return result.sort();
      result.push(`${regionZoom}/${x}/${y}`);
    }
  }
  return result.sort();
}
