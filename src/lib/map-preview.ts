import type { MultiPolygon, Polygon } from "geojson";

export type MapCameraState = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

export type PreviewTerritory = {
  name: string;
  district: string;
  color: string;
  variant?: number;
  geojson?: Polygon | MultiPolygon;
  ownerUsername?: string;
};

export const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const configuredMapLoadTimeoutMs = Number(process.env.NEXT_PUBLIC_MRAP_MAP_LOAD_TIMEOUT_MS);
export const MAP_LOAD_TIMEOUT_MS = Number.isFinite(configuredMapLoadTimeoutMs) && configuredMapLoadTimeoutMs >= 5_000 && configuredMapLoadTimeoutMs <= 60_000
  ? configuredMapLoadTimeoutMs
  : 12_000;

const DEMO_CENTERS: Array<{ match: string; center: [number, number] }> = [
  { match: "ankara", center: [32.8597, 39.9334] },
  { match: "izmir", center: [27.1428, 38.4237] },
  { match: "istanbul", center: [29.027, 40.987] },
];

const DEMO_SHAPES: Record<number, Array<[number, number]>> = {
  1: [[-0.006, 0.001], [-0.003, 0.005], [0.002, 0.006], [0.006, 0.002], [0.004, -0.004], [-0.002, -0.005]],
  2: [[-0.006, 0], [-0.004, 0.005], [0.001, 0.006], [0.006, 0.003], [0.005, -0.003], [0, -0.006], [-0.005, -0.004]],
  3: [[-0.005, 0.002], [-0.001, 0.006], [0.004, 0.004], [0.006, -0.001], [0.002, -0.005], [-0.004, -0.004]],
  4: [[-0.007, 0.001], [-0.004, 0.006], [0.001, 0.005], [0.004, 0.007], [0.007, 0.002], [0.005, -0.005], [-0.002, -0.006], [-0.006, -0.003]],
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeMapCamera(value: unknown): MapCameraState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MapCameraState>;
  if (!Array.isArray(candidate.center) || candidate.center.length !== 2 || !candidate.center.every(finiteNumber)) return null;
  const zoom = candidate.zoom;
  const bearing = candidate.bearing;
  const pitch = candidate.pitch;
  if (!finiteNumber(zoom) || !finiteNumber(bearing) || !finiteNumber(pitch)) return null;
  const [longitude, latitude] = candidate.center;
  if (longitude < -180 || longitude > 180 || latitude < -85 || latitude > 85) return null;
  if (zoom < 1 || zoom > 22 || bearing < -180 || bearing > 180 || pitch < 0 || pitch > 60) return null;
  return {
    center: [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))],
    zoom: Number(zoom.toFixed(2)),
    bearing: Number(bearing.toFixed(2)),
    pitch: Number(pitch.toFixed(2)),
  };
}

export function createDemoGeometry(territory: PreviewTerritory): Polygon {
  const district = territory.district.toLocaleLowerCase("tr-TR");
  const center = DEMO_CENTERS.find((item) => district.includes(item.match))?.center ?? DEMO_CENTERS[2].center;
  const offsets = DEMO_SHAPES[territory.variant ?? 1] ?? DEMO_SHAPES[1];
  const ring = offsets.map(([longitude, latitude]) => [center[0] + longitude, center[1] + latitude] as [number, number]);
  ring.push([...ring[0]] as [number, number]);
  return { type: "Polygon", coordinates: [ring] };
}
