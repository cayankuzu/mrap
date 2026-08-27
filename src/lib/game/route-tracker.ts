import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type { Coordinate, LocationSample } from "@/lib/game/types";

export class RouteTracker {
  private coordinates: Coordinate[] = [];
  private totalDistanceM = 0;

  constructor(private readonly minimumPointSpacingM: number) {}

  start(sample: LocationSample) {
    this.coordinates = [sample.coordinate];
    this.totalDistanceM = 0;
  }

  startSegment(sample: LocationSample) {
    this.coordinates = [sample.coordinate];
  }

  restoreSegment(samples: readonly LocationSample[], totalDistanceM: number) {
    this.coordinates = samples.map((sample) => sample.coordinate);
    this.totalDistanceM = Number.isFinite(totalDistanceM) ? Math.max(0, totalDistanceM) : 0;
  }

  add(sample: LocationSample) {
    const previous = this.coordinates.at(-1);
    if (!previous) {
      this.start(sample);
      return true;
    }
    const deltaM = distance(point(previous), point(sample.coordinate), { units: "meters" });
    if (deltaM < this.minimumPointSpacingM) return false;
    this.coordinates = [...this.coordinates, sample.coordinate];
    this.totalDistanceM += deltaM;
    return true;
  }

  reset() {
    this.coordinates = [];
    this.totalDistanceM = 0;
  }

  getCoordinates() {
    return [...this.coordinates];
  }

  getTotalDistanceM() {
    return this.totalDistanceM;
  }
}
