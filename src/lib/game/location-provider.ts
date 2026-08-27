import type { Coordinate, LocationSample } from "@/lib/game/types";

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
      (value) => onLocation({ coordinate: [value.coords.longitude, value.coords.latitude], accuracyM: value.coords.accuracy, timestamp: value.timestamp }),
      (error) => onError(error.code === 1 ? "Konum izni reddedildi." : "Konum alınamadı."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }
}

export class SimulatedLocationProvider implements LocationProvider {
  readonly kind = "simulation" as const;
  private listener: LocationListener | null = null;

  constructor(private coordinate: Coordinate) {}

  start(onLocation: LocationListener) {
    this.listener = onLocation;
    this.emit();
    return () => { this.listener = null; };
  }

  move(east: number, north: number, meters: number) {
    const latitude = this.coordinate[1];
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
    this.listener?.({ coordinate: this.coordinate, accuracyM: 0, timestamp: Date.now() });
  }
}
