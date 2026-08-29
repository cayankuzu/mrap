"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Polygon } from "geojson";
import bbox from "@turf/bbox";
import { feature } from "@turf/helpers";
import { Maximize2 } from "lucide-react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MediaLightbox } from "@/components/MediaLightbox";
import { createDemoGeometry, MAP_LOAD_TIMEOUT_MS, MRAP_MAPLIBRE_LOCALE, OPEN_FREE_MAP_STYLE, type MapCameraState, type PreviewTerritory } from "@/lib/map-preview";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const PREVIEW_PRELOAD_MARGIN = "160px 0px";

type TerritoryInteractiveMapProps = {
  territory: PreviewTerritory;
  ownerUsername: string;
  mapView?: MapCameraState | null;
  compact?: boolean;
  initiallyEnlarged?: boolean;
};

function boundaryCollection(geometry: Polygon | MultiPolygon): FeatureCollection<LineString> {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((part) => part[0]);
  return {
    type: "FeatureCollection",
    features: rings.map((coordinates): Feature<LineString> => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } })),
  };
}

function expandedBounds(bounds: number[]) {
  const longitudePadding = Math.max((bounds[2] - bounds[0]) * 1.8, 0.012);
  const latitudePadding = Math.max((bounds[3] - bounds[1]) * 1.8, 0.01);
  return [
    [bounds[0] - longitudePadding, bounds[1] - latitudePadding],
    [bounds[2] + longitudePadding, bounds[3] + latitudePadding],
  ] as [[number, number], [number, number]];
}

function TerritoryMapCanvas({ territory, ownerUsername, mapView, expanded, onOpen }: TerritoryInteractiveMapProps & { expanded: boolean; onOpen?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const geometry = useMemo(
    () => territory.geojson ?? createDemoGeometry({ name: territory.name, district: territory.district, color: territory.color, variant: territory.variant }),
    [territory.color, territory.district, territory.geojson, territory.name, territory.variant],
  );
  const bounds = useMemo(() => bbox(feature(geometry)), [geometry]);

  useEffect(() => {
    if (!containerRef.current) return;
    const fallbackCenter: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const initialZoom = mapView?.zoom ?? 14;
    const minimumZoom = Math.max(1, initialZoom - 2);
    const maximumZoom = Math.min(22, Math.max(minimumZoom, initialZoom + 2));
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: OPEN_FREE_MAP_STYLE,
        center: mapView?.center ?? fallbackCenter,
        zoom: mapView?.zoom ?? 14,
        bearing: mapView?.bearing ?? 0,
        pitch: mapView?.pitch ?? 0,
        minZoom: minimumZoom,
        maxZoom: maximumZoom,
        maxBounds: expandedBounds(bounds),
        attributionControl: { compact: true },
        cooperativeGestures: !expanded,
        locale: MRAP_MAPLIBRE_LOCALE,
      });
    } catch {
      const failureFrame = window.requestAnimationFrame(() => setMapError(true));
      return () => window.cancelAnimationFrame(failureFrame);
    }
    let disposed = false;
    let loaded = false;
    let loadTimer: number | null = window.setTimeout(() => {
      loadTimer = null;
      if (!disposed && !loaded) setMapError(true);
    }, MAP_LOAD_TIMEOUT_MS);
    const canvas = map.getCanvas();
    canvas.setAttribute("role", expanded ? "application" : "img");
    canvas.setAttribute("aria-label", expanded ? `${territory.name} büyütülmüş etkileşimli haritası` : `${territory.name} mini haritası`);
    canvas.tabIndex = expanded ? 0 : -1;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.boxZoom.disable();
    if (expanded) map.scrollZoom.enable(); else {
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
    }
    const handleLoad = () => {
      if (disposed) return;
      loaded = true;
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
      }
      setMapReady(true);
      setMapError(false);
      map.addSource("post-territory", { type: "geojson", data: feature(geometry) });
      map.addSource("post-territory-boundary", { type: "geojson", data: boundaryCollection(geometry) });
      map.addLayer({ id: "post-territory-fill", type: "fill", source: "post-territory", paint: { "fill-color": territory.color, "fill-opacity": 0.44 } });
      map.addLayer({ id: "post-territory-line", type: "line", source: "post-territory", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": territory.color, "line-width": expanded ? 5 : 4 } });
      map.addLayer({
        id: "post-territory-owner",
        type: "symbol",
        source: "post-territory-boundary",
        layout: { "symbol-placement": "line", "symbol-spacing": expanded ? 110 : 82, "text-field": `@${ownerUsername}`, "text-size": expanded ? 12 : 10, "text-font": ["Noto Sans Regular"], "text-keep-upright": true, "text-allow-overlap": false },
        paint: { "text-color": "#132019", "text-halo-color": "rgba(255,255,255,.96)", "text-halo-width": 2 },
      });
      if (!mapView) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: expanded ? 84 : 36, maxZoom: 16.5, duration: 0 });
      map.resize();
    };
    const handleError = () => {
      if (disposed || loaded) return;
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
      }
      setMapError(true);
    };
    const handleOpen = onOpen ? () => onOpen() : null;
    map.on("load", handleLoad);
    map.on("error", handleError);
    if (!expanded && handleOpen) map.on("click", handleOpen);
    return () => {
      disposed = true;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      map.off("load", handleLoad);
      map.off("error", handleError);
      if (!expanded && handleOpen) map.off("click", handleOpen);
      map.remove();
    };
  }, [bounds, expanded, geometry, mapView, onOpen, ownerUsername, territory.color, territory.name]);

  return (
    <>
      <div ref={containerRef} className={`territory-interactive-canvas${expanded ? " is-expanded" : ""}`} role="group" aria-label={`${territory.name} etkileşimli haritası`} />
      {!mapReady && !mapError ? <span className="territory-map-error is-loading" role="status">Harita hazırlanıyor…</span> : null}
      {mapError ? <span className="territory-map-error" role="alert">Harita servisine ulaşılamadı. Sayfayı yenileyerek tekrar deneyebilirsin.</span> : null}
    </>
  );
}

