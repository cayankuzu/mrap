"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MultiPolygon, Polygon } from "geojson";
import bbox from "@turf/bbox";
import { feature } from "@turf/helpers";
import { Check, LocateFixed, Move, RotateCcw } from "lucide-react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import { createDemoGeometry, MAP_LOAD_TIMEOUT_MS, OPEN_FREE_MAP_STYLE, type MapCameraState, type PreviewTerritory } from "@/lib/map-preview";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type EditableTerritory = PreviewTerritory & {
  name: string;
  district: string;
  color: string;
  variant?: number;
  geojson?: Polygon | MultiPolygon;
  mapSnapshot?: string | null;
  ownerUsername?: string;
};

type TerritoryFrameEditorProps = {
  territory: EditableTerritory;
  ownerUsername?: string;
  onSave: (snapshot: string, mapView: MapCameraState) => void;
};

function captureFrameWithOwnerLabels(map: MapLibreMap, geometry: Polygon | MultiPolygon, username: string) {
  const source = map.getCanvas();
  const output = document.createElement("canvas");
  const outputScale = Math.min(1, 1_600 / Math.max(source.width, source.height));
  output.width = Math.max(1, Math.round(source.width * outputScale));
  output.height = Math.max(1, Math.round(source.height * outputScale));
  const context = output.getContext("2d");
  if (!context) return source.toDataURL("image/jpeg", 0.82);
  context.drawImage(source, 0, 0, output.width, output.height);

  const scaleX = output.width / Math.max(1, source.clientWidth);
  const scaleY = output.height / Math.max(1, source.clientHeight);
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((part) => part[0]);
  const label = `@${username}`;
  context.save();
  context.scale(scaleX, scaleY);
  context.font = "700 10px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255,255,255,.96)";
  context.lineWidth = 3.5;
  context.fillStyle = "#132019";

  for (const ring of rings) {
    const points = ring.map(([longitude, latitude]) => map.project([longitude, latitude]));
    const segments = points.slice(1).map((point, index) => {
      const start = points[index];
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      return { start, dx, dy, length: Math.hypot(dx, dy) };
    }).filter((segment) => segment.length > 1);
    const perimeter = segments.reduce((total, segment) => total + segment.length, 0);
    const spacing = Math.max(96, context.measureText(label).width + 34);
    for (let target = spacing * 0.7; target < perimeter; target += spacing) {
      let walked = 0;
      const segment = segments.find((candidate) => {
        if (walked + candidate.length >= target) return true;
        walked += candidate.length;
        return false;
      });
      if (!segment) continue;
      const progress = (target - walked) / segment.length;
      const x = segment.start.x + segment.dx * progress;
      const y = segment.start.y + segment.dy * progress;
      let angle = Math.atan2(segment.dy, segment.dx);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.strokeText(label, 0, 0);
      context.fillText(label, 0, 0);
      context.restore();
    }
  }
  context.restore();
  return output.toDataURL("image/jpeg", 0.82);
}

function waitForMapEvent(map: MapLibreMap, event: "idle" | "render", timeoutMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timeout: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off(event, finish);
      map.off("remove", finish);
      if (timeout !== null) window.clearTimeout(timeout);
      resolve();
    };
    map.on(event, finish);
    map.on("remove", finish);
    timeout = window.setTimeout(finish, timeoutMs);
    map.triggerRepaint();
  });
}

