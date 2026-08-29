import { MapPin, Route } from "lucide-react";
import { DeferredTerritoryInteractiveMap } from "@/components/DeferredTerritoryInteractiveMap";
import type { Territory } from "@/lib/data";
import type { MapCameraState } from "@/lib/map-preview";

export function MapSnapshot({ territory, compact = false, ownerHandle, mapView }: { territory: Territory; compact?: boolean; ownerHandle?: string; snapshotSrc?: string | null; mapView?: MapCameraState | null }) {
  return (
    <div className={`map-snapshot${compact ? " map-snapshot--compact" : ""}`}>
      <DeferredTerritoryInteractiveMap territory={territory} ownerUsername={ownerHandle ?? "mrap"} mapView={mapView} compact={compact} />
      <div className="snapshot-meta">
        <div>
          <span className="snapshot-kicker"><Route size={14} /> ALAN KAYDI</span>
          <strong>{territory.name}</strong>
          <small className="snapshot-location"><MapPin size={12} /> {territory.district}</small>
        </div>
        <div className="snapshot-stats">
          <span><small>Mesafe</small>{territory.distance}</span>
          <span><small>Süre</small>{territory.duration}</span>
          <span><small>Alan</small>{territory.area}</span>
        </div>
      </div>
    </div>
  );
}
