import type { MultiPolygon, Polygon } from "geojson";
import { GAME_CONFIG } from "@/lib/game/config";
import { LoopDetector } from "@/lib/game/loop-detector";
import { RouteTracker } from "@/lib/game/route-tracker";
import type { GameSessionSnapshot, LocationMode, LocationSample, PotentialLoop } from "@/lib/game/types";

export class GameSession {
  private readonly tracker = new RouteTracker(GAME_CONFIG.location.minimumPointSpacingM);
  private readonly detector = new LoopDetector(GAME_CONFIG.loop);
  private state: GameSessionSnapshot["state"] = "IDLE";
  private potentialLoop: PotentialLoop | null = null;
  private diagnostic: GameSessionSnapshot["diagnostic"] = null;
  private claimCount = 0;

  start(sample: LocationSample) {
    this.tracker.start(sample);
    this.detector.reset();
    this.potentialLoop = null;
    this.diagnostic = null;
    this.claimCount = 0;
    this.state = "TRACKING";
    return this.snapshot();
  }

  addLocation(sample: LocationSample, mode: LocationMode, ownTerritory?: Polygon | MultiPolygon | null) {
    if (!["TRACKING", "LOOP_AVAILABLE", "CLAIMING"].includes(this.state)) return this.snapshot();
    if (!this.tracker.add(sample)) return this.snapshot();
    if (!this.potentialLoop && this.state !== "CLAIMING") {
      const detection = this.detector.detect(this.tracker.getCoordinates(), mode, ownTerritory);
      this.potentialLoop = detection.loop;
      this.diagnostic = detection.diagnostic;
      if (detection.loop) this.state = "LOOP_AVAILABLE";
    }
    return this.snapshot();
  }

  startNewSegment(sample: LocationSample) {
    if (!["TRACKING", "PAUSED", "LOOP_AVAILABLE"].includes(this.state)) return this.snapshot();
    this.tracker.startSegment(sample);
    this.detector.reset();
    this.potentialLoop = null;
    this.diagnostic = null;
    this.state = "TRACKING";
    return this.snapshot();
  }

  restore(samples: readonly LocationSample[], totalDistanceM: number, claimCount: number) {
    this.tracker.restoreSegment(samples, totalDistanceM);
    this.detector.reset();
    this.potentialLoop = null;
    this.diagnostic = null;
    this.claimCount = Number.isSafeInteger(claimCount) ? Math.max(0, claimCount) : 0;
    this.state = "TRACKING";
    return this.snapshot();
  }

  pause() {
    if (this.state === "TRACKING" || this.state === "LOOP_AVAILABLE") this.state = "PAUSED";
    return this.snapshot();
  }

  resume() {
    if (this.state === "PAUSED") this.state = this.potentialLoop ? "LOOP_AVAILABLE" : "TRACKING";
    return this.snapshot();
  }

  continueTracking() {
    if (this.potentialLoop) this.detector.markHandled(this.potentialLoop);
    this.potentialLoop = null;
    this.diagnostic = null;
    this.state = "TRACKING";
    return this.snapshot();
  }

  beginClaim() {
    if (!this.potentialLoop || !["LOOP_AVAILABLE", "PAUSED"].includes(this.state)) return null;
    this.state = "CLAIMING";
    return this.potentialLoop;
  }

  claimSucceeded() {
    if (this.potentialLoop) this.detector.markHandled(this.potentialLoop);
    this.potentialLoop = null;
    this.diagnostic = null;
    this.claimCount += 1;
    this.state = "TRACKING";
    return this.snapshot();
  }

  claimFailed() {
    if (this.potentialLoop) this.state = "LOOP_AVAILABLE";
    else this.state = "TRACKING";
    return this.snapshot();
  }

  stop() {
    this.potentialLoop = null;
    this.state = "FINISHED";
    return this.snapshot();
  }

  reset() {
    this.tracker.reset();
    this.detector.reset();
    this.state = "IDLE";
    this.potentialLoop = null;
    this.diagnostic = null;
    this.claimCount = 0;
    return this.snapshot();
  }

  snapshot(): GameSessionSnapshot {
    return {
      state: this.state,
      coordinates: this.tracker.getCoordinates(),
      totalDistanceM: this.tracker.getTotalDistanceM(),
      potentialLoop: this.potentialLoop,
      diagnostic: this.diagnostic,
      claimCount: this.claimCount,
    };
  }
}
