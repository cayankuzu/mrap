import type { Polygon } from "geojson";

export type CompetitiveLocationMode = "real_gps" | "development_simulation";

export type AuthoritativeSessionStatus =
  | "active"
  | "paused"
  | "closing"
  | "completed"
  | "expired"
  | "revoked";

export type AuthoritativeUiState =
  | "IDLE"
  | "ACQUIRING_LOCATION"
  | "READY"
  | "TRACKING"
  | "LOOP_AVAILABLE"
  | "CONTINUING"
  | "SUBMITTING_CLAIM"
  | "CLAIM_ACCEPTED"
  | "CLAIM_PARTIAL"
  | "CLAIM_REJECTED"
  | "PAUSED_LOW_ACCURACY"
  | "PAUSED_OFFLINE"
  | "RESYNCING_MAP"
  | "SESSION_REVOKED"
  | "FINISHED";

export type ClaimPipelineStatus =
  | "RECEIVED"
  | "AUTHENTICATING"
  | "SESSION_VALIDATION"
  | "ROUTE_VALIDATION"
  | "GEOMETRY_RECONSTRUCTION"
  | "GEOMETRY_VALIDATION"
  | "CELL_CALCULATION"
  | "RATE_LIMIT_CHECK"
  | "RISK_CHECK"
  | "WAITING_FOR_REGION_LOCK"
  | "PROCESSING"
  | "COMMITTED"
  | "BROADCASTED"
  | "REJECTED_INVALID_ROUTE"
  | "REJECTED_INVALID_GEOMETRY"
  | "REJECTED_LOW_ACCURACY"
  | "REJECTED_IMPOSSIBLE_MOVEMENT"
  | "REJECTED_RATE_LIMIT"
  | "REJECTED_STALE_SESSION"
  | "REJECTED_DUPLICATE"
  | "REJECTED_RESTRICTED_REGION"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export type LocationPointCommand = {
  sequence: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM?: number;
  speedMps?: number;
  heading?: number;
  clientObservedAt?: string;
};

export type PointClassification =
  | "ACCEPTED"
  | "IGNORED_LOW_ACCURACY"
  | "IGNORED_OUTLIER"
  | "SUSPICIOUS"
  | "REJECTED";

export type RouteSessionDto = {
  id: string;
  worldId: string;
  mode: CompetitiveLocationMode;
  status: AuthoritativeSessionStatus;
  serverNonce: string;
  lastReceivedSequence: number;
  lastAcceptedSequence: number;
  currentSegmentIndex: number;
  riskScore: number;
  leaseExpiresAt: string;
  startedAtServer: string;
};

export type RouteSessionRecoveryDto = {
  session: RouteSessionDto;
  currentSegmentPoints: Array<{
    coordinate: [number, number];
    accuracyM: number;
    timestamp: number;
  }>;
  totalDistanceM: number;
  claimCount: number;
  elapsedSeconds: number;
  availableCandidate: LoopCandidateDto | null;
};

export type LoopCandidateDto = {
  id: string;
  sessionId: string;
  startSequence: number;
  endSequence: number;
  sourceSegmentIndex: number;
  coordinatesHash: string;
  estimatedAreaM2: number;
  routeLengthM: number;
  detectedAtServer: string;
  expiresAt: string;
  status: "available" | "accepted" | "continued" | "expired" | "invalid";
};

export type CloseLoopCommand = {
  sessionId: string;
  candidateId: string;
  lastAcceptedPointSequence: number;
  selectedColorId: string;
  idempotencyKey: string;
};

export type ClaimResult = {
  claimEventId: string;
  status: "accepted" | "partially_accepted" | "rejected";
  newlyClaimedAreaM2: number;
  capturedFromOthersAreaM2: number;
  alreadyOwnedAreaM2: number;
  restrictedAreaM2: number;
  totalLoopAreaM2: number;
  finalTerritoryAreaM2: number;
  affectedRegionVersions: Record<string, number>;
  capturedFrom: Array<{ userId: string; areaM2: number }>;
  committedAtServer: string;
  concurrentRecalculation: boolean;
};

export type RegionPatchCell = {
  cellId: string;
  ownerId: string | null;
  paintColorId: string | null;
};

export type RegionPatchEvent = {
  eventId: string;
  type: "region_patch";
  worldId: string;
  regionId: string;
  previousVersion: number;
  version: number;
  claimEventId: string;
  changedCells?: RegionPatchCell[];
  requiresRefetch?: boolean;
  committedAtServer: string;
};

export type RegionSnapshot = {
  worldId: string;
  versions: Record<string, number>;
  generatedAtServer: string;
};

export type ReconstructedCandidate = LoopCandidateDto & {
  polygon: Polygon;
};