export function TerritoryInteractiveMap({ territory, ownerUsername, mapView, compact = false, initiallyEnlarged = false }: TerritoryInteractiveMapProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const previewPointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const activePreviewPointersRef = useRef(new Set<number>());
  const previewOpenBlockedUntilRef = useRef(0);
  const [inView, setInView] = useState(false);
  const [enlarged, setEnlarged] = useState(initiallyEnlarged);
  const openMap = useCallback(() => setEnlarged(true), []);
  const openMapFromPreview = useCallback(() => {
    if (Date.now() >= previewOpenBlockedUntilRef.current) openMap();
  }, [openMap]);

  const previewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, a")) return;
    activePreviewPointersRef.current.add(event.pointerId);
    if (activePreviewPointersRef.current.size > 1) {
      previewPointerStartRef.current = null;
      previewOpenBlockedUntilRef.current = Date.now() + 700;
      return;
    }
    previewPointerStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }, []);

  const previewPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = previewPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      previewPointerStartRef.current = null;
      previewOpenBlockedUntilRef.current = Date.now() + 300;
    }
  }, []);

  const previewPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = previewPointerStartRef.current;
    previewPointerStartRef.current = null;
    activePreviewPointersRef.current.delete(event.pointerId);
    if (!start || start.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 10) openMapFromPreview();
  }, [openMapFromPreview]);

  const previewPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    activePreviewPointersRef.current.delete(event.pointerId);
    previewPointerStartRef.current = null;
    previewOpenBlockedUntilRef.current = Date.now() + 300;
  }, []);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setInView(entry.isIntersecting);
    }, { rootMargin: PREVIEW_PRELOAD_MARGIN });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={previewRef}
        className={`territory-interactive-map${compact ? " is-compact" : ""}`}
        onPointerDown={previewPointerDown}
        onPointerMove={previewPointerMove}
        onPointerUp={previewPointerUp}
        onPointerCancel={previewPointerCancel}
      >
        {inView ? <TerritoryMapCanvas territory={territory} ownerUsername={ownerUsername} mapView={mapView} compact={compact} expanded={false} onOpen={openMapFromPreview} /> : <div className="territory-map-skeleton" role="status">Harita hazırlanıyor…</div>}
        <button type="button" className="map-expand-icon" onClick={openMap} aria-label={`${territory.name} etkileşimli haritasını büyüt`} aria-haspopup="dialog"><Maximize2 size={17} /></button>
        <span className="territory-map-hint">Dokunarak büyüt · iki parmakla gez</span>
      </div>
      <MediaLightbox open={enlarged} onClose={() => setEnlarged(false)} title={`${territory.name} · ${territory.district}`}>
        <div className="territory-interactive-lightbox">
          <TerritoryMapCanvas territory={territory} ownerUsername={ownerUsername} mapView={mapView} compact={compact} expanded />
          <span className="territory-map-limit-note">Alan çevresinde sınırlı gezinme</span>
        </div>
      </MediaLightbox>
    </>
  );
}
