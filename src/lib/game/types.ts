import type { Polygon } from "geojson";

export type Coordinate = [number, number];
export type LocationMode = "real" | "simulation";
export type GameSessionState = "IDLE" | "TRACKING" | "PAUSED" | "LOOP_AVAILABLE" | "CLAIMING" | "FINISHED";
export type LoopSource = "ACTIVE_ROUTE" | "OWN_TERRITORY";
export type LoopInvalidReason = "TOO_FEW_POINTS" | "TOO_SHORT" | "TOO_SMALL" | "SELF_INTERSECTION" | "INVALID_POLYGON";

export type LocationSample = {
  coordinate: Coordinate;
  accuracyM: number;
  timestamp: number;
};

export type PotentialLoop = {
  id: string;
  signature: string;
  source: LoopSource;
  startIndex: number;
  endIndex: number;
  coordinates: Coordinate[];
  routeCoordinates: Coordinate[];
  polygon: Polygon;
  estimatedAreaM2: number;
  routeLengthM: number;
  validity: true;
  detectedAt: string;
};

export type LoopDiagnostic = {
  source: LoopSource;
  startIndex: number;
  endIndex: number;
  validity: false;
  reason: LoopInvalidReason;
  detectedAt: string;
};

export type GameSessionSnapshot = {
  state: GameSessionState;
  coordinates: Coordinate[];
  totalDistanceM: number;
  potentialLoop: PotentialLoop | null;
  diagnostic: LoopDiagnostic | null;
  claimCount: number;
};
