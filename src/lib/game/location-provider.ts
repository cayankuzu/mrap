import type { Coordinate, LocationSample } from "@/lib/game/types";
import { headingFromGeolocation, normalizeHeading } from "@/lib/game/device-heading";

export type LocationListener = (sample: LocationSample) => void;
export type LocationErrorListener = (message: string) => void;

export interface LocationProvider {
  readonly kind: "real" | "simulation";
  start(onLocation: LocationListener, onError: LocationErrorListener): () => void;
}

export class RealLocationProvider implements LocationProvider {
  readonly kind = "real" as const;

  start(onLocation: LocationListener, onError: LocationErrorListener) {
    if (!navigator.geolocation) {
      onError("Bu tarayıcı konum özelliğini desteklemiyor.");
      return () => undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      (value) => {
        const headingDeg = headingFromGeolocation(value);
        onLocation({
          coordinate: [value.coords.longitude, value.coords.latitude],
          accuracyM: value.coords.accuracy,
          timestamp: value.timestamp,
          ...(headingDeg === null ? {} : { headingDeg }),
        });
      },
      (error) => onError(error.code === 1 ? "Konum izni reddedildi." : "Konum alınamadı."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }
}

export class SimulatedLocationProvider implements LocationProvider {
  readonly kind = "simulation" as const;
  private listener: LocationListener | null = null;
  private headingDeg: number | undefined;

  constructor(private coordinate: Coordinate) {}

  start(onLocation: LocationListener) {
    this.listener = onLocation;
    this.emit();
    return () => { this.listener = null; };
  }

  move(east: number, north: number, meters: number) {
    const latitude = this.coordinate[1];
    const nextHeading = normalizeHeading(Math.atan2(east, north) * 180 / Math.PI);
    if (nextHeading !== null && (east !== 0 || north !== 0)) this.headingDeg = nextHeading;
    this.coordinate = [
      this.coordinate[0] + east * meters / (111_320 * Math.cos(latitude * Math.PI / 180)),
      latitude + north * meters / 110_540,
    ];
    this.emit();
  }

  teleport(coordinate: Coordinate) {
    this.coordinate = coordinate;
    this.emit();
  }

  getCoordinate() {
    return this.coordinate;
  }

  private emit() {
    this.listener?.({ coordinate: this.coordinate, accuracyM: 0, timestamp: Date.now(), ...(this.headingDeg === undefined ? {} : { headingDeg: this.headingDeg }) });
  }
}
