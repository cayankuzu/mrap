import { describe, expect, it } from "vitest";
import type { GameConfig } from "@/lib/game/config";
import { LoopDetector } from "@/lib/game/loop-detector";
import type { Coordinate } from "@/lib/game/types";

const baseLoopConfig: GameConfig["loop"] = {
  realProximityM: 12,
  simulatedProximityM: 4,
  minimumAreaM2: 50,
  minimumRouteLengthM: 10,
  minimumIndexGap: 3,
  detectionCooldownMs: 1_000,
};

const squareRoute: Coordinate[] = [
  [29, 41],
  [29.001, 41],
  [29.001, 41.001],
  [29, 41.001],
  [29.00001, 41],
];

describe("LoopDetector", () => {
  it("başlangıç noktasına tam dönmeden aktif rotaya temas eden geçerli döngüyü bulur", () => {
    const detector = new LoopDetector(baseLoopConfig);
    const result = detector.detect(squareRoute, "simulation", null, 10_000);

    expect(result.diagnostic).toBeNull();
    expect(result.loop).not.toBeNull();
    expect(result.loop?.source).toBe("ACTIVE_ROUTE");
    expect(result.loop?.startIndex).toBe(0);
    expect(result.loop?.endIndex).toBe(squareRoute.length - 1);
    expect(result.loop?.estimatedAreaM2).toBeGreaterThan(baseLoopConfig.minimumAreaM2);
    expect(result.loop?.coordinates.at(0)).toEqual(result.loop?.coordinates.at(-1));
  });

  it("yakınlık toleransındaki küçük GPS titreşimini alan olarak kabul etmez", () => {
    const detector = new LoopDetector({
      ...baseLoopConfig,
      minimumAreaM2: 100,
      minimumRouteLengthM: 0.1,
    });
    const jitterRoute: Coordinate[] = [
      [29, 41],
      [29.00001, 41],
      [29.00001, 41.00001],
      [29, 41.00001],
      [29.000001, 41],
    ];

    const result = detector.detect(jitterRoute, "simulation", null, 10_000);

    expect(result.loop).toBeNull();
    expect(result.diagnostic?.reason).toBe("TOO_SMALL");
  });

  it("geometrik olarak geçerli olsa da minimum alanın altındaki döngüyü reddeder", () => {
    const detector = new LoopDetector({ ...baseLoopConfig, minimumAreaM2: 50_000 });
    const result = detector.detect(squareRoute, "simulation", null, 10_000);

    expect(result.loop).toBeNull();
    expect(result.diagnostic?.reason).toBe("TOO_SMALL");
  });

  it("işlenen döngüyü cooldown süresinde yeniden sunmaz", () => {
    const detector = new LoopDetector(baseLoopConfig);
    const first = detector.detect(squareRoute, "simulation", null, 10_000);
    expect(first.loop).not.toBeNull();

    detector.markHandled(first.loop!, 10_000);
    const repeated = detector.detect([...squareRoute, [29.00002, 41]], "simulation", null, 10_500);

    expect(repeated).toEqual({ loop: null, diagnostic: null });
  });
});
