"use client";

import { lazy, startTransition, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { MapArtwork } from "@/components/MapArtwork";
import type { MapCameraState, PreviewTerritory } from "@/lib/map-preview";

const TerritoryInteractiveMap = lazy(() => import("@/components/TerritoryInteractiveMap").then((module) => ({
  default: module.TerritoryInteractiveMap,
})));

type DeferredTerritoryInteractiveMapProps = {
  territory: PreviewTerritory;
  ownerUsername: string;
  mapView?: MapCameraState | null;
  compact?: boolean;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

let previewSequence = 0;
const BACKGROUND_MAP_DELAY_MS = 3_200;

function LightweightMapPreview({
  territory,
  compact,
  loading,
  onOpen,
}: Pick<DeferredTerritoryInteractiveMapProps, "territory" | "compact"> & {
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`territory-interactive-map deferred-territory-map${compact ? " is-compact" : ""}${loading ? " is-activating" : ""}`}
      onClick={onOpen}
      aria-label={`${territory.name} etkileşimli haritasını büyüt`}
      aria-busy={loading || undefined}
      aria-haspopup="dialog"
    >
      <MapArtwork territory={{ name: territory.name, color: territory.color, variant: territory.variant }} />
      <span className="map-expand-icon" aria-hidden="true"><Maximize2 size={17} /></span>
      <span className="territory-map-hint">{loading ? "Etkileşimli harita hazırlanıyor…" : "Dokunarak büyüt · iki parmakla gez"}</span>
    </button>
  );
}

/**
 * Feed rotalarını MapLibre/Turf indirme ve başlatma maliyetinden ayırır.
 * Görünür haritalar tarayıcı boş kaldığında hazırlanır; ilk dokunuş ise bu
 * düşük öncelikli işi beklemeden gerçek haritayı ve büyütülmüş görünümü açar.
 */
export function DeferredTerritoryInteractiveMap({
  territory,
  ownerUsername,
  mapView,
  compact = false,
}: DeferredTerritoryInteractiveMapProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const sequenceRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [openWhenReady, setOpenWhenReady] = useState(false);

  if (sequenceRef.current === null) sequenceRef.current = previewSequence++;

  const activateAndOpen = useCallback(() => {
    setOpenWhenReady(true);
    setActive(true);
  }, []);

  useEffect(() => {
    const node = previewRef.current;
    if (!node || active) return;

    let cancelled = false;
    let timer = 0;
    let idleHandle: number | null = null;
    const browserWindow = window as IdleWindow;
    const activateInBackground = () => {
      if (cancelled) return;
      const activate = () => {
        if (!cancelled) startTransition(() => setActive(true));
      };
      if (browserWindow.requestIdleCallback) {
        idleHandle = browserWindow.requestIdleCallback(activate, { timeout: 2_400 });
      } else {
        timer = window.setTimeout(activate, 450);
      }
    };
    const schedule = () => {
      // Aynı anda görünen kartların MapLibre kurulumlarını düşük donanımda üst üste bindirme.
      const staggerMs = BACKGROUND_MAP_DELAY_MS + Math.min(sequenceRef.current ?? 0, 6) * 600;
      timer = window.setTimeout(activateInBackground, staggerMs);
    };

    if (typeof IntersectionObserver === "undefined") {
      schedule();
    } else {
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        schedule();
      }, { rootMargin: "80px 0px" });
      observer.observe(node);
      return () => {
        cancelled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        if (idleHandle !== null) browserWindow.cancelIdleCallback?.(idleHandle);
      };
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null) browserWindow.cancelIdleCallback?.(idleHandle);
    };
  }, [active]);

  return (
    <div ref={previewRef} className="deferred-territory-observer">
      {active ? (
      <Suspense fallback={<LightweightMapPreview territory={territory} compact={compact} loading onOpen={activateAndOpen} />}>
        <TerritoryInteractiveMap
          territory={territory}
          ownerUsername={ownerUsername}
          mapView={mapView}
          compact={compact}
          initiallyEnlarged={openWhenReady}
        />
      </Suspense>
      ) : (
        <LightweightMapPreview territory={territory} compact={compact} loading={false} onOpen={activateAndOpen} />
      )}
    </div>
  );
}
