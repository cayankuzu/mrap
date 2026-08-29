"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, ChevronDown, ChevronRight, Crosshair, EyeOff, Flag, Footprints, Gauge, LoaderCircle, MapPin, Navigation, Pause, Play, Radio, RotateCcw, Route, ShieldCheck, Square, Timer, X, Zap } from "lucide-react";
import { ColorPalette } from "@/components/ColorPalette";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { AuthoritativeGameStateMachine, type AuthoritativeUiEvent } from "@/lib/game/authoritative-state-machine";
import type { AuthoritativeUiState, ClaimResult, CloseLoopCommand, LocationPointCommand, LoopCandidateDto, RegionPatchEvent, RegionSnapshot, RouteSessionDto, RouteSessionRecoveryDto } from "@/lib/game/authoritative-types";
import { GAME_CONFIG } from "@/lib/game/config";
import { deviceHeadingRequiresPermission, headingCardinalLabel, headingDelta, headingFromGeolocation, normalizeHeading, requestDeviceHeadingPermission, smoothHeading, subscribeDeviceHeading } from "@/lib/game/device-heading";
import { GameSession } from "@/lib/game/game-session";
import { RealLocationProvider, SimulatedLocationProvider } from "@/lib/game/location-provider";
import { appendOfflineRouteDraftPoint, clearOfflineRouteDraft, readOfflineRouteDraft } from "@/lib/game/offline-route-draft";
import { locationCaptureDisposition, requiresOnlineSegmentBoundary } from "@/lib/game/offline-route-policy";
import { clearRoutePointQueue, readRoutePointQueue, reconcileQueuedRoutePoints, writeRoutePointQueue, type RoutePointQueueWriteResult } from "@/lib/game/route-point-queue";
import { clearActiveRouteSession, persistActiveRouteSession, readActiveRouteSession } from "@/lib/game/session-recovery";
import type { Coordinate, GameSessionSnapshot, LocationMode, LocationSample, LoopInvalidReason } from "@/lib/game/types";
import type { AppUser, TerritoryMapState } from "@/lib/models";
import { MAP_LOAD_TIMEOUT_MS, MRAP_MAPLIBRE_LOCALE, OPEN_FREE_MAP_STYLE } from "@/lib/map-preview";
import { RealtimeRegionReconciler } from "@/lib/realtime/region-reconciler";
import { viewportToRegionIds } from "@/lib/spatial/ownership-grid";
import { applyLocalTerritoryClaim, mergeTerritoryMapPatch, territoryMapCollections } from "@/lib/territory/territory-map-state";
import { territoryProfilePath } from "@/lib/territory-profile-path";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

const ISTANBUL_CENTER: Coordinate = [29.027, 40.987];
const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };
const VALID_ROUTE_COLOR = /^#[0-9a-f]{6}$/i;
const ROUTE_COLOR_EVENT = "mrap-route-color-change";
const POINT_BATCH_SIZE = 4;
const POINT_FLUSH_DELAY_MS = 900;
const PREFETCHED_LOCATION_MAX_AGE_MS = 30_000;
const MAP_LIBRARY_IDLE_TIMEOUT_MS = 1_800;
const configuredRegionZoom = Number(process.env.NEXT_PUBLIC_MRAP_REGION_ZOOM);
const configuredMaximumRegions = Number(process.env.NEXT_PUBLIC_MRAP_MAX_VIEWPORT_REGIONS);
const VIEWPORT_REGION_ZOOM = Number.isSafeInteger(configuredRegionZoom) && configuredRegionZoom >= 8 && configuredRegionZoom <= 18 ? configuredRegionZoom : 14;
const MAXIMUM_VIEWPORT_REGIONS = Number.isSafeInteger(configuredMaximumRegions) && configuredMaximumRegions >= 1 && configuredMaximumRegions <= 256 ? configuredMaximumRegions : 64;
const VIEWPORT_REGION_DEBOUNCE_MS = 240;
const PRODUCTION_WORLD_ID = process.env.NEXT_PUBLIC_MRAP_PRODUCTION_WORLD_ID?.trim() || "world-main";
const routeColorMemory = new Map<string, string>();

type ApiError = { error?: string; code?: string };
type PointBatchResponse = {
  acceptedCount: number;
  ignoredCount: number;
  suspiciousCount: number;
  lastReceivedSequence: number;
  lastAcceptedSequence: number;
  classifications: Array<{ sequence: number; classification: string; reason?: string }>;
};
type FinishedRoute = { distanceM: number; durationSeconds: number; acceptedPointCount: number; closedClaimCount: number };
type RegionSnapshotWithCells = RegionSnapshot & {
  cells: Array<{ cellId: string; regionId: string; ownerId: string; ownerUsername: string; paintColorId: string }>;
  latestOutboxSequence: number;
  mapState: TerritoryMapState;
};
type RegionStreamEnvelope = { sequence: number; event: RegionPatchEvent };
type NetworkTestConfig = { latencyMs: 0 | 300 | 1000; packetLossPercent: 0 | 10 | 30; duplicateBatch: boolean };
type PointSyncState = "synced" | "buffering" | "replaying" | "storage_unavailable" | "expired" | "full";

const authoritativeStateLabels: Record<AuthoritativeUiState, string> = {
  IDLE: "Rota bekliyor",
  ACQUIRING_LOCATION: "Konum izni bekleniyor",
  READY: "Konum hazır",
  TRACKING: "Rota güvenle kaydediliyor",
  LOOP_AVAILABLE: "Kapatılabilir alan hazır",
  CONTINUING: "Rota devam ettiriliyor",
  SUBMITTING_CLAIM: "Alan sunucuda doğrulanıyor",
  CLAIM_ACCEPTED: "Alan onaylandı",
  CLAIM_PARTIAL: "Alan kısmen onaylandı",
  CLAIM_REJECTED: "Alan doğrulanamadı",
  PAUSED_LOW_ACCURACY: "Konum doğruluğu bekleniyor",
  PAUSED_OFFLINE: "Bağlantı yok · rota kişisel taslakta",
  RESYNCING_MAP: "Harita eşitleniyor",
  SESSION_REVOKED: "Oturum güvenlik nedeniyle kapatıldı",
  FINISHED: "Oturum tamamlandı",
};

function subscribeRouteColor(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("mrap:route-color:")) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(ROUTE_COLOR_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ROUTE_COLOR_EVENT, onStoreChange);
  };
}

function readRouteColor(userId: string, fallback: string) {
  try {
    const stored = window.localStorage.getItem(`mrap:route-color:${userId}`);
    return stored && VALID_ROUTE_COLOR.test(stored) ? stored : fallback;
  } catch {
    const memoryColor = routeColorMemory.get(userId);
    return memoryColor && VALID_ROUTE_COLOR.test(memoryColor) ? memoryColor : fallback;
  }
}

function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
}

function browserIsOnline() {
  return navigator.onLine !== false;
}

function playerPositionCollection(coordinate: Coordinate, heading: number | null): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { heading: heading ?? 0, hasHeading: heading !== null },
      geometry: { type: "Point", coordinates: coordinate },
    }],
  };
}

const diagnosticLabels: Record<LoopInvalidReason, string> = {
  TOO_FEW_POINTS: "Döngü için daha fazla yön değiştir.",
  TOO_SHORT: "Temas bulundu; rota bölümü henüz çok kısa.",
  TOO_SMALL: "Temas bulundu; oluşan alan çok küçük.",
  SELF_INTERSECTION: "Rota kendi içinde birden fazla kez kesişiyor.",
  INVALID_POLYGON: "Temas geçerli bir kapalı alan oluşturmadı.",
};

