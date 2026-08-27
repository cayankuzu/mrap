import { describe, expect, it } from "vitest";
import { GameSession } from "@/lib/game/game-session";
import type { LocationSample } from "@/lib/game/types";

function sample(longitude: number, timestamp: number): LocationSample {
  return { coordinate: [longitude, 41], accuracyM: 3, timestamp };
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
});