export function TerritoryFrameEditor({ territory, ownerUsername, onSave }: TerritoryFrameEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("Haritayı sürükle, yakınlaştır veya döndür.");
  const geometry = useMemo(() => territory.geojson ?? createDemoGeometry(territory), [territory]);
  const bounds = useMemo(() => bbox(feature(geometry)), [geometry]);

  const fitTerritory = useCallback(() => {
    mapRef.current?.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 56, maxZoom: 16.5, duration: 450 });
  }, [bounds]);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: OPEN_FREE_MAP_STYLE,
        center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
        zoom: 14,
        pitch: 0,
        bearing: 0,
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: true },
        cooperativeGestures: true,
      });
    } catch {
      const failureFrame = window.requestAnimationFrame(() => {
        setReady(false);
        setMessage("Bu cihaz etkileşimli haritayı başlatamadı. WebGL desteğini kontrol et.");
      });
      return () => window.cancelAnimationFrame(failureFrame);
    }
    mapRef.current = map;
    let disposed = false;
    let loadTimer: number | null = window.setTimeout(() => {
      loadTimer = null;
      if (!disposed) setMessage("Harita katmanı zamanında yüklenemedi. Bağlantını kontrol et.");
    }, MAP_LOAD_TIMEOUT_MS);
    const handleLoad = () => {
      if (disposed) return;
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
      }
      map.addSource("selected-territory", { type: "geojson", data: feature(geometry) });
      map.addLayer({ id: "selected-territory-fill", type: "fill", source: "selected-territory", paint: { "fill-color": territory.color, "fill-opacity": 0.46 } });
      map.addLayer({ id: "selected-territory-line", type: "line", source: "selected-territory", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": territory.color, "line-width": 5 } });
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 56, maxZoom: 16.5, duration: 0 });
      setReady(true);
    };
    const handleMoveStart = () => {
      if (disposed) return;
      setSaved(false);
      setMessage("Kadraj değişti. Beğendiğinde kaydet.");
    };
    const handleError = () => {
      if (disposed) return;
      if (loadTimer !== null) {
        window.clearTimeout(loadTimer);
        loadTimer = null;
      }
      setMessage("Harita katmanı yüklenemedi. Bağlantını kontrol et.");
    };
    map.on("load", handleLoad);
    map.on("movestart", handleMoveStart);
    map.on("error", handleError);
    return () => {
      disposed = true;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      map.off("load", handleLoad);
      map.off("movestart", handleMoveStart);
      map.off("error", handleError);
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [bounds, geometry, territory.color]);

  async function saveFrame() {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      if (!map.loaded()) await waitForMapEvent(map, "idle", 1_800);
      if (mapRef.current !== map) return;
      await waitForMapEvent(map, "render", 1_800);
      if (mapRef.current !== map) return;
      const snapshot = captureFrameWithOwnerLabels(map, geometry, ownerUsername ?? territory.ownerUsername ?? "cayan");
      const center = map.getCenter();
      onSave(snapshot, { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
      setSaved(true);
      setMessage("Kadraj kaydedildi. İstersen yeniden ayarlayabilirsin.");
    } catch {
      if (mapRef.current !== map) return;
      if (territory.mapSnapshot) {
        const center = map.getCenter();
        onSave(territory.mapSnapshot, { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
        setSaved(true);
        setMessage("Kayıtlı güvenli harita kadrajı kullanıldı.");
      } else {
        setMessage("Kadraj kaydedilemedi. Harita tamamen yüklendiğinde tekrar dene.");
      }
    }
  }

  return (
    <section className="territory-frame-editor" aria-label={`${territory.name} paylaşım kadrajı`}>
      <header><div><span className="eyebrow">Paylaşım kadrajı</span><strong>{territory.name}</strong></div><span className={saved ? "is-saved" : ""}>{saved ? <Check size={15} /> : <Move size={15} />}{saved ? "Kaydedildi" : "Düzenleniyor"}</span></header>
      <div ref={containerRef} className="territory-frame-map" aria-label="Paylaşılacak harita kadrajını sürükleyerek ve yakınlaştırarak ayarla" />
      <footer>
        <p>{message}</p>
        <button type="button" className="secondary-button" onClick={fitTerritory} disabled={!ready}><LocateFixed size={17} /> Alanı ortala</button>
        <button type="button" className="secondary-button frame-reset-button" onClick={() => { mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 350 }); fitTerritory(); }} disabled={!ready}><RotateCcw size={16} /> Sıfırla</button>
        <button type="button" className="primary-button" onClick={() => void saveFrame()} disabled={!ready}><Check size={17} /> Kadrajı kaydet</button>
      </footer>
    </section>
  );
}
