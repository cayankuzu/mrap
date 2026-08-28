import { describe, expect, it } from "vitest";
import { GameSession } from "@/lib/game/game-session";
import type { Coordinate, LocationSample } from "@/lib/game/types";

function sample(longitude: number, timestamp: number): LocationSample {
  return { coordinate: [longitude, 41], accuracyM: 3, timestamp };
}

function coordinateSample(coordinate: Coordinate, timestamp: number): LocationSample {
  return { coordinate, accuracyM: 0, timestamp };
}

describe("GameSession rota segmentleri", () => {
  it("arka plan dönüşünde aktif çizgiyi sıfırlar ama toplam mesafeyi korur", () => {
    const session = new GameSession();
    session.start(sample(29, 1_000));
    const beforeBreak = session.addLocation(sample(29.0001, 2_000), "real");

    const resumed = session.startNewSegment(sample(30, 3_000));
    const afterResume = session.addLocation(sample(30.0001, 4_000), "real");

    expect(beforeBreak.totalDistanceM).toBeGreaterThan(0);
    expect(resumed.state).toBe("TRACKING");
    expect(resumed.coordinates).toEqual([[30, 41]]);
    expect(resumed.totalDistanceM).toBeCloseTo(beforeBreak.totalDistanceM, 6);
    expect(afterResume.coordinates).toEqual([[30, 41], [30.0001, 41]]);
    expect(afterResume.totalDistanceM).toBeGreaterThan(beforeBreak.totalDistanceM);
    expect(afterResume.totalDistanceM).toBeLessThan(30);
  });

  it("claim sonrasında eski çizgiyi kapatıp aynı oturumda bağımsız ikinci loopu algılar", () => {
    const session = new GameSession();
    const firstLoop: Coordinate[] = [
      [29, 41], [29.001, 41], [29.001, 41.001], [29, 41.001], [29, 41],
    ];
    session.start(coordinateSample(firstLoop[0], 1_000));
    let snapshot = session.snapshot();
    for (let index = 1; index < firstLoop.length; index += 1) {
      snapshot = session.addLocation(coordinateSample(firstLoop[index], 1_000 + index * 1_000), "simulation");
    }
    expect(snapshot.state).toBe("LOOP_AVAILABLE");
    expect(session.beginClaim()).not.toBeNull();

    const afterFirstClaim = session.claimSucceeded();
    expect(afterFirstClaim.coordinates).toEqual([[29, 41]]);
    expect(afterFirstClaim.claimCount).toBe(1);
    const distanceAfterFirst = afterFirstClaim.totalDistanceM;

    const secondLoop: Coordinate[] = [
      [29, 41], [28.999, 41], [28.999, 41.001], [29, 41.001], [29, 41],
    ];
    for (let index = 1; index < secondLoop.length; index += 1) {
      snapshot = session.addLocation(coordinateSample(secondLoop[index], 10_000 + index * 1_000), "simulation");
    }

    expect(snapshot.state).toBe("LOOP_AVAILABLE");
    expect(snapshot.potentialLoop?.startIndex).toBe(0);
    expect(snapshot.totalDistanceM).toBeGreaterThan(distanceAfterFirst);
    expect(session.beginClaim()).not.toBeNull();
    expect(session.claimSucceeded().claimCount).toBe(2);
  });
});