export function GameMap({ user, mapState: initialMapState, demo = false }: { user: AppUser; mapState: TerritoryMapState; demo?: boolean }) {
  const { dictionary: copy } = useI18n();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const headingDescriptionRef = useRef<HTMLSpanElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const positionRef = useRef<Coordinate>(ISTANBUL_CENTER);
  const playerHeadingRef = useRef<number | null>(null);
  const pendingHeadingRef = useRef<number | null>(null);
  const headingAnimationFrameRef = useRef<number | null>(null);
  const deviceHeadingStopRef = useRef<(() => void) | null>(null);
  const deviceHeadingRequestRef = useRef<Promise<void> | null>(null);
  const deviceHeadingSeenRef = useRef(false);
  const [sessionEngine] = useState(() => new GameSession());
  const authoritativeMachineRef = useRef(new AuthoritativeGameStateMachine());
  const simulatorRef = useRef(new SimulatedLocationProvider(ISTANBUL_CENTER));
  const teleportModeRef = useRef(false);
  const locationModeRef = useRef<LocationMode>(demo ? "simulation" : "real");
  const locationHandlerRef = useRef<(sample: LocationSample) => void>(() => undefined);
  const authoritativeSessionRef = useRef<RouteSessionDto | null>(null);
  const authoritativeCandidateRef = useRef<LoopCandidateDto | null>(null);
  const authoritativeCandidateRequestRef = useRef<string | null>(null);
  const pendingPointsRef = useRef<LocationPointCommand[]>([]);
  const nextPointSequenceRef = useRef(0);
  const lastAcceptedSequenceRef = useRef(0);
  const pointFlushTimerRef = useRef<number | null>(null);
  const claimStateTimerRef = useRef<number | null>(null);
  const pointFlushChainRef = useRef<Promise<void>>(Promise.resolve());
  const reconnectReplayRef = useRef<Promise<void> | null>(null);
  const offlineDraftCountRef = useRef(0);
  const claimCommandRef = useRef<CloseLoopCommand | null>(null);
  const latestRealtimeSequenceRef = useRef(0);
  const realtimeWorldRef = useRef(PRODUCTION_WORLD_ID);
  const confirmedMapEpochRef = useRef(0);
  const requestRegionSnapshotRef = useRef<(() => void) | null>(null);
  const activeLocationStopRef = useRef<(() => void) | null>(null);
  const prefetchedRealLocationRef = useRef<LocationSample | null>(null);
  const realLocationRequestRef = useRef<Promise<LocationSample | null> | null>(null);
  const realLocationPreflightStartedRef = useRef(false);
  const componentActiveRef = useRef(false);
  const networkTestConfigRef = useRef<NetworkTestConfig>({ latencyMs: 0, packetLossPercent: 0, duplicateBatch: false });
  const networkPacketCounterRef = useRef(0);
  const resumeNeedsAnchorRef = useRef(false);
  const offlineSegmentBoundaryPendingRef = useRef(false);
  const onlineBoundaryEstablishedForDraftRef = useRef(false);
  const serverSegmentBoundaryRequiredRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const territoryStateRef = useRef(initialMapState);
  const [territoryState, setTerritoryState] = useState(initialMapState);
  const [visibleRegionIds, setVisibleRegionIds] = useState<string[]>([]);
  const [authoritativeWorldId, setAuthoritativeWorldId] = useState(PRODUCTION_WORLD_ID);
  const [locationMode, setLocationMode] = useState<LocationMode>(demo ? "simulation" : "real");
  const [locationStatus, setLocationStatus] = useState(demo ? "Simülasyon hazır" : "Kapalı");
  const [session, setSession] = useState<GameSessionSnapshot>({ state: "IDLE", coordinates: [], totalDistanceM: 0, potentialLoop: null, diagnostic: null, claimCount: 0 });
  const [authoritativeUiState, setAuthoritativeUiState] = useState<AuthoritativeUiState>("IDLE");
  const [seconds, setSeconds] = useState(0);
  const selectedColor = useSyncExternalStore(
    subscribeRouteColor,
    () => readRouteColor(user.id, user.color),
    () => user.color,
  );
  const [speed, setSpeed] = useState<1 | 5 | 20>(5);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [teleportMode, setTeleportMode] = useState(false);
  const [sessionCardCollapsed, setSessionCardCollapsed] = useState(false);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [sessionRecovering, setSessionRecovering] = useState(!demo);
  const [takeoverDialogOpen, setTakeoverDialogOpen] = useState(false);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const [takeoverError, setTakeoverError] = useState("");
  const [sessionFinishing, setSessionFinishing] = useState(false);
  const [candidatePending, setCandidatePending] = useState(false);
  const [authoritativeCandidate, setAuthoritativeCandidate] = useState<LoopCandidateDto | null>(null);
  const [finishedRoute, setFinishedRoute] = useState<FinishedRoute | null>(null);
  const [networkTestConfig, setNetworkTestConfig] = useState<NetworkTestConfig>({ latencyMs: 0, packetLossPercent: 0, duplicateBatch: false });
  const [message, setMessage] = useState("");
  const [infoNotice, setInfoNotice] = useState("");
  const [claimNotice, setClaimNotice] = useState<{ uniqueM2: number; overlapM2: number; totalM2: number } | null>(null);
  const [runtimeActive, setRuntimeActive] = useState(true);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [queuedPointCount, setQueuedPointCount] = useState(0);
  const [offlineDraftCount, setOfflineDraftCount] = useState(0);
  const [pointSyncState, setPointSyncState] = useState<PointSyncState>("synced");
  const [mapLibrary, setMapLibrary] = useState<typeof import("maplibre-gl") | null>(null);

  useEffect(() => {
    componentActiveRef.current = true;
    return () => {
      componentActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (mapLibrary) return;
    let cancelled = false;
    let timer = 0;
    let idleHandle: number | null = null;
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const loadMapLibrary = () => {
      void import("maplibre-gl").then((module) => {
        if (cancelled) return;
        module.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        setMapLibrary(module);
      }).catch(() => {
        if (!cancelled) setMapLoadFailed(true);
      });
    };
    timer = window.setTimeout(() => {
      if (browserWindow.requestIdleCallback) {
        idleHandle = browserWindow.requestIdleCallback(loadMapLibrary, { timeout: MAP_LIBRARY_IDLE_TIMEOUT_MS });
      } else {
        loadMapLibrary();
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null) browserWindow.cancelIdleCallback?.(idleHandle);
    };
  }, [mapLibrary, mapRetryKey]);

  const transitionAuthoritative = useCallback((event: AuthoritativeUiEvent) => {
    if (event === "OFFLINE") {
      offlineSegmentBoundaryPendingRef.current = true;
      onlineBoundaryEstablishedForDraftRef.current = false;
      serverSegmentBoundaryRequiredRef.current = true;
    }
    const transition = authoritativeMachineRef.current.send(event);
    if (transition.accepted) setAuthoritativeUiState(transition.state);
    return transition;
  }, []);

  function updateNetworkTestConfig(patch: Partial<NetworkTestConfig>) {
    const next = { ...networkTestConfigRef.current, ...patch };
    networkTestConfigRef.current = next;
    if (patch.packetLossPercent !== undefined) networkPacketCounterRef.current = 0;
    setNetworkTestConfig(next);
  }

  function selectRouteColor(nextColor: string) {
    routeColorMemory.set(user.id, nextColor);
    try { window.localStorage.setItem(`mrap:route-color:${user.id}`, nextColor); }
    catch { /* Depolama kapalıysa renk yalnızca bu oturumda korunur. */ }
    window.dispatchEvent(new Event(ROUTE_COLOR_EVENT));
  }

  const ownTerritory = territoryState.territories.find((territory) => territory.userId === user.id)?.geometry ?? null;
  const localTrackingActive = ["TRACKING", "LOOP_AVAILABLE", "CLAIMING"].includes(session.state);
  const authoritativeTrackingActive = ["TRACKING", "LOOP_AVAILABLE", "CONTINUING", "SUBMITTING_CLAIM", "CLAIM_ACCEPTED", "CLAIM_PARTIAL", "CLAIM_REJECTED", "PAUSED_LOW_ACCURACY", "RESYNCING_MAP"].includes(authoritativeUiState);
  const trackingActive = runtimeActive && (demo
    ? localTrackingActive
    : localTrackingActive && (authoritativeTrackingActive || authoritativeUiState === "PAUSED_OFFLINE"));

  const setMapStateSources = useCallback((state: TerritoryMapState) => {
    const collections = territoryMapCollections(state);
    (mapRef.current?.getSource("territories") as GeoJSONSource | undefined)?.setData(collections.ownership);
    (mapRef.current?.getSource("territory-boundaries") as GeoJSONSource | undefined)?.setData(collections.boundaries);
    (mapRef.current?.getSource("territory-paints") as GeoJSONSource | undefined)?.setData(collections.paints);
  }, []);

  const replaceTerritoryState = useCallback((state: TerritoryMapState) => {
    territoryStateRef.current = state;
    setTerritoryState(state);
    setMapStateSources(state);
  }, [setMapStateSources]);

  const updatePlayerHeading = useCallback((rawHeading: number, source: "device" | "gps" | "simulation") => {
    const normalized = normalizeHeading(rawHeading);
    if (normalized === null || source === "gps" && deviceHeadingSeenRef.current) return;
    if (source === "device") deviceHeadingSeenRef.current = true;
    pendingHeadingRef.current = normalized;
    if (headingAnimationFrameRef.current !== null) return;
    headingAnimationFrameRef.current = window.requestAnimationFrame(() => {
      headingAnimationFrameRef.current = null;
      const pending = pendingHeadingRef.current;
      pendingHeadingRef.current = null;
      if (pending === null) return;
      const previous = playerHeadingRef.current;
      const next = smoothHeading(previous, pending);
      if (next === null || previous !== null && Math.abs(headingDelta(previous, next)) < 0.5) return;
      playerHeadingRef.current = next;
      const roundedHeading = Math.round(next) % 360;
      if (mapContainerRef.current) {
        mapContainerRef.current.dataset.playerHeading = String(roundedHeading);
        mapContainerRef.current.dataset.playerHeadingSource = source;
      }
      if (headingDescriptionRef.current) headingDescriptionRef.current.textContent = `Baktığın yön: ${headingCardinalLabel(next)}, ${roundedHeading} derece.`;
      (mapRef.current?.getSource("player-position") as GeoJSONSource | undefined)?.setData(playerPositionCollection(positionRef.current, next));
    });
  }, []);

  const enableDeviceHeading = useCallback((requestPermission: boolean) => {
    if (deviceHeadingStopRef.current) return Promise.resolve();
    if (!requestPermission && deviceHeadingRequiresPermission()) return Promise.resolve();
    if (deviceHeadingRequestRef.current) return deviceHeadingRequestRef.current;
    const pending = (async () => {
      const permission = await requestDeviceHeadingPermission();
      if (permission !== "granted" || !componentActiveRef.current || locationModeRef.current !== "real" || deviceHeadingStopRef.current) return;
      deviceHeadingStopRef.current = subscribeDeviceHeading((heading) => updatePlayerHeading(heading, "device"));
    })();
    deviceHeadingRequestRef.current = pending;
    void pending.finally(() => {
      if (deviceHeadingRequestRef.current === pending) deviceHeadingRequestRef.current = null;
    });
    return pending;
  }, [updatePlayerHeading]);

  const updateLiveSources = useCallback((snapshot: GameSessionSnapshot, currentPosition: Coordinate) => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const routeData: FeatureCollection<LineString> = snapshot.coordinates.length >= 2
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: snapshot.coordinates } }] }
      : EMPTY_COLLECTION as FeatureCollection<LineString>;
    const playerData = playerPositionCollection(currentPosition, playerHeadingRef.current);
    const loopData: FeatureCollection<Polygon> = snapshot.potentialLoop
      ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: snapshot.potentialLoop.polygon }] }
      : EMPTY_COLLECTION as FeatureCollection<Polygon>;
    (map.getSource("active-route") as GeoJSONSource | undefined)?.setData(routeData);
    (map.getSource("player-position") as GeoJSONSource | undefined)?.setData(playerData);
    (map.getSource("active-area") as GeoJSONSource | undefined)?.setData(loopData);
  }, []);

  const persistPendingPointQueue = useCallback((points = pendingPointsRef.current): RoutePointQueueWriteResult => {
    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) {
      clearRoutePointQueue(window.sessionStorage, user.id);
      setQueuedPointCount(0);
      return { status: "empty", count: 0 };
    }
    const snapshot = sessionEngine.snapshot();
    const result = writeRoutePointQueue(window.sessionStorage, {
      userId: user.id,
      sessionId: authoritativeSession.id,
      sessionLeaseExpiresAt: authoritativeSession.leaseExpiresAt,
      points,
      summary: { totalDistanceM: snapshot.totalDistanceM, claimCount: snapshot.claimCount },
    });
    setQueuedPointCount(result.status === "stored" ? result.count : 0);
    return result;
  }, [sessionEngine, user.id]);

  const enqueueOfflineDraftPoint = useCallback((sample: LocationSample) => {
    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) return;
    const snapshot = sessionEngine.snapshot();
    const result = appendOfflineRouteDraftPoint(window.sessionStorage, {
      userId: user.id,
      sessionId: authoritativeSession.id,
      sessionLeaseExpiresAt: authoritativeSession.leaseExpiresAt,
      sample,
      summary: { totalDistanceM: snapshot.totalDistanceM, claimCount: snapshot.claimCount },
    });
    if (result.status === "stored") {
      offlineDraftCountRef.current = result.count;
      setOfflineDraftCount(result.count);
      setPointSyncState("buffering");
      offlineSegmentBoundaryPendingRef.current = true;
      onlineBoundaryEstablishedForDraftRef.current = false;
      serverSegmentBoundaryRequiredRef.current = true;
      transitionAuthoritative("OFFLINE");
      return;
    }
    if (result.status === "expired") {
      offlineDraftCountRef.current = 0;
      setOfflineDraftCount(0);
      setPointSyncState("expired");
      offlineSegmentBoundaryPendingRef.current = true;
      serverSegmentBoundaryRequiredRef.current = true;
      transitionAuthoritative("OFFLINE");
      setSession(sessionEngine.pause());
      setMessage("Çevrimdışı kişisel rota taslağının gizlilik süresi doldu. Bağlantı gelince yeni bir rota başlat.");
      return;
    }
    setPointSyncState(result.status === "overflow" ? "full" : "storage_unavailable");
    offlineSegmentBoundaryPendingRef.current = true;
    serverSegmentBoundaryRequiredRef.current = true;
    transitionAuthoritative("OFFLINE");
    setSession(sessionEngine.pause());
    setMessage(result.status === "overflow"
      ? "Çevrimdışı kişisel rota taslağı doldu. Konum kaybını önlemek için rota duraklatıldı."
      : "Tarayıcı kişisel rota taslağına izin vermedi. Konum kaybını önlemek için rota duraklatıldı.");
  }, [sessionEngine, setMessage, transitionAuthoritative, user.id]);

  const sendQueuedPointBatches = useCallback(async (drainAll: boolean) => {
    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) return;
    if (navigator.onLine === false) {
      setPointSyncState("buffering");
      transitionAuthoritative("OFFLINE");
      return;
    }
    while (pendingPointsRef.current.length && (drainAll || pendingPointsRef.current.length >= POINT_BATCH_SIZE)) {
      const batch = pendingPointsRef.current.splice(0, POINT_BATCH_SIZE);
      const firstSequence = batch[0].sequence;
      const lastSequence = batch[batch.length - 1].sequence;
      let responseReceived = false;
      try {
        const requestBody = JSON.stringify({ idempotencyKey: `points-${authoritativeSession.id}-${firstSequence}-${lastSequence}`, points: batch });
        const requestInit: RequestInit = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-mrap-session-nonce": authoritativeSession.serverNonce,
          },
          body: requestBody,
        };
        const harnessEnabled = GAME_CONFIG.developerControls
          && authoritativeSession.mode === "development_simulation"
          && authoritativeSession.worldId !== PRODUCTION_WORLD_ID;
        const harness = harnessEnabled ? networkTestConfigRef.current : { latencyMs: 0, packetLossPercent: 0, duplicateBatch: false };
        if (harness.latencyMs > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, harness.latencyMs));
        networkPacketCounterRef.current += 1;
        const deterministicLossBucket = networkPacketCounterRef.current % 10;
        if (harness.packetLossPercent > 0 && deterministicLossBucket < harness.packetLossPercent / 10) throw new Error("Test ağı konum paketini düşürdü.");
        const response = await fetch(`/api/game/sessions/${authoritativeSession.id}/points`, requestInit);
        responseReceived = true;
        const result = await response.json().catch(() => null) as PointBatchResponse | ApiError | null;
        if (!response.ok || !result || !("lastAcceptedSequence" in result)) {
          if (result && "code" in result && result.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
          throw new Error(result && "error" in result && result.error || "Konum noktaları doğrulanamadı.");
        }
        lastAcceptedSequenceRef.current = Math.max(lastAcceptedSequenceRef.current, result.lastAcceptedSequence);
        const refreshedSession = {
          ...authoritativeSession,
          lastReceivedSequence: Math.max(authoritativeSession.lastReceivedSequence, result.lastReceivedSequence),
          lastAcceptedSequence: Math.max(authoritativeSession.lastAcceptedSequence, result.lastAcceptedSequence),
        };
        authoritativeSessionRef.current = refreshedSession;
        persistActiveRouteSession(window.sessionStorage, user.id, refreshedSession);
        const persisted = persistPendingPointQueue();
        setPointSyncState(persisted.status === "empty" ? "synced" : "replaying");
        if (result.suspiciousCount > 0) setLocationStatus("Bazı konum noktaları güvenlik kontrolünde");
        if (harness.duplicateBatch) {
          const duplicateResponse = await fetch(`/api/game/sessions/${authoritativeSession.id}/points`, requestInit);
          const duplicateResult = await duplicateResponse.json().catch(() => null) as PointBatchResponse | ApiError | null;
          if (!duplicateResponse.ok || !duplicateResult || !("lastAcceptedSequence" in duplicateResult)) throw new Error(duplicateResult && "error" in duplicateResult && duplicateResult.error || "Yinelenen test paketi doğrulanamadı.");
        }
      } catch (error) {
        pendingPointsRef.current = [...batch, ...pendingPointsRef.current];
        persistPendingPointQueue();
        setPointSyncState("buffering");
        if (!responseReceived || !navigator.onLine || error instanceof Error && error.message.startsWith("Test ağı")) transitionAuthoritative("OFFLINE");
        throw error;
      }
      if (!drainAll) break;
    }
  }, [persistPendingPointQueue, transitionAuthoritative, user.id]);

  const flushQueuedPoints = useCallback((drainAll = false) => {
    if (pointFlushTimerRef.current !== null) {
      window.clearTimeout(pointFlushTimerRef.current);
      pointFlushTimerRef.current = null;
    }
    const flush = pointFlushChainRef.current.catch(() => undefined).then(() => sendQueuedPointBatches(drainAll));
    pointFlushChainRef.current = flush;
    return flush;
  }, [sendQueuedPointBatches]);

  const beginAuthoritativeOnlineSegment = useCallback(async () => {
    if (!serverSegmentBoundaryRequiredRef.current || onlineBoundaryEstablishedForDraftRef.current) return;
    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) throw new Error("Aktif sunucu oturumu bulunamadı.");
    const response = await fetch(`/api/game/sessions/${authoritativeSession.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-mrap-session-nonce": authoritativeSession.serverNonce,
      },
      body: JSON.stringify({
        action: "resume_online",
        expectedCurrentSegmentIndex: authoritativeSession.currentSegmentIndex,
      }),
    });
    const payload = await response.json().catch(() => null) as RouteSessionDto | ApiError | null;
    if (!response.ok || !payload || !("currentSegmentIndex" in payload)) {
      if (payload && "code" in payload && payload.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
      throw new Error(payload && "error" in payload && payload.error || "Çevrimiçi rota bölümü başlatılamadı.");
    }
    authoritativeSessionRef.current = payload;
    persistActiveRouteSession(window.sessionStorage, user.id, payload);
    offlineSegmentBoundaryPendingRef.current = true;
    onlineBoundaryEstablishedForDraftRef.current = true;
    serverSegmentBoundaryRequiredRef.current = false;
  }, [transitionAuthoritative, user.id]);

  const reconnectAuthoritativeRoute = useCallback(() => {
    if (reconnectReplayRef.current) return reconnectReplayRef.current;
    const replay = (async () => {
      try {
        if (pendingPointsRef.current.length > 0) setPointSyncState("replaying");
        await flushQueuedPoints(true);
        await beginAuthoritativeOnlineSegment();
        if (authoritativeMachineRef.current.state === "PAUSED_OFFLINE") transitionAuthoritative("LOCATION_READY");
        if (requestRegionSnapshotRef.current) requestRegionSnapshotRef.current();
        else if (authoritativeMachineRef.current.state === "RESYNCING_MAP") transitionAuthoritative("SYNCED");
        if (pendingPointsRef.current.length === 0 && sessionEngine.snapshot().state !== "PAUSED") setPointSyncState("synced");
      } catch (error) {
        setPointSyncState("buffering");
        setMessage(error instanceof Error ? error.message : "Sunucu onayı bekleyen çevrimiçi konum noktaları gönderilemedi.");
      } finally {
        reconnectReplayRef.current = null;
      }
    })();
    reconnectReplayRef.current = replay;
    return replay;
  }, [beginAuthoritativeOnlineSegment, flushQueuedPoints, sessionEngine, setMessage, transitionAuthoritative]);

  const enqueueAuthoritativePoint = useCallback((sample: LocationSample) => {
    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) return;
    const sequence = nextPointSequenceRef.current + 1;
    const observedAt = new Date(sample.timestamp);
    const command: LocationPointCommand = {
      sequence,
      latitude: sample.coordinate[1],
      longitude: sample.coordinate[0],
      accuracyM: Math.max(0, sample.accuracyM),
      clientObservedAt: Number.isNaN(observedAt.getTime()) ? undefined : observedAt.toISOString(),
    };
    const nextPending = [...pendingPointsRef.current, command];
    const persisted = persistPendingPointQueue(nextPending);
    if (persisted.status === "expired") {
      pendingPointsRef.current = [];
      nextPointSequenceRef.current = authoritativeSession.lastReceivedSequence;
      setPointSyncState("expired");
      offlineSegmentBoundaryPendingRef.current = true;
      serverSegmentBoundaryRequiredRef.current = true;
      transitionAuthoritative("OFFLINE");
      setSession(sessionEngine.pause());
      setMessage("Çevrimdışı konum kuyruğunun gizlilik süresi doldu. Bu rotayı bitirip yeni bir rota başlat.");
      return;
    }
    if (persisted.status === "overflow") {
      setPointSyncState("full");
      offlineSegmentBoundaryPendingRef.current = true;
      serverSegmentBoundaryRequiredRef.current = true;
      transitionAuthoritative("OFFLINE");
      setSession(sessionEngine.pause());
      setMessage("Cihazdaki geçici konum kuyruğu doldu. Bağlantı gelene kadar rota güvenle duraklatıldı.");
      return;
    }
    if (persisted.status === "unavailable" && navigator.onLine === false) {
      setPointSyncState("storage_unavailable");
      offlineSegmentBoundaryPendingRef.current = true;
      serverSegmentBoundaryRequiredRef.current = true;
      transitionAuthoritative("OFFLINE");
      setSession(sessionEngine.pause());
      setMessage("Tarayıcı geçici konum kuyruğuna izin vermedi. Konum kaybını önlemek için rota duraklatıldı.");
      return;
    }
    pendingPointsRef.current = nextPending;
    nextPointSequenceRef.current = sequence;
    setQueuedPointCount(nextPending.length);
    setPointSyncState(navigator.onLine === false ? "buffering" : "replaying");
    if (navigator.onLine === false) {
      transitionAuthoritative("OFFLINE");
      return;
    }
    if (pendingPointsRef.current.length >= POINT_BATCH_SIZE) {
      void flushQueuedPoints().catch((error) => setMessage(error instanceof Error ? error.message : "Konum noktaları gönderilemedi."));
      return;
    }
    if (pointFlushTimerRef.current === null) {
      pointFlushTimerRef.current = window.setTimeout(() => {
        pointFlushTimerRef.current = null;
        void flushQueuedPoints(true).catch((error) => setMessage(error instanceof Error ? error.message : "Konum noktaları gönderilemedi."));
      }, POINT_FLUSH_DELAY_MS);
    }
  }, [flushQueuedPoints, persistPendingPointQueue, sessionEngine, setMessage, transitionAuthoritative]);

  const requestAuthoritativeCandidate = useCallback(async (localLoopId: string) => {
    if (demo || authoritativeCandidateRequestRef.current === localLoopId) return;
    if (navigator.onLine === false) {
      setPointSyncState("buffering");
      transitionAuthoritative("OFFLINE");
      return;
    }
    authoritativeCandidateRequestRef.current = localLoopId;
    setCandidatePending(true);
    let responseReceived = false;
    try {
      await flushQueuedPoints(true);
      const authoritativeSession = authoritativeSessionRef.current;
      if (!authoritativeSession) throw new Error("Aktif sunucu oturumu bulunamadı.");
      const response = await fetch("/api/game/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mrap-session-nonce": authoritativeSession.serverNonce },
        body: JSON.stringify({ sessionId: authoritativeSession.id, lastAcceptedPointSequence: lastAcceptedSequenceRef.current }),
      });
      responseReceived = true;
      const result = await response.json().catch(() => null) as { candidate?: LoopCandidateDto; error?: string; code?: string } | null;
      if (!response.ok || !result?.candidate) {
        if (response.status === 409 && result?.code === "NO_LOOP_AVAILABLE") {
          const next = sessionEngine.continueTracking();
          setSession(next);
          updateLiveSources(next, positionRef.current);
          authoritativeCandidateRequestRef.current = null;
          return;
        }
        if (result?.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
        throw new Error(result?.error || "Döngü sunucuda doğrulanamadı.");
      }
      authoritativeCandidateRef.current = result.candidate;
      setAuthoritativeCandidate(result.candidate);
      transitionAuthoritative("LOOP_DETECTED");
    } catch (error) {
      if (!responseReceived || !navigator.onLine) transitionAuthoritative("OFFLINE");
      setMessage(error instanceof Error ? error.message : "Döngü sunucuda doğrulanamadı.");
      window.setTimeout(() => {
        authoritativeCandidateRequestRef.current = null;
      }, 1800);
    } finally {
      setCandidatePending(false);
    }
  }, [demo, flushQueuedPoints, sessionEngine, setMessage, transitionAuthoritative, updateLiveSources]);

  const handleLocation = useCallback((sample: LocationSample) => {
    if (document.visibilityState !== "visible") return;
    positionRef.current = sample.coordinate;
    if (sample.headingDeg !== undefined) updatePlayerHeading(sample.headingDeg, locationMode === "simulation" ? "simulation" : "gps");
    if (locationMode === "real" && sample.accuracyM > GAME_CONFIG.location.maximumGpsAccuracyM) {
      setLocationStatus(`Zayıf konum sinyali · ±${Math.round(sample.accuracyM)} m`);
      if (!demo) transitionAuthoritative("LOW_ACCURACY");
      return;
    }
    if (!demo && authoritativeMachineRef.current.state === "PAUSED_LOW_ACCURACY") {
      transitionAuthoritative("LOCATION_READY");
      if (authoritativeCandidateRef.current) transitionAuthoritative("LOOP_DETECTED");
    }
    if (locationMode === "real") setLocationStatus(`Konum · ±${Math.round(sample.accuracyM)} m`);
    const previous = sessionEngine.snapshot();
    const captureDisposition = locationCaptureDisposition(browserIsOnline(), authoritativeMachineRef.current.state);
    const authoritativeConnectionReady = captureDisposition === "authoritative_online";
    const startsNewSegment = (resumeNeedsAnchorRef.current
      || authoritativeConnectionReady && offlineSegmentBoundaryPendingRef.current)
      && ["TRACKING", "PAUSED", "LOOP_AVAILABLE"].includes(previous.state);
    if (startsNewSegment) {
      resumeNeedsAnchorRef.current = false;
      offlineSegmentBoundaryPendingRef.current = false;
    }
    const next = startsNewSegment
      ? sessionEngine.startNewSegment(sample)
      : sessionEngine.addLocation(sample, locationMode, ownTerritory);
    if (!demo && (startsNewSegment || next.coordinates.length > previous.coordinates.length)) {
      if (authoritativeConnectionReady) enqueueAuthoritativePoint(sample);
      else enqueueOfflineDraftPoint(sample);
    }
    setSession(next);
    updateLiveSources(next, sample.coordinate);
    mapRef.current?.easeTo({ center: sample.coordinate, duration: 320 });
    if (!demo && next.potentialLoop && navigator.onLine !== false) void requestAuthoritativeCandidate(next.potentialLoop.id);
  }, [demo, enqueueAuthoritativePoint, enqueueOfflineDraftPoint, locationMode, ownTerritory, requestAuthoritativeCandidate, sessionEngine, transitionAuthoritative, updateLiveSources, updatePlayerHeading]);

  useEffect(() => { locationHandlerRef.current = handleLocation; }, [handleLocation]);
  useEffect(() => { teleportModeRef.current = teleportMode; }, [teleportMode]);
  useEffect(() => { locationModeRef.current = locationMode; }, [locationMode]);
  useEffect(() => { authoritativeCandidateRef.current = authoritativeCandidate; }, [authoritativeCandidate]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !mapLibrary) return;
    let map: MapLibreMap;
    try {
      map = new mapLibrary.Map({
        container: mapContainerRef.current,
        style: OPEN_FREE_MAP_STYLE,
        center: ISTANBUL_CENTER,
        zoom: 15,
        pitch: 18,
        bearing: -8,
        attributionControl: { compact: true },
        cooperativeGestures: false,
        locale: MRAP_MAPLIBRE_LOCALE,
      });
    } catch {
      const failureFrame = window.requestAnimationFrame(() => setMapLoadFailed(true));
      return () => window.cancelAnimationFrame(failureFrame);
    }
    mapRef.current = map;
    let disposed = false;
    let mapErrorReported = false;
    let territoryLayerListenersAttached = false;
    let viewportRegionTimer: number | null = null;
    let mapLoadTimer: number | null = window.setTimeout(() => {
      mapLoadTimer = null;
      if (disposed) return;
      mapErrorReported = true;
      setMapLoadFailed(true);
    }, MAP_LOAD_TIMEOUT_MS);
    const updateViewportRegions = () => {
      if (disposed) return;
      const bounds = map.getBounds();
      const nextRegions = viewportToRegionIds(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        VIEWPORT_REGION_ZOOM,
        MAXIMUM_VIEWPORT_REGIONS,
      );
      setVisibleRegionIds((current) => current.length === nextRegions.length && current.every((regionId, index) => regionId === nextRegions[index]) ? current : nextRegions);
    };
    const scheduleViewportRegionUpdate = () => {
      if (disposed) return;
      if (viewportRegionTimer !== null) window.clearTimeout(viewportRegionTimer);
      viewportRegionTimer = window.setTimeout(() => {
        viewportRegionTimer = null;
        updateViewportRegions();
      }, VIEWPORT_REGION_DEBOUNCE_MS);
    };
    const handleTerritoryClick = (event: MapLayerMouseEvent) => {
      const mapFeature = event.features?.[0];
      if (!mapFeature) return;
      const username = String(mapFeature.properties?.username ?? "oyuncu");
      const areaM2 = Number(mapFeature.properties?.areaM2 ?? 0);
      const color = String(mapFeature.properties?.color ?? "#0D8BFF");
      const card = document.createElement("div");
      card.className = "territory-popup-card";
      const swatch = document.createElement("span");
      swatch.style.background = color;
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = "mrap sahiplik alanı";
      const meta = document.createElement("small");
      meta.textContent = `@${username} · ${(areaM2 / 1_000_000).toFixed(3)} km² benzersiz alan`;
      const profile = document.createElement("a");
      profile.href = territoryProfilePath({ demo, username, currentUsername: user.username });
      profile.textContent = "Profili gör →";
      copy.append(title, meta, profile);
      card.append(swatch, copy);
      new mapLibrary.Popup({ closeButton: true, offset: 12, className: "territory-owner-popup" }).setLngLat(event.lngLat).setDOMContent(card).addTo(map);
    };
    const handleTerritoryMouseEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const handleTerritoryMouseLeave = () => { map.getCanvas().style.cursor = ""; };
    const handleMapClick = (event: MapMouseEvent) => {
      if (!teleportModeRef.current) return;
      const coordinate: Coordinate = [event.lngLat.lng, event.lngLat.lat];
      simulatorRef.current.teleport(coordinate);
      positionRef.current = coordinate;
      setTeleportMode(false);
      map.easeTo({ center: coordinate, duration: 450 });
    };
    const handleLoad = () => {
      if (disposed) return;
      if (mapLoadTimer !== null) {
        window.clearTimeout(mapLoadTimer);
        mapLoadTimer = null;
      }
      setMapLoadFailed(false);
      const collections = territoryMapCollections(territoryStateRef.current);
      map.addSource("territories", { type: "geojson", data: collections.ownership });
      map.addSource("territory-paints", { type: "geojson", data: collections.paints });
      map.addSource("territory-boundaries", { type: "geojson", data: collections.boundaries });
      map.addSource("active-route", { type: "geojson", data: EMPTY_COLLECTION });
      map.addSource("active-area", { type: "geojson", data: EMPTY_COLLECTION });
      map.addSource("player-position", { type: "geojson", data: playerPositionCollection(positionRef.current, playerHeadingRef.current) });
      map.addLayer({ id: "territory-fill", type: "fill", source: "territories", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.17 } });
      map.addLayer({ id: "territory-paint-fill", type: "fill", source: "territory-paints", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } });
      map.addLayer({ id: "territory-outline", type: "line", source: "territories", paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.95 } });
      map.addLayer({ id: "territory-owner-label", type: "symbol", source: "territory-boundaries", layout: { "symbol-placement": "line", "symbol-spacing": 120, "text-field": ["concat", "@", ["get", "username"]], "text-size": 11, "text-allow-overlap": false, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#132019", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
      map.addLayer({ id: "active-area-fill", type: "fill", source: "active-area", paint: { "fill-color": user.color, "fill-opacity": 0.28 } });
      map.addLayer({ id: "active-route-line", type: "line", source: "active-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": user.color, "line-width": 6, "line-opacity": 0.96 } });
      map.addLayer({ id: "active-route-label", type: "symbol", source: "active-route", layout: { "symbol-placement": "line", "symbol-spacing": 105, "text-field": `@${user.username}`, "text-size": 10, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#132019", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
      map.addLayer({ id: "player-halo", type: "circle", source: "player-position", paint: { "circle-radius": 17, "circle-color": user.color, "circle-opacity": 0.18 } });
      map.addLayer({ id: "player-heading", type: "symbol", source: "player-position", filter: ["==", ["get", "hasHeading"], true], layout: { "text-field": "▲", "text-size": 21, "text-offset": [0, -1.05], "text-rotate": ["get", "heading"], "text-rotation-alignment": "map", "text-pitch-alignment": "map", "text-allow-overlap": true, "text-ignore-placement": true, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": user.color, "text-halo-color": "#ffffff", "text-halo-width": 2 } });
      map.addLayer({ id: "player-dot", type: "circle", source: "player-position", paint: { "circle-radius": 8, "circle-color": user.color, "circle-stroke-color": "#ffffff", "circle-stroke-width": 4 } });
      map.on("click", "territory-fill", handleTerritoryClick);
      map.on("mouseenter", "territory-fill", handleTerritoryMouseEnter);
      map.on("mouseleave", "territory-fill", handleTerritoryMouseLeave);
      territoryLayerListenersAttached = true;
      setMapReady(true);
      updateViewportRegions();
    };
    const handleMapError = () => {
      if (disposed || mapErrorReported) return;
      mapErrorReported = true;
      if (mapLoadTimer !== null) {
        window.clearTimeout(mapLoadTimer);
        mapLoadTimer = null;
      }
      setMapLoadFailed(true);
    };
    map.on("load", handleLoad);
    map.on("error", handleMapError);
    map.on("moveend", scheduleViewportRegionUpdate);
    map.on("zoomend", scheduleViewportRegionUpdate);
    map.on("click", handleMapClick);
    return () => {
      disposed = true;
      if (mapLoadTimer !== null) window.clearTimeout(mapLoadTimer);
      if (viewportRegionTimer !== null) window.clearTimeout(viewportRegionTimer);
      map.off("load", handleLoad);
      map.off("error", handleMapError);
      map.off("moveend", scheduleViewportRegionUpdate);
      map.off("zoomend", scheduleViewportRegionUpdate);
      map.off("click", handleMapClick);
      if (territoryLayerListenersAttached) {
        map.off("click", "territory-fill", handleTerritoryClick);
        map.off("mouseenter", "territory-fill", handleTerritoryMouseEnter);
        map.off("mouseleave", "territory-fill", handleTerritoryMouseLeave);
      }
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [demo, mapLibrary, mapRetryKey, user.color, user.username]);

  useEffect(() => {
    if (demo || !runtimeActive || !networkOnline || !mapReady || visibleRegionIds.length === 0) return;
    if (realtimeWorldRef.current !== authoritativeWorldId) {
      realtimeWorldRef.current = authoritativeWorldId;
      latestRealtimeSequenceRef.current = 0;
    }

    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin(visibleRegionIds);
    const regions = visibleRegionIds.join(",");
    const baseQuery = new URLSearchParams({ regions, worldId: authoritativeWorldId });
    const streamQuery = new URLSearchParams(baseQuery);
    streamQuery.set("after", String(latestRealtimeSequenceRef.current));
    const events = new EventSource(`/api/game/regions/stream?${streamQuery.toString()}`);
    let disposed = false;
    let snapshotInFlight = false;
    let snapshotTimer: number | null = null;

    const scheduleSnapshot = (delayMs = 120) => {
      if (disposed) return;
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null;
        void loadSnapshot();
      }, delayMs);
    };

    const loadSnapshot = async () => {
      if (disposed) return;
      if (snapshotInFlight) {
        scheduleSnapshot();
        return;
      }
      snapshotInFlight = true;
      const snapshotEpoch = confirmedMapEpochRef.current;
      try {
        const response = await fetch(`/api/game/regions?${baseQuery.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null) as { snapshot?: RegionSnapshotWithCells; error?: string } | null;
        if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || "Bölge görünümü alınamadı.");
        const snapshot = payload.snapshot;
        if (
          disposed
          || snapshot.worldId !== authoritativeWorldId
          || !Number.isSafeInteger(snapshot.latestOutboxSequence)
          || snapshot.latestOutboxSequence < 0
          || !snapshot.mapState
          || !Array.isArray(snapshot.mapState.territories)
          || !Array.isArray(snapshot.mapState.paints)
        ) return;
        latestRealtimeSequenceRef.current = Math.max(latestRealtimeSequenceRef.current, snapshot.latestOutboxSequence);
        const decisions = reconciler.applySnapshot(snapshot);
        const snapshotIsCurrent = visibleRegionIds.every((regionId) => {
          const version = snapshot.versions[regionId];
          return Number.isSafeInteger(version) && version >= reconciler.version(regionId) && !reconciler.isDesynced(regionId);
        });
        if (snapshotIsCurrent && snapshotEpoch === confirmedMapEpochRef.current) {
          replaceTerritoryState(snapshot.mapState);
          if (authoritativeMachineRef.current.state === "RESYNCING_MAP") transitionAuthoritative("SYNCED");
          if (authoritativeMachineRef.current.state === "TRACKING" && authoritativeCandidateRef.current) transitionAuthoritative("LOOP_DETECTED");
        }
        if (!snapshotIsCurrent || snapshotEpoch !== confirmedMapEpochRef.current || decisions.some((decision) => decision.action === "apply" || decision.action === "refetch")) scheduleSnapshot();
      } catch {
        transitionAuthoritative(navigator.onLine ? "RESYNC" : "OFFLINE");
        scheduleSnapshot(1_200);
      } finally {
        snapshotInFlight = false;
      }
    };

    const onPatch = (message: MessageEvent<string>) => {
      let envelope: RegionStreamEnvelope;
      try {
        envelope = JSON.parse(message.data) as RegionStreamEnvelope;
      } catch {
        scheduleSnapshot();
        return;
      }
      if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0 || envelope.event?.type !== "region_patch" || envelope.event.worldId !== authoritativeWorldId) {
        scheduleSnapshot();
        return;
      }
      latestRealtimeSequenceRef.current = Math.max(latestRealtimeSequenceRef.current, envelope.sequence);
      const decision = reconciler.receive(envelope.event);
      if (decision.action === "apply" || decision.action === "refetch") {
        transitionAuthoritative("RESYNC");
        scheduleSnapshot();
      }
    };

    const requestSnapshot = () => scheduleSnapshot(0);
    const handleStreamResync = () => {
      transitionAuthoritative("RESYNC");
      requestSnapshot();
    };
    const handleStreamError = () => {
      transitionAuthoritative(navigator.onLine ? "RESYNC" : "OFFLINE");
      scheduleSnapshot(600);
    };
    requestRegionSnapshotRef.current = requestSnapshot;
    events.addEventListener("patch", onPatch as EventListener);
    events.addEventListener("resync", handleStreamResync);
    events.addEventListener("error", handleStreamError);
    void loadSnapshot();

    return () => {
      disposed = true;
      events.removeEventListener("patch", onPatch as EventListener);
      events.removeEventListener("resync", handleStreamResync);
      events.removeEventListener("error", handleStreamError);
      events.close();
      if (requestRegionSnapshotRef.current === requestSnapshot) requestRegionSnapshotRef.current = null;
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
    };
  }, [authoritativeWorldId, demo, mapReady, networkOnline, replaceTerritoryState, runtimeActive, transitionAuthoritative, visibleRegionIds]);

  useEffect(() => {
    const syncRuntime = () => {
      const online = navigator.onLine !== false;
      const visible = document.visibilityState === "visible";
      setNetworkOnline(online);
      setRuntimeActive(visible);
      if (!visible) {
        if (["TRACKING", "LOOP_AVAILABLE", "CLAIMING", "PAUSED"].includes(sessionEngine.snapshot().state)) {
          resumeNeedsAnchorRef.current = true;
        }
        if (online && pendingPointsRef.current.length > 0) {
          void flushQueuedPoints(true).catch(() => undefined);
        }
        activeLocationStopRef.current?.();
        activeLocationStopRef.current = null;
        return;
      }
      if (demo) return;
      if (!online) {
        if (pendingPointsRef.current.length > 0) setPointSyncState("buffering");
        transitionAuthoritative("OFFLINE");
        return;
      }
      void reconnectAuthoritativeRoute();
    };
    const handlePageHide = () => {
      if (["TRACKING", "LOOP_AVAILABLE", "CLAIMING", "PAUSED"].includes(sessionEngine.snapshot().state)) {
        resumeNeedsAnchorRef.current = true;
      }
      activeLocationStopRef.current?.();
      activeLocationStopRef.current = null;
      setRuntimeActive(false);
    };
    syncRuntime();
    window.addEventListener("offline", syncRuntime);
    window.addEventListener("online", syncRuntime);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", syncRuntime);
    document.addEventListener("visibilitychange", syncRuntime);
    return () => {
      window.removeEventListener("offline", syncRuntime);
      window.removeEventListener("online", syncRuntime);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", syncRuntime);
      document.removeEventListener("visibilitychange", syncRuntime);
    };
  }, [demo, flushQueuedPoints, reconnectAuthoritativeRoute, sessionEngine, transitionAuthoritative]);

  useEffect(() => {
    if (demo || authoritativeUiState !== "PAUSED_OFFLINE" || !networkOnline || !runtimeActive) return;
    const retry = () => { void reconnectAuthoritativeRoute(); };
    retry();
    const timer = window.setInterval(retry, 2_000);
    return () => window.clearInterval(timer);
  }, [authoritativeUiState, demo, networkOnline, reconnectAuthoritativeRoute, runtimeActive]);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    let disposed = false;
    let recovered = false;
    let inFlight = false;
    let recoveryRetryTimer: number | null = null;

    function scheduleRecoveryRetry() {
      if (disposed || recovered || navigator.onLine === false || recoveryRetryTimer !== null) return;
      recoveryRetryTimer = window.setTimeout(() => {
        recoveryRetryTimer = null;
        void recover();
      }, 2_000);
    }

    function queuedSamples(points: readonly LocationPointCommand[]): LocationSample[] {
      return points.map((point) => ({
        coordinate: [point.longitude, point.latitude],
        accuracyM: point.accuracyM,
        timestamp: Date.parse(point.clientObservedAt!),
      }));
    }

    function primeOfflineRecovery(storedSession: RouteSessionDto) {
      const queued = readRoutePointQueue(window.sessionStorage, user.id, storedSession.id);
      const draft = readOfflineRouteDraft(window.sessionStorage, user.id, storedSession.id);
      const reconciledQueue = queued.status === "ready"
        ? reconcileQueuedRoutePoints(queued.points, storedSession.lastReceivedSequence)
        : { status: "acknowledged" as const, points: [] };
      const pending = [...reconciledQueue.points];
      if (reconciledQueue.status === "gap") {
        clearRoutePointQueue(window.sessionStorage, user.id);
      }
      if (pending.length === 0 && draft.status !== "ready") {
        if (queued.status === "expired" || draft.status === "expired") {
          setPointSyncState("expired");
          setMessage("Çevrimdışı rota kaydının gizlilik süresi doldu. Bağlantı geldiğinde yeni bir rota başlat.");
        }
        return false;
      }
      const draftSamples = draft.status === "ready" ? draft.samples : [];
      const restoredSamples = [...queuedSamples(pending), ...draftSamples]
        .toSorted((left, right) => left.timestamp - right.timestamp);
      const summaryDistanceM = Math.max(
        queued.status === "ready" ? queued.summary.totalDistanceM : 0,
        draft.status === "ready" ? draft.summary.totalDistanceM : 0,
      );
      const summaryClaimCount = Math.max(
        queued.status === "ready" ? queued.summary.claimCount : 0,
        draft.status === "ready" ? draft.summary.claimCount : 0,
      );
      authoritativeSessionRef.current = storedSession;
      pendingPointsRef.current = pending;
      nextPointSequenceRef.current = pending.at(-1)?.sequence ?? storedSession.lastReceivedSequence;
      lastAcceptedSequenceRef.current = storedSession.lastAcceptedSequence;
      setQueuedPointCount(pending.length);
      offlineDraftCountRef.current = draftSamples.length;
      setOfflineDraftCount(draftSamples.length);
      offlineSegmentBoundaryPendingRef.current = draftSamples.length > 0;
      onlineBoundaryEstablishedForDraftRef.current = false;
      serverSegmentBoundaryRequiredRef.current = requiresOnlineSegmentBoundary(draftSamples.length);
      setPointSyncState("buffering");
      setAuthoritativeWorldId(storedSession.worldId);
      const restored = sessionEngine.restore(restoredSamples, summaryDistanceM, summaryClaimCount);
      const lastPoint = restoredSamples.at(-1);
      if (lastPoint) positionRef.current = lastPoint.coordinate;
      authoritativeMachineRef.current = new AuthoritativeGameStateMachine("PAUSED_OFFLINE");
      setAuthoritativeUiState("PAUSED_OFFLINE");
      setSession(restored);
      setSeconds(Math.max(0, Math.floor((Date.now() - Date.parse(storedSession.startedAtServer)) / 1_000)));
      setInfoNotice("Bağlantı yok; konum noktaların süreli kişisel taslakta korunuyor ve rekabetçi alana katılmıyor.");
      updateLiveSources(restored, positionRef.current);
      return true;
    }

    async function recover() {
      if (disposed || recovered || inFlight) return;
      inFlight = true;
      setSessionRecovering(true);
      try {
        const storedSession = readActiveRouteSession(window.sessionStorage, user.id);
        if (!storedSession) {
          recovered = true;
          clearRoutePointQueue(window.sessionStorage, user.id);
          clearOfflineRouteDraft(window.sessionStorage, user.id);
          return;
        }
        if (navigator.onLine === false) {
          primeOfflineRecovery(storedSession);
          return;
        }
        const response = await fetch(`/api/game/sessions/${storedSession.id}`, {
          headers: { "x-mrap-session-nonce": storedSession.serverNonce },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as RouteSessionRecoveryDto | ApiError | null;
        if (!response.ok || !payload || !("session" in payload)) {
          const errorCode = payload && "code" in payload ? payload.code : undefined;
          const terminalFailure = response.status === 400
            || response.status === 403
            || response.status === 404
            || (response.status === 409 && errorCode !== "RETRYABLE");
          if (terminalFailure) clearActiveRouteSession(window.sessionStorage, user.id);
          if (terminalFailure) clearRoutePointQueue(window.sessionStorage, user.id);
          if (terminalFailure) clearOfflineRouteDraft(window.sessionStorage, user.id);
          if (response.status >= 500) setMessage("Önceki rota oturumu şu anda geri yüklenemedi. Biraz sonra yeniden deneyebilirsin.");
          if (terminalFailure) recovered = true;
          else scheduleRecoveryRetry();
          return;
        }
        if (payload.availableCandidate) {
          await fetch(`/api/game/candidates/${payload.availableCandidate.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "x-mrap-session-nonce": payload.session.serverNonce,
            },
            body: JSON.stringify({ action: "continue" }),
            signal: controller.signal,
          }).catch(() => undefined);
        }
        if (disposed) return;
        const queued = readRoutePointQueue(window.sessionStorage, user.id, payload.session.id);
        const draft = readOfflineRouteDraft(window.sessionStorage, user.id, payload.session.id);
        const reconciledQueue = queued.status === "ready"
          ? reconcileQueuedRoutePoints(queued.points, payload.session.lastReceivedSequence)
          : { status: "acknowledged" as const, points: [] };
        let pending = [...reconciledQueue.points];
        if (reconciledQueue.status === "gap") {
          clearRoutePointQueue(window.sessionStorage, user.id);
          setPointSyncState("expired");
          setMessage("Cihazdaki rota kuyruğu sunucu sırasıyla eşleşmedi; güvenlik için bekleyen noktalar kullanılmadı.");
        }
        authoritativeSessionRef.current = payload.session;
        persistActiveRouteSession(window.sessionStorage, user.id, payload.session);
        setAuthoritativeWorldId(payload.session.worldId);
        pendingPointsRef.current = pending;
        nextPointSequenceRef.current = pending.at(-1)?.sequence ?? payload.session.lastReceivedSequence;
        lastAcceptedSequenceRef.current = payload.session.lastAcceptedSequence;
        setQueuedPointCount(pending.length);
        const draftSamples = draft.status === "ready" ? draft.samples : [];
        offlineDraftCountRef.current = draftSamples.length;
        setOfflineDraftCount(draftSamples.length);
        offlineSegmentBoundaryPendingRef.current = draftSamples.length > 0;
        onlineBoundaryEstablishedForDraftRef.current = false;
        serverSegmentBoundaryRequiredRef.current = requiresOnlineSegmentBoundary(draftSamples.length);
        if (pending.length > 0 && queued.status === "ready") {
          const persisted = writeRoutePointQueue(window.sessionStorage, {
            userId: user.id,
            sessionId: payload.session.id,
            sessionLeaseExpiresAt: payload.session.leaseExpiresAt,
            points: pending,
            summary: queued.summary,
          });
          if (persisted.status !== "stored") {
            pending = [];
            pendingPointsRef.current = [];
            nextPointSequenceRef.current = payload.session.lastReceivedSequence;
            setQueuedPointCount(0);
            setPointSyncState(persisted.status === "expired" ? "expired" : "storage_unavailable");
          } else {
            setPointSyncState("replaying");
          }
        } else {
          clearRoutePointQueue(window.sessionStorage, user.id);
          setPointSyncState("synced");
        }
        authoritativeCandidateRef.current = null;
        setAuthoritativeCandidate(null);
        authoritativeCandidateRequestRef.current = null;
        claimCommandRef.current = null;
        const restoredPoints = [...payload.currentSegmentPoints, ...queuedSamples(pending), ...draftSamples]
          .toSorted((left, right) => left.timestamp - right.timestamp);
        const restoredDistanceM = Math.max(
          payload.totalDistanceM,
          queued.status === "ready" ? queued.summary.totalDistanceM : 0,
          draft.status === "ready" ? draft.summary.totalDistanceM : 0,
        );
        const restored = sessionEngine.restore(restoredPoints, restoredDistanceM, payload.claimCount);
        const lastPoint = restoredPoints.at(-1);
        if (lastPoint) positionRef.current = lastPoint.coordinate;
        if (browserIsOnline() && draftSamples.length > 0) await beginAuthoritativeOnlineSegment();
        const recoveredState = browserIsOnline() ? "TRACKING" : "PAUSED_OFFLINE";
        authoritativeMachineRef.current = new AuthoritativeGameStateMachine(recoveredState);
        setAuthoritativeUiState(recoveredState);
        setSession(restored);
        setSeconds(payload.elapsedSeconds);
        setInfoNotice(draftSamples.length > 0
          ? `${draftSamples.length} çevrimdışı nokta kişisel taslakta kaldı; rekabet için yeni ve ayrı bir çevrimiçi rota bölümü başlıyor.`
          : pending.length > 0
            ? `${pending.length} sunucu onayı bekleyen çevrimiçi konum noktası eşitleniyor.`
            : "Rota oturumun güvenle geri yüklendi; yeni konum segmenti başlatılıyor.");
        resumeNeedsAnchorRef.current = true;
        recovered = true;
        if (pending.length > 0 && browserIsOnline()) {
          await flushQueuedPoints(true);
        }
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          const storedSession = readActiveRouteSession(window.sessionStorage, user.id);
          if (navigator.onLine === false && storedSession && primeOfflineRecovery(storedSession)) return;
          setMessage("Önceki rota oturumu geri yüklenemedi. Ağ bağlantını kontrol et.");
          scheduleRecoveryRetry();
        }
      } finally {
        inFlight = false;
        if (!disposed) setSessionRecovering(false);
      }
    }
    const handleOnlineRecovery = () => { void recover(); };
    void recover();
    window.addEventListener("online", handleOnlineRecovery);
    return () => {
      disposed = true;
      controller.abort();
      if (recoveryRetryTimer !== null) window.clearTimeout(recoveryRetryTimer);
      window.removeEventListener("online", handleOnlineRecovery);
    };
  }, [beginAuthoritativeOnlineSegment, demo, flushQueuedPoints, sessionEngine, updateLiveSources, user.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.isStyleLoaded()) return;
    for (const layer of ["active-area-fill", "active-route-line", "player-halo", "player-dot"]) map.setPaintProperty(layer, layer.includes("fill") ? "fill-color" : layer.includes("line") ? "line-color" : "circle-color", selectedColor);
    if (map.getLayer("player-heading")) map.setPaintProperty("player-heading", "text-color", selectedColor);
  }, [mapReady, selectedColor]);

  useEffect(() => {
    if (locationMode !== "real") {
      deviceHeadingStopRef.current?.();
      deviceHeadingStopRef.current = null;
      deviceHeadingSeenRef.current = false;
      playerHeadingRef.current = null;
      if (mapContainerRef.current) {
        delete mapContainerRef.current.dataset.playerHeading;
        delete mapContainerRef.current.dataset.playerHeadingSource;
      }
      if (headingDescriptionRef.current) headingDescriptionRef.current.textContent = "Baktığın yön henüz belirlenmedi.";
      (mapRef.current?.getSource("player-position") as GeoJSONSource | undefined)?.setData(playerPositionCollection(positionRef.current, null));
      return;
    }
    if (!deviceHeadingRequiresPermission()) void enableDeviceHeading(false);
    return () => {
      deviceHeadingStopRef.current?.();
      deviceHeadingStopRef.current = null;
    };
  }, [enableDeviceHeading, locationMode]);

  useEffect(() => {
    if (!trackingActive) return;
    const provider = locationMode === "real" ? new RealLocationProvider() : simulatorRef.current;
    const stop = provider.start(
      (sample) => locationHandlerRef.current(sample),
      (error) => {
        if (!demo) transitionAuthoritative("LOW_ACCURACY");
        setMessage(`${error} Tarayıcı iznini aç veya simülasyonu kullan.`);
        setSession(sessionEngine.pause());
      },
    );
    activeLocationStopRef.current = stop;
    return () => {
      if (activeLocationStopRef.current === stop) activeLocationStopRef.current = null;
      stop();
    };
  }, [demo, locationMode, sessionEngine, trackingActive, transitionAuthoritative]);

  useEffect(() => {
    if (!trackingActive) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [trackingActive]);

  useEffect(() => () => {
    activeLocationStopRef.current?.();
    activeLocationStopRef.current = null;
    deviceHeadingStopRef.current?.();
    deviceHeadingStopRef.current = null;
    if (headingAnimationFrameRef.current !== null) window.cancelAnimationFrame(headingAnimationFrameRef.current);
    if (pointFlushTimerRef.current !== null) window.clearTimeout(pointFlushTimerRef.current);
    if (claimStateTimerRef.current !== null) window.clearTimeout(claimStateTimerRef.current);
  }, []);

  useEffect(() => {
    if (locationMode !== "simulation" || !trackingActive) return;
    function moveWithKeyboard(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const movements: Record<string, [number, number]> = { w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
      const movement = movements[event.key.toLowerCase()];
      if (!movement) return;
      event.preventDefault();
      simulatorRef.current.move(movement[0], movement[1], speed * 5);
    }
    window.addEventListener("keydown", moveWithKeyboard);
    return () => window.removeEventListener("keydown", moveWithKeyboard);
  }, [locationMode, speed, trackingActive]);

  const requestRealLocation = useCallback((allowFreshPrefetch = true) => {
    const prefetched = prefetchedRealLocationRef.current;
    const prefetchedAgeMs = prefetched ? Date.now() - prefetched.timestamp : Number.POSITIVE_INFINITY;
    if (allowFreshPrefetch && prefetched && prefetchedAgeMs >= -1_000 && prefetchedAgeMs <= PREFETCHED_LOCATION_MAX_AGE_MS) {
      return Promise.resolve(prefetched);
    }
    if (realLocationRequestRef.current) return realLocationRequestRef.current;
    if (!navigator.geolocation) {
      if (componentActiveRef.current) {
        setLocationStatus(copy.game.locationUnavailableStatus);
        setMessage(copy.game.locationUnsupported);
      }
      return Promise.resolve(null);
    }
    if (componentActiveRef.current) setLocationStatus(copy.game.locationPermissionWaiting);
    const pending = new Promise<LocationSample | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (value) => {
          const gpsHeading = headingFromGeolocation(value);
          const sample: LocationSample = {
            coordinate: [value.coords.longitude, value.coords.latitude] as Coordinate,
            accuracyM: value.coords.accuracy,
            timestamp: value.timestamp,
            ...(gpsHeading === null ? {} : { headingDeg: gpsHeading }),
          };
          if (gpsHeading !== null) updatePlayerHeading(gpsHeading, "gps");
          if (componentActiveRef.current) {
            prefetchedRealLocationRef.current = sample;
            positionRef.current = sample.coordinate;
            setLocationStatus(formatMessage(copy.game.locationReady, { accuracy: Math.round(value.coords.accuracy) }));
            updateLiveSources(session, sample.coordinate);
            mapRef.current?.easeTo({ center: sample.coordinate, duration: 500 });
          }
          resolve(sample);
        },
        (error) => {
          if (componentActiveRef.current) {
            if (error.code === 1) {
              setLocationStatus(copy.game.locationPermissionDeniedStatus);
              setMessage(copy.game.locationPermissionDenied);
            } else if (error.code === 2) {
              setLocationStatus(copy.game.locationUnavailableStatus);
              setMessage(copy.game.locationUnavailable);
            } else {
              setLocationStatus(copy.game.locationTimedOutStatus);
              setMessage(copy.game.locationTimedOut);
            }
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    });
    realLocationRequestRef.current = pending;
    void pending.finally(() => {
      if (realLocationRequestRef.current === pending) realLocationRequestRef.current = null;
    });
    return pending;
  }, [copy.game.locationPermissionDenied, copy.game.locationPermissionDeniedStatus, copy.game.locationPermissionWaiting, copy.game.locationReady, copy.game.locationTimedOut, copy.game.locationTimedOutStatus, copy.game.locationUnavailable, copy.game.locationUnavailableStatus, copy.game.locationUnsupported, session, setLocationStatus, setMessage, updateLiveSources, updatePlayerHeading]);

  useEffect(() => {
    if (demo || locationMode !== "real" || realLocationPreflightStartedRef.current) return;
    realLocationPreflightStartedRef.current = true;
    void requestRealLocation(false);
  }, [demo, locationMode, requestRealLocation]);

  async function startTracking() {
    if (sessionStarting || sessionRecovering) return;
    if (locationMode === "real") void enableDeviceHeading(true);
    setSessionStarting(true);
    setMessage("");
    setInfoNotice("");
    let sample: LocationSample = { coordinate: positionRef.current, accuracyM: 0, timestamp: Date.now() };
    try {
      if (!demo) {
        if (["CLAIM_REJECTED", "SESSION_REVOKED"].includes(authoritativeMachineRef.current.state)) transitionAuthoritative("RESET");
        const requested = transitionAuthoritative("REQUEST_LOCATION");
        if (!requested.accepted) throw new Error("Yeni rota mevcut oyun durumunda başlatılamıyor.");
      }
      if (locationMode === "real") {
        const realSample = await requestRealLocation(true);
        if (!realSample) {
          if (!demo) transitionAuthoritative("REJECT");
          return;
        }
        sample = realSample;
      }
      if (!demo) transitionAuthoritative("LOCATION_READY");
      if (!demo) {
        if (locationMode === "simulation" && !GAME_CONFIG.developerControls) throw new Error("Sanal konum üretim oturumlarında kullanılamaz.");
        setLocationStatus("Güvenli oyun oturumu hazırlanıyor…");
        const response = await fetch("/api/game/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: locationMode === "real" ? "real_gps" : "development_simulation" }),
        });
        const result = await response.json().catch(() => null) as { session?: RouteSessionDto; error?: string; code?: string } | null;
        if (!response.ok || !result?.session) {
          if (result?.code === "SESSION_CONFLICT") {
            transitionAuthoritative("RESET");
            setTakeoverError("");
            setTakeoverDialogOpen(true);
            setLocationStatus(locationMode === "real" ? "Konum hazır" : "Sanal konum hazır");
            return;
          }
          throw new Error(result?.error || "Oyun oturumu başlatılamadı.");
        }
        authoritativeSessionRef.current = result.session;
        persistActiveRouteSession(window.sessionStorage, user.id, result.session);
        setAuthoritativeWorldId(result.session.worldId);
        clearRoutePointQueue(window.sessionStorage, user.id);
        clearOfflineRouteDraft(window.sessionStorage, user.id);
        pendingPointsRef.current = [];
        setQueuedPointCount(0);
        offlineDraftCountRef.current = 0;
        setOfflineDraftCount(0);
        setPointSyncState("synced");
        offlineSegmentBoundaryPendingRef.current = false;
        onlineBoundaryEstablishedForDraftRef.current = false;
        serverSegmentBoundaryRequiredRef.current = false;
        nextPointSequenceRef.current = result.session.lastReceivedSequence;
        lastAcceptedSequenceRef.current = result.session.lastAcceptedSequence;
        authoritativeCandidateRequestRef.current = null;
        claimCommandRef.current = null;
        authoritativeCandidateRef.current = null;
        setAuthoritativeCandidate(null);
        resumeNeedsAnchorRef.current = false;
        const started = transitionAuthoritative("START");
        if (!started.accepted) throw new Error("Sunucu oturumu oyun durumuna bağlanamadı.");
      }
      setSeconds(0);
      setFinishedRoute(null);
      setSessionCardCollapsed(false);
      setMessage("");
      setInfoNotice("");
      setClaimNotice(null);
      const next = sessionEngine.start(sample);
      setSession(next);
      updateLiveSources(next, sample.coordinate);
      if (!demo) {
        enqueueAuthoritativePoint(sample);
        void flushQueuedPoints(true).catch((error) => setMessage(error instanceof Error ? error.message : "İlk konum noktası gönderilemedi."));
      }
    } catch (error) {
      authoritativeSessionRef.current = null;
      if (!demo && authoritativeMachineRef.current.state === "ACQUIRING_LOCATION") transitionAuthoritative("REJECT");
      else if (!demo && authoritativeMachineRef.current.state === "READY") transitionAuthoritative("RESET");
      setLocationStatus(locationMode === "real" ? "Konum hazır" : "Sanal konum hazır");
      setMessage(error instanceof Error ? error.message : "Oyun oturumu başlatılamadı.");
    } finally {
      setSessionStarting(false);
    }
  }

  function switchMode(mode: LocationMode) {
    if (!["IDLE", "FINISHED"].includes(session.state)) { setMessage("Konum modunu değiştirmek için aktif takibi durdur."); return; }
    if (mode === "simulation" && !demo && !GAME_CONFIG.developerControls) { setMessage("Sanal konum yalnızca demo ve geliştirme ortamında kullanılabilir."); return; }
    setLocationMode(mode);
    setMessage("");
    if (mode === "simulation") {
      setLocationStatus("Sanal konum hazır");
      const center = mapRef.current?.getCenter();
      const coordinate: Coordinate = center ? [center.lng, center.lat] : ISTANBUL_CENTER;
      simulatorRef.current.teleport(coordinate);
      positionRef.current = coordinate;
      updateLiveSources(session, coordinate);
    } else {
      setLocationStatus("Kapalı");
    }
  }

  async function continueTracking() {
    if (!demo) {
      const authoritativeSession = authoritativeSessionRef.current;
      if (!authoritativeSession || !authoritativeCandidate) { setMessage("Doğrulanmış döngü bulunamadı."); return; }
      if (authoritativeMachineRef.current.state === "CLAIM_REJECTED") transitionAuthoritative("LOOP_DETECTED");
      const continuing = transitionAuthoritative("CONTINUE");
      if (!continuing.accepted) { setMessage("Döngü şu anda devam ettirilemiyor."); return; }
      setCandidatePending(true);
      let responseReceived = false;
      try {
        const response = await fetch(`/api/game/candidates/${authoritativeCandidate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-mrap-session-nonce": authoritativeSession.serverNonce },
          body: JSON.stringify({ action: "continue" }),
        });
        responseReceived = true;
        const result = await response.json().catch(() => null) as { candidate?: LoopCandidateDto; error?: string; code?: string } | null;
        if (result?.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
        if (!response.ok || !result?.candidate) throw new Error(result?.error || "Döngü devam ettirilemedi.");
        authoritativeCandidateRef.current = null;
        setAuthoritativeCandidate(null);
        authoritativeCandidateRequestRef.current = null;
        claimCommandRef.current = null;
        transitionAuthoritative("START");
      } catch (error) {
        if (authoritativeMachineRef.current.state === "CONTINUING") transitionAuthoritative("LOOP_DETECTED");
        if (!responseReceived || !navigator.onLine) transitionAuthoritative("OFFLINE");
        setMessage(error instanceof Error ? error.message : "Döngü devam ettirilemedi.");
        return;
      } finally {
        setCandidatePending(false);
      }
    }
    const next = sessionEngine.continueTracking();
    setSession(next);
    updateLiveSources(next, positionRef.current);
  }

  async function claimAvailableLoop() {
    const loop = sessionEngine.beginClaim();
    if (!loop) return;
    setSession(sessionEngine.snapshot());
    setMessage("");
    setInfoNotice("");
    setClaimNotice(null);

    if (demo) {
      const claim = applyLocalTerritoryClaim(territoryStateRef.current, user, loop.polygon, selectedColor);
      replaceTerritoryState(claim.mapState);
      setClaimNotice({ uniqueM2: claim.newlyAddedAreaM2, overlapM2: claim.overlapAreaM2, totalM2: claim.totalAreaM2 });
      const next = sessionEngine.claimSucceeded();
      setSession(next);
      updateLiveSources(next, positionRef.current);
      return;
    }

    if (authoritativeMachineRef.current.state === "CLAIM_REJECTED") transitionAuthoritative("LOOP_DETECTED");
    const submitting = transitionAuthoritative("SUBMIT");
    if (!submitting.accepted) {
      setMessage("Alan şu anda sunucuya gönderilemiyor.");
      setSession(sessionEngine.claimFailed());
      return;
    }

    const authoritativeSession = authoritativeSessionRef.current;
    const candidate = authoritativeCandidate;
    if (!authoritativeSession || !candidate) {
      transitionAuthoritative("REJECT");
      setMessage("Sunucu tarafından doğrulanmış döngü bulunamadı.");
      setSession(sessionEngine.claimFailed());
      return;
    }

    let responseReceived = false;
    try {
      await flushQueuedPoints(true);
      const command = claimCommandRef.current?.candidateId === candidate.id
        ? claimCommandRef.current
        : {
            sessionId: authoritativeSession.id,
            candidateId: candidate.id,
            lastAcceptedPointSequence: lastAcceptedSequenceRef.current,
            selectedColorId: selectedColor,
            idempotencyKey: crypto.randomUUID(),
          } satisfies CloseLoopCommand;
      claimCommandRef.current = command;
      const response = await fetch("/api/game/claims", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mrap-session-nonce": authoritativeSession.serverNonce,
        },
        body: JSON.stringify(command),
      });
      responseReceived = true;
      const payload = await response.json().catch(() => null) as { result?: ClaimResult; mapState?: TerritoryMapState; error?: string; code?: string } | null;
      if (payload?.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
      if (!response.ok || !payload?.result || !payload.mapState) throw new Error(payload?.error || "Alan kaydedilemedi.");
      const noOpClaim = payload.result.status === "rejected" && payload.result.claimEventId.startsWith("noop-");
      if (noOpClaim) {
        transitionAuthoritative("REJECT");
        transitionAuthoritative("START");
        setInfoNotice("Bu alan zaten aynı renkte; skor değişmedi.");
        const next = sessionEngine.continueTracking();
        setSession(next);
        updateLiveSources(next, positionRef.current);
        authoritativeCandidateRef.current = null;
        setAuthoritativeCandidate(null);
        authoritativeCandidateRequestRef.current = null;
        claimCommandRef.current = null;
        return;
      }
      if (!(["accepted", "partially_accepted"] as ClaimResult["status"][]).includes(payload.result.status)) {
        throw new Error("Alan talebi sunucu tarafından reddedildi.");
      }
      const acceptedEvent = payload.result.status === "partially_accepted" ? "PARTIAL" : "ACCEPT";
      transitionAuthoritative(acceptedEvent);
      confirmedMapEpochRef.current += 1;
      replaceTerritoryState(mergeTerritoryMapPatch(territoryStateRef.current, payload.mapState));
      requestRegionSnapshotRef.current?.();
      setClaimNotice({
        uniqueM2: payload.result.newlyClaimedAreaM2 + payload.result.capturedFromOthersAreaM2,
        overlapM2: payload.result.alreadyOwnedAreaM2,
        totalM2: payload.result.finalTerritoryAreaM2,
      });
      const next = sessionEngine.claimSucceeded();
      setSession(next);
      updateLiveSources(next, positionRef.current);
      authoritativeCandidateRef.current = null;
      setAuthoritativeCandidate(null);
      authoritativeCandidateRequestRef.current = null;
      claimCommandRef.current = null;
      if (claimStateTimerRef.current !== null) window.clearTimeout(claimStateTimerRef.current);
      claimStateTimerRef.current = window.setTimeout(() => {
        claimStateTimerRef.current = null;
        transitionAuthoritative("START");
      }, 900);
    } catch (error) {
      if (authoritativeMachineRef.current.state === "SUBMITTING_CLAIM") {
        transitionAuthoritative(!responseReceived || !navigator.onLine ? "OFFLINE" : "REJECT");
      }
      setMessage(error instanceof Error ? error.message : "Ağ bağlantısı kurulamadı. Rotan korunuyor; yeniden deneyebilirsin.");
      setSession(sessionEngine.claimFailed());
    }
  }

  async function takeOverActiveSession() {
    if (demo || takeoverPending) return;
    setTakeoverPending(true);
    setTakeoverError("");
    try {
      const response = await fetch("/api/game/sessions/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "takeover",
          acknowledged: true,
          mode: locationMode === "real" ? "real_gps" : "development_simulation",
        }),
      });
      const payload = await response.json().catch(() => null) as RouteSessionRecoveryDto | ApiError | null;
      if (!response.ok || !payload || !("session" in payload)) {
        throw new Error(payload && "error" in payload && payload.error || "Önceki rota oturumu devralınamadı.");
      }
      authoritativeSessionRef.current = payload.session;
      persistActiveRouteSession(window.sessionStorage, user.id, payload.session);
      setAuthoritativeWorldId(payload.session.worldId);
      clearRoutePointQueue(window.sessionStorage, user.id);
      clearOfflineRouteDraft(window.sessionStorage, user.id);
      nextPointSequenceRef.current = payload.session.lastReceivedSequence;
      lastAcceptedSequenceRef.current = payload.session.lastAcceptedSequence;
      pendingPointsRef.current = [];
      setQueuedPointCount(0);
      offlineDraftCountRef.current = 0;
      setOfflineDraftCount(0);
      setPointSyncState("synced");
      offlineSegmentBoundaryPendingRef.current = false;
      onlineBoundaryEstablishedForDraftRef.current = false;
      serverSegmentBoundaryRequiredRef.current = false;
      authoritativeCandidateRef.current = null;
      setAuthoritativeCandidate(null);
      authoritativeCandidateRequestRef.current = null;
      claimCommandRef.current = null;
      const restored = sessionEngine.restore(payload.currentSegmentPoints, payload.totalDistanceM, payload.claimCount);
      authoritativeMachineRef.current = new AuthoritativeGameStateMachine("TRACKING");
      setAuthoritativeUiState("TRACKING");
      setSession(restored);
      setSeconds(payload.elapsedSeconds);
      setFinishedRoute(null);
      setSessionCardCollapsed(false);
      setMessage("");
      setInfoNotice("Önceki rota bu sekmeye güvenle devredildi. Eski sekmenin erişimi kapatıldı.");
      resumeNeedsAnchorRef.current = false;
      setTakeoverDialogOpen(false);
      updateLiveSources(restored, positionRef.current);
    } catch (error) {
      setTakeoverError(error instanceof Error ? error.message : "Önceki rota oturumu devralınamadı.");
    } finally {
      setTakeoverPending(false);
    }
  }

  function pauseOrResume() {
    if (session.state === "PAUSED") {
      resumeNeedsAnchorRef.current = true;
      if (!demo && authoritativeMachineRef.current.state === "PAUSED_LOW_ACCURACY") {
        transitionAuthoritative("LOCATION_READY");
        if (authoritativeCandidateRef.current) transitionAuthoritative("LOOP_DETECTED");
      }
      if (!demo && authoritativeMachineRef.current.state === "PAUSED_OFFLINE") {
        transitionAuthoritative("LOCATION_READY");
        if (requestRegionSnapshotRef.current) requestRegionSnapshotRef.current();
        else transitionAuthoritative("SYNCED");
      }
      setSession(sessionEngine.resume());
      return;
    }
    setSession(sessionEngine.pause());
  }

  async function stopTracking() {
    if (sessionFinishing || candidatePending || session.state === "CLAIMING") return;
    setSessionCardCollapsed(false);
    if (demo) {
      const next = sessionEngine.stop();
      setSession(next);
      updateLiveSources(next, positionRef.current);
      return;
    }

    const authoritativeSession = authoritativeSessionRef.current;
    if (!authoritativeSession) {
      setMessage("Aktif sunucu oturumu bulunamadı.");
      return;
    }

    setSessionFinishing(true);
    const wasPaused = session.state === "PAUSED";
    if (!wasPaused) setSession(sessionEngine.pause());
    let responseReceived = false;
    try {
      await flushQueuedPoints(true);
      const response = await fetch(`/api/game/sessions/${authoritativeSession.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-mrap-session-nonce": authoritativeSession.serverNonce,
        },
        body: JSON.stringify({ action: "finish" }),
      });
      responseReceived = true;
      const payload = await response.json().catch(() => null) as { session?: RouteSessionDto; route?: FinishedRoute; error?: string; code?: string } | null;
      if (payload?.code === "SESSION_REVOKED") transitionAuthoritative("REVOKE");
      if (!response.ok || !payload?.session || !payload.route) throw new Error(payload?.error || "Rota oturumu tamamlanamadı.");
      transitionAuthoritative("FINISH");
      const next = sessionEngine.stop();
      setFinishedRoute(payload.route);
      setSession(next);
      updateLiveSources(next, positionRef.current);
      if (claimStateTimerRef.current !== null) {
        window.clearTimeout(claimStateTimerRef.current);
        claimStateTimerRef.current = null;
      }
      authoritativeSessionRef.current = null;
      clearActiveRouteSession(window.sessionStorage, user.id);
      clearRoutePointQueue(window.sessionStorage, user.id);
      clearOfflineRouteDraft(window.sessionStorage, user.id);
      authoritativeCandidateRef.current = null;
      setAuthoritativeCandidate(null);
      authoritativeCandidateRequestRef.current = null;
      pendingPointsRef.current = [];
      setQueuedPointCount(0);
      offlineDraftCountRef.current = 0;
      setOfflineDraftCount(0);
      setPointSyncState("synced");
      offlineSegmentBoundaryPendingRef.current = false;
      onlineBoundaryEstablishedForDraftRef.current = false;
      serverSegmentBoundaryRequiredRef.current = false;
      resumeNeedsAnchorRef.current = false;
      nextPointSequenceRef.current = 0;
      lastAcceptedSequenceRef.current = 0;
      claimCommandRef.current = null;
      if (pointFlushTimerRef.current !== null) {
        window.clearTimeout(pointFlushTimerRef.current);
        pointFlushTimerRef.current = null;
      }
    } catch (error) {
      if (!responseReceived || !navigator.onLine) transitionAuthoritative("OFFLINE");
      if (!wasPaused) setSession(sessionEngine.resume());
      setMessage(error instanceof Error ? error.message : "Rota oturumu tamamlanamadı. Bağlantını kontrol edip yeniden dene.");
    } finally {
      setSessionFinishing(false);
    }
  }

  function resetSession() {
    if (!demo && authoritativeMachineRef.current.state !== "SESSION_REVOKED" && !["IDLE", "FINISHED"].includes(session.state)) {
      setMessage("Aktif rota önce güvenli biçimde tamamlanmalı.");
      return;
    }
    const next = sessionEngine.reset();
    setSession(next);
    setSeconds(0);
    setMessage("");
    setInfoNotice("");
    setClaimNotice(null);
    setFinishedRoute(null);
    authoritativeCandidateRef.current = null;
    setAuthoritativeCandidate(null);
    authoritativeSessionRef.current = null;
    if (!demo) {
      clearActiveRouteSession(window.sessionStorage, user.id);
      clearRoutePointQueue(window.sessionStorage, user.id);
      clearOfflineRouteDraft(window.sessionStorage, user.id);
    }
    authoritativeCandidateRequestRef.current = null;
    pendingPointsRef.current = [];
    setQueuedPointCount(0);
    offlineDraftCountRef.current = 0;
    setOfflineDraftCount(0);
    setPointSyncState("synced");
    offlineSegmentBoundaryPendingRef.current = false;
    onlineBoundaryEstablishedForDraftRef.current = false;
    serverSegmentBoundaryRequiredRef.current = false;
    resumeNeedsAnchorRef.current = false;
    nextPointSequenceRef.current = 0;
    lastAcceptedSequenceRef.current = 0;
    claimCommandRef.current = null;
    transitionAuthoritative("RESET");
    if (claimStateTimerRef.current !== null) {
      window.clearTimeout(claimStateTimerRef.current);
      claimStateTimerRef.current = null;
    }
    if (pointFlushTimerRef.current !== null) {
      window.clearTimeout(pointFlushTimerRef.current);
      pointFlushTimerRef.current = null;
    }
    setSessionCardCollapsed(false);
    updateLiveSources(next, positionRef.current);
  }

  const diagnostic = session.diagnostic ? diagnosticLabels[session.diagnostic.reason] : "Kendi rotana veya sahip olduğun alan sınırına temas et.";
  const claimOpportunity = demo ? session.potentialLoop : authoritativeCandidate;
  const completedDistanceM = finishedRoute?.distanceM ?? session.totalDistanceM;
  const completedDurationSeconds = finishedRoute?.durationSeconds ?? seconds;
  const completedClaimCount = finishedRoute?.closedClaimCount ?? session.claimCount;
  const authoritativeStateLabel = authoritativeUiState === "CLAIM_REJECTED" && session.state === "IDLE" ? "Konum alınamadı" : authoritativeStateLabels[authoritativeUiState];
  const claimSubmitting = demo ? session.state === "CLAIMING" : authoritativeUiState === "SUBMITTING_CLAIM";
  const authoritativeActionBlocked = !demo && ["PAUSED_LOW_ACCURACY", "PAUSED_OFFLINE", "RESYNCING_MAP", "SESSION_REVOKED"].includes(authoritativeUiState);
  const canResetRevokedSession = !demo && authoritativeUiState === "SESSION_REVOKED";
  const sessionIsCollapsed = sessionCardCollapsed;
  const routeSyncCopy = pointSyncState === "expired"
    ? { tone: "is-warning", title: "Geçici kayıt süresi doldu", detail: "Rota duraklatıldı; bağlantı geldiğinde yeni ve ayrı bir çevrimiçi rota bölümü başlat." }
    : pointSyncState === "full"
      ? { tone: "is-warning", title: "Geçici kayıt sınırına ulaşıldı", detail: "Konum kaybını önlemek için rota duraklatıldı." }
      : pointSyncState === "storage_unavailable"
        ? { tone: "is-warning", title: "Cihaz kaydı kullanılamıyor", detail: "Konum kaybını önlemek için rota duraklatıldı." }
        : !networkOnline || authoritativeUiState === "PAUSED_OFFLINE"
          ? { tone: "is-offline", title: "Çevrimdışı · Konumlar kişisel taslakta", detail: `${offlineDraftCount} çevrimdışı nokta rekabetçi alan hesabına katılmaz${queuedPointCount ? ` · ${queuedPointCount} çevrimiçi nokta sunucu onayı bekliyor` : ""}.` }
          : pointSyncState === "replaying" && queuedPointCount > 0
            ? { tone: "is-syncing", title: "Çevrimiçi noktalar eşitleniyor", detail: `${queuedPointCount} konum noktası güvenli biçimde sunucu onayı bekliyor.` }
            : offlineDraftCount > 0
              ? { tone: "is-draft", title: "Çevrimdışı bölüm kişisel taslakta", detail: "Alan sahipliği için yeni ve ayrı bir çevrimiçi rota bölümü kullanılıyor." }
              : { tone: "is-synced", title: "Konum noktaları eşitlendi", detail: "Yalnızca çevrimiçi doğrulanan rota bölümleri rekabetçi alana dönüşebilir." };
  const recordingStatusLabel = demo
    ? sessionFinishing
      ? "Oturum tamamlanıyor"
      : session.state === "PAUSED"
        ? "Takip duraklatıldı"
        : session.state === "CLAIMING"
          ? "Alan doğrulanıyor"
          : "Rota canlı kaydediliyor"
    : sessionFinishing
      ? "Oturum tamamlanıyor"
      : session.state === "PAUSED"
        ? "Takip duraklatıldı"
        : authoritativeStateLabel;

  return (
    <section className={`game-map-page real-map-page${claimOpportunity ? " has-loop" : ""}`}>
      <div ref={mapContainerRef} className="maplibre-game-canvas" role="region" aria-label={copy.game.liveMapAria} aria-describedby="player-heading-description" />
      <span ref={headingDescriptionRef} id="player-heading-description" className="visually-hidden">Baktığın yön henüz belirlenmedi.</span>
      {!mapReady ? mapLoadFailed ? (
        <div className="map-loading is-error" role="alert">
          <X size={28} aria-hidden="true" />
          <strong>{copy.game.mapLoadFailed}</strong>
          <small>{copy.game.mapLoadFailedHint}</small>
          <button type="button" onClick={() => { setMapLoadFailed(false); setMapRetryKey((value) => value + 1); }}>
            <RotateCcw size={16} aria-hidden="true" /> {copy.common.retry}
          </button>
        </div>
      ) : <div className="map-loading" role="status"><span /><strong>{copy.game.mapPreparing}</strong><small>{copy.game.mapLayersLoading}</small></div> : null}

      <div className="map-topbar">
        <div className="map-location-title"><span className="map-status-dot" /><div><strong>{user.city}</strong><small>{formatMessage(copy.game.currentTerritories, { count: territoryState.territories.length })}</small></div></div>
      </div>

      <div className="map-controls map-controls--location"><button type="button" onClick={() => { if (locationMode === "real") void enableDeviceHeading(true); mapRef.current?.easeTo({ center: positionRef.current, zoom: 16 }); }} aria-label={copy.game.returnToLocation}><Crosshair size={19} /></button></div>

      {(demo || GAME_CONFIG.developerControls) && developerOpen ? (
        <aside className="developer-panel" aria-label="Konum test paneli">
          <header><span><Zap size={16} /> Konum test paneli</span><button type="button" onClick={() => setDeveloperOpen(false)} aria-label="Paneli kapat"><X size={16} /></button></header>
          <div className="developer-status">{locationMode === "simulation" ? <Zap size={14} /> : <Radio size={14} />}<span><small>Etkin konum yöntemi</small><strong>{locationStatus}</strong></span></div>
          <div className="developer-mode"><button type="button" className={locationMode === "simulation" ? "is-active" : ""} onClick={() => switchMode("simulation")}>Sanal konum</button><button type="button" className={locationMode === "real" ? "is-active" : ""} onClick={() => switchMode("real")}>Gerçek konum</button></div>
          {GAME_CONFIG.developerControls && !demo ? <><div className="developer-status"><Radio size={14} /><span><small>Geliştirme ağı testi</small><strong>Yalnız konum paketleri</strong></span></div><div className="developer-speed"><span>Gecikme</span><div>{([0, 300, 1000] as const).map((latencyMs) => <button key={latencyMs} type="button" className={networkTestConfig.latencyMs === latencyMs ? "is-active" : ""} onClick={() => updateNetworkTestConfig({ latencyMs })}>{latencyMs} ms</button>)}</div></div><div className="developer-speed"><span>Paket kaybı</span><div>{([0, 10, 30] as const).map((packetLossPercent) => <button key={packetLossPercent} type="button" className={networkTestConfig.packetLossPercent === packetLossPercent ? "is-active" : ""} onClick={() => updateNetworkTestConfig({ packetLossPercent })}>%{packetLossPercent}</button>)}</div></div><div className="developer-speed"><span>Çift paket</span><div><button type="button" className={networkTestConfig.duplicateBatch ? "is-active" : ""} aria-pressed={networkTestConfig.duplicateBatch} onClick={() => updateNetworkTestConfig({ duplicateBatch: !networkTestConfig.duplicateBatch })}>{networkTestConfig.duplicateBatch ? "Açık" : "Kapalı"}</button></div></div></> : null}
          {locationMode === "simulation" ? <><div className="key-grid"><kbd>W</kbd><span /><kbd>↑</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></div><div className="developer-speed"><span><Gauge size={14} /> Hız</span><div>{([1,5,20] as const).map((item) => <button key={item} type="button" className={speed === item ? "is-active" : ""} onClick={() => setSpeed(item)}>{item}×</button>)}</div></div><button type="button" className={teleportMode ? "is-active" : ""} onClick={() => setTeleportMode((value) => !value)}><MapPin size={15} /> {teleportMode ? "Haritada nokta seç" : "Konumu taşı"}</button></> : <div className="developer-real-note"><ShieldCheck size={15} /><span>Gerçek konumun yalnızca takip başlatıldığında ve izin verdiğinde kullanılır.</span></div>}
          {["IDLE", "FINISHED"].includes(session.state) ? <button type="button" onClick={() => void startTracking()} disabled={sessionStarting || sessionRecovering}><Play size={15} /> {sessionRecovering ? copy.game.recovering : sessionStarting ? copy.game.starting : copy.game.startTracking}</button> : <button type="button" onClick={() => void stopTracking()} disabled={sessionFinishing || candidatePending || claimSubmitting || authoritativeActionBlocked}><Flag size={15} /> {sessionFinishing ? copy.game.finishing : copy.game.stopTracking}</button>}
          <button type="button" onClick={resetSession} disabled={!demo && !canResetRevokedSession && !["IDLE", "FINISHED"].includes(session.state)}><RotateCcw size={15} /> Sıfırla</button>
        </aside>
      ) : null}

      <aside className={`game-session-card${sessionIsCollapsed ? " is-collapsed" : ""}`}>
        {sessionIsCollapsed ? (
          session.state === "IDLE" || session.state === "FINISHED" ? (
            <button type="button" className="session-collapsed-summary" onClick={() => setSessionCardCollapsed(false)} aria-expanded="false" aria-label={formatMessage(copy.game.expandPanel, { title: session.state === "IDLE" ? (demo ? copy.game.demoRoute : copy.game.realRoute) : copy.game.sessionSummary })}>
              <span className="session-icon">{session.state === "IDLE" ? <Footprints size={20} /> : <Check size={20} />}</span>
              <span><small>{session.state === "IDLE" ? (demo ? copy.game.demoRoute : copy.game.realRoute) : copy.game.sessionCompleted}</small><strong>{session.state === "IDLE" ? copy.game.strategicRouteSummary : `${completedClaimCount} alan · ${(completedDistanceM / 1000).toFixed(2)} km`}</strong></span>
              <ChevronDown size={18} />
            </button>
          ) : (
            <div className="session-collapsed-tracking" role="group" aria-label={copy.game.activeLocationRecord}>
              <button type="button" className="session-collapsed-summary" onClick={() => setSessionCardCollapsed(false)} aria-expanded="false" aria-label={copy.game.expandLocationRecordPanel}>
                <span className="session-icon"><span className={`recording-pulse${session.state === "PAUSED" || authoritativeActionBlocked ? " is-paused" : ""}`} /><Radio size={17} aria-hidden="true" /></span>
                <span><small>{recordingStatusLabel}</small><strong>{formatTime(seconds)} · {demo ? `${(session.totalDistanceM / 1000).toFixed(2)} km` : routeSyncCopy.title}</strong></span>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
              <div className="session-actions session-collapsed-actions">
                {canResetRevokedSession ? <button type="button" className="finish-button" onClick={resetSession}><RotateCcw size={17} /> {copy.game.newSession}</button> : <button type="button" className="finish-button" onClick={() => void stopTracking()} disabled={claimSubmitting || sessionFinishing || candidatePending || authoritativeActionBlocked}><Flag size={17} /> {sessionFinishing ? copy.game.finishing : copy.game.stopTracking}</button>}
              </div>
            </div>
          )
        ) : session.state === "IDLE" ? (
          <>
            <div className="session-idle-head"><span className="session-icon"><Footprints size={24} /></span><div><span className="eyebrow">{demo ? copy.game.demoRoute : `${copy.game.realRoute} · ${authoritativeStateLabel}`}</span><h1>{copy.game.strategicRouteTitle}</h1></div><button type="button" className="session-collapse-button" onClick={() => setSessionCardCollapsed(true)} aria-label={copy.game.collapseRoutePanel} aria-expanded="true"><ChevronDown size={18} /></button></div>
            <p>{copy.game.freeLoopHint}</p>
            <div className="safe-note"><ShieldCheck size={17} /><span>{copy.game.privacyHint}</span></div>
            <button type="button" className="start-session-button" onClick={() => void startTracking()} disabled={sessionStarting || sessionRecovering} aria-busy={sessionStarting}><span className="start-session-button-icon">{sessionStarting ? <LoaderCircle className="session-start-spinner" size={20} aria-hidden="true" /> : <Navigation size={20} fill="currentColor" aria-hidden="true" />}</span> {sessionRecovering ? copy.game.recovering : sessionStarting ? copy.game.starting : copy.game.startMoving}</button>
            {sessionStarting ? <div className="session-start-feedback" role="status" aria-live="polite">{copy.game.sessionPreparing}</div> : null}
            {demo || GAME_CONFIG.developerControls ? <button type="button" className="location-helper" onClick={() => setDeveloperOpen(true)}>{locationMode === "simulation" ? "WASD / yön tuşları panelini aç" : "Konum test panelini aç"} <ChevronRight size={16} /></button> : null}
          </>
        ) : session.state === "FINISHED" ? (
          <>
            <div className="session-idle-head"><span className="session-icon"><Check size={24} /></span><div><span className="eyebrow">{copy.game.sessionCompleted}</span><h1>{formatMessage(copy.game.completedClaims, { count: completedClaimCount })}</h1></div><button type="button" className="session-collapse-button" onClick={() => setSessionCardCollapsed(true)} aria-label={copy.game.collapseSessionSummary} aria-expanded="true"><ChevronDown size={18} /></button></div>
            <div className="completed-metrics"><span><small>{copy.common.distance}</small><strong>{(completedDistanceM / 1000).toFixed(2)} km</strong></span><span><small>{copy.common.duration}</small><strong>{formatTime(completedDurationSeconds)}</strong></span><span><small>{copy.game.closures}</small><strong>{completedClaimCount}</strong></span></div>
            <button type="button" className="start-session-button" onClick={resetSession}><RotateCcw size={18} /> {copy.game.newSession}</button>
          </>
        ) : (
          <>
            <div className="recording-header"><span className={`recording-pulse${session.state === "PAUSED" || authoritativeActionBlocked ? " is-paused" : ""}`} /><div><span role="status">{recordingStatusLabel}</span><strong>{formatTime(seconds)}</strong></div><button type="button" className="session-collapse-button" onClick={() => setSessionCardCollapsed(true)} aria-label={copy.game.collapseLocationRecordPanel} aria-expanded="true"><ChevronDown size={18} /></button></div>
            {!demo ? <div className={`route-sync-status ${routeSyncCopy.tone}`} role="status" aria-live="polite"><Radio size={15} aria-hidden="true" /><span><strong>{routeSyncCopy.title}</strong><small>{routeSyncCopy.detail}</small></span></div> : null}
            <div className="live-stats"><span><Route size={18} /><small>Mesafe</small><strong>{(session.totalDistanceM / 1000).toFixed(3)} km</strong></span><span><Timer size={18} /><small>Süre</small><strong>{formatTime(seconds)}</strong></span><span><Square size={18} /><small>Kapatma</small><strong>{session.claimCount}</strong></span></div>
            <div className="loop-progress"><div><strong>Döngü taraması</strong><span>{candidatePending ? "Sunucuda doğrulanıyor" : claimOpportunity ? "Geçerli döngü" : `${session.coordinates.length} nokta`}</span></div><p>{candidatePending ? "Rota noktaların güvenli biçimde doğrulanıyor…" : claimOpportunity ? `${Math.round(claimOpportunity.estimatedAreaM2)} m² kapatılabilir alan bulundu.` : diagnostic}</p></div>
            {canResetRevokedSession ? <div className="session-actions"><button type="button" className="finish-button" onClick={resetSession}><RotateCcw size={17} /> {copy.game.newSession}</button></div> : <div className="session-actions"><button type="button" className="pause-button" onClick={pauseOrResume} disabled={claimSubmitting || sessionFinishing || candidatePending || authoritativeActionBlocked}>{session.state === "PAUSED" ? <Play size={19} fill="currentColor" /> : <Pause size={19} fill="currentColor" />}{session.state === "PAUSED" ? copy.common.continue : copy.game.pause}</button><button type="button" className="finish-button" onClick={() => void stopTracking()} disabled={claimSubmitting || sessionFinishing || candidatePending || authoritativeActionBlocked}><Flag size={17} /> {sessionFinishing ? copy.game.finishing : copy.game.stopTracking}</button></div>}
          </>
        )}
        {sessionIsCollapsed ? null : <details className="map-safety-note"><summary><ShieldCheck size={14} /><span>{copy.game.safePlay}</span><ChevronDown size={14} aria-hidden="true" /></summary><p>{copy.game.safePlayHint}</p></details>}
        {sessionIsCollapsed ? null : <ColorPalette value={selectedColor} onChange={selectRouteColor} label={copy.game.paintColor} helper={copy.game.paintColorHint} className="session-color-picker" />}
      </aside>

      {claimOpportunity ? <aside className="loop-claim-sheet" role="dialog" aria-modal="false" aria-labelledby="loop-sheet-title"><span className="loop-sheet-icon"><Square size={19} /></span><div><small>{demo && session.potentialLoop ? (session.potentialLoop.source === "ACTIVE_ROUTE" ? copy.game.activeRouteContact : copy.game.ownBoundaryContact) : copy.game.serverValidated}</small><h2 id="loop-sheet-title">{copy.game.loopAvailable}</h2><p>{Math.round(claimOpportunity.estimatedAreaM2).toLocaleString("tr-TR")} m² · {Math.round(claimOpportunity.routeLengthM)} m döngü</p></div><div className="loop-sheet-actions"><button type="button" className="secondary-button" onClick={() => void continueTracking()} disabled={claimSubmitting || candidatePending || authoritativeActionBlocked}>{copy.common.continue}</button><button type="button" className="primary-button" onClick={() => void claimAvailableLoop()} disabled={claimSubmitting || candidatePending || authoritativeActionBlocked}>{claimSubmitting ? copy.game.validating : copy.game.claimArea}</button></div></aside> : null}

      <ConfirmationDialog
        open={takeoverDialogOpen}
        title="Önceki rotayı bu sekmede sürdür?"
        description="Başka bir sekmede yarım kalan rota bu cihaza devredilecek. Eski sekme artık konum veya alan işlemi gönderemeyecek. Kaydedilmiş mesafen korunacak; güvenlik için yeni bir rota bölümü başlayacak."
        confirmLabel="Bu sekmede sürdür"
        pendingLabel="Rota devrediliyor…"
        confirmTone="primary"
        icon={<Route size={22} />}
        pending={takeoverPending}
        error={takeoverError}
        onCancel={() => { setTakeoverDialogOpen(false); setTakeoverError(""); }}
        onConfirm={() => void takeOverActiveSession()}
      />

      {claimNotice ? <div className="claim-toast" role="status"><Check size={18} /><span><strong>Alan güncellendi</strong><small>+{Math.round(claimNotice.uniqueM2)} m² benzersiz · {Math.round(claimNotice.overlapM2)} m² yeniden boyandı · toplam {Math.round(claimNotice.totalM2)} m²</small></span><button type="button" onClick={() => setClaimNotice(null)} aria-label="Bildirimi kapat"><X size={15} /></button></div> : null}
      {infoNotice ? <div className="claim-toast" role="status"><Check size={18} /><span><strong>Alan değişmedi</strong><small>{infoNotice}</small></span><button type="button" onClick={() => setInfoNotice("")} aria-label="Bilgiyi kapat"><X size={15} /></button></div> : null}
      {message ? <div className="claim-toast is-error" role="alert"><X size={18} /><span><strong>İşlem tamamlanamadı</strong><small>{message}</small></span><button type="button" onClick={() => setMessage("")} aria-label="Hata bildirimini kapat"><X size={15} /></button></div> : null}
      <div className="map-privacy-pill"><EyeOff size={14} /> Sahiplik anlık; canlı konum yalnızca sende.</div>
    </section>
  );
}
