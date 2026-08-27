import type { MultiPolygon, Polygon } from "geojson";
import { describe, expect, it, vi } from "vitest";
import type { GameConfig } from "@/lib/game/config";
import { LoopDetector } from "@/lib/game/loop-detector";
import type { Coordinate } from "@/lib/game/types";

const baseConfig: GameConfig["loop"] = {
  realProximityM: 12,
  simulatedProximityM: 4,
  minimumAreaM2: 35,
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

const territory: Polygon = {
  type: "Polygon",
  coordinates: [[
    [29, 41],
    [29.002, 41],
    [29.002, 41.002],
    [29, 41.002],
    [29, 41],
  ]],
};

describe("LoopDetector sınır ve hata davranışları", () => {
  it("yetersiz rotayı ve eşik dışındaki teması aday üretmeden yok sayar", () => {
    const detector = new LoopDetector(baseConfig);

    expect(detector.detect(squareRoute.slice(0, 3), "simulation", null, 10_000))
      .toEqual({ loop: null, diagnostic: null });

    const routeWithoutContact: Coordinate[] = [
      [29, 41],
      [29.001, 41],
      [29.001, 41.001],
      [29.002, 41.001],
      [29.002, 41.002],
    ];
    expect(detector.detect(routeWithoutContact, "simulation", null, 10_000))
      .toEqual({ loop: null, diagnostic: null });
  });

  it("aynı yaklaşık teması gerçek GPS toleransında kabul edip simülasyon toleransında reddeder", () => {
    const nearRoute: Coordinate[] = [
      [29, 41],
      [29.001, 41],
      [29.001, 41.001],
      [29, 41.001],
      [29.00009, 41.00007],
    ];

    const simulated = new LoopDetector(baseConfig).detect(nearRoute, "simulation", null, 10_000);
    const real = new LoopDetector(baseConfig).detect(nearRoute, "real", null, 10_000);

    expect(simulated).toEqual({ loop: null, diagnostic: null });
    expect(real.loop?.source).toBe("ACTIVE_ROUTE");
    expect(real.loop?.estimatedAreaM2).toBeGreaterThan(baseConfig.minimumAreaM2);
  });

  it("handled index, cooldown ve reset sınırlarını birbirinden bağımsız uygular", () => {
    const detector = new LoopDetector(baseConfig);
    const first = detector.detect(squareRoute, "simulation", null, 10_000);
    expect(first.loop).not.toBeNull();
    detector.markHandled(first.loop!, 10_000);

    const stillHandled = [...squareRoute, [29.00002, 41], [29.00003, 41], [29.00004, 41]] as Coordinate[];
    expect(detector.detect(stillHandled, "simulation", null, 12_000))
      .toEqual({ loop: null, diagnostic: null });

    const beyondHandled = [...stillHandled, [29.00005, 41]] as Coordinate[];
    expect(detector.detect(beyondHandled, "simulation", null, 10_500))
      .toEqual({ loop: null, diagnostic: null });

    detector.reset();
    expect(detector.detect(squareRoute, "simulation", null, 12_000).loop).not.toBeNull();
  });

  it("territory sınırına iki teması kısa sınır yolu üzerinden kapatır", () => {
    const forwardRoute: Coordinate[] = [
      [29.0002, 41],
      [29.0002, 40.9997],
      [28.9997, 40.9997],
      [29, 41.0002],
    ];
    const backwardRoute: Coordinate[] = [
      [29, 41.0002],
      [28.9997, 41.0002],
      [28.9997, 40.9997],
      [29.0002, 41],
    ];

    const forward = new LoopDetector(baseConfig).detect(forwardRoute, "simulation", territory, 20_000);
    const backward = new LoopDetector(baseConfig).detect(backwardRoute, "simulation", territory, 20_000);

    expect(forward.loop?.source).toBe("OWN_TERRITORY");
    expect(backward.loop?.source).toBe("OWN_TERRITORY");
    expect(forward.loop?.coordinates.at(0)).toEqual(forward.loop?.coordinates.at(-1));
    expect(backward.loop?.coordinates.at(0)).toEqual(backward.loop?.coordinates.at(-1));
  });

  it("territory başlangıcı aranırken sınırdan uzak ara noktaları atlar", () => {
    const route: Coordinate[] = [
      [29, 41.0002],
      [28.9995, 41.0002],
      [28.9995, 41.0008],
      [28.9995, 41.0015],
      [29, 41.0015],
    ];

    const result = new LoopDetector(baseConfig).detect(route, "simulation", territory, 25_000);

    expect(result.loop?.source).toBe("OWN_TERRITORY");
    expect(result.loop?.startIndex).toBe(0);
  });

  it("MultiPolygon içinde uzak parçayı atlayıp temas edilen açık halkayı kullanır", () => {
    const multiTerritory: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [[
          [30, 42],
          [30.001, 42],
          [30.001, 42.001],
          [30, 42.001],
          [30, 42],
        ]],
        [[
          [29, 41],
          [29.002, 41],
          [29.002, 41.002],
          [29, 41.002],
        ]],
      ],
    };
    const route: Coordinate[] = [
      [29, 41.0002],
      [28.9997, 41.0002],
      [28.9997, 40.9997],
      [29.0002, 41],
    ];

    const result = new LoopDetector(baseConfig).detect(route, "simulation", multiTerritory, 30_000);

    expect(result.loop?.source).toBe("OWN_TERRITORY");
    expect(result.loop?.validity).toBe(true);
  });

  it("az nokta, kısa rota, geçersiz polygon ve self-intersection nedenlerini ayırır", () => {
    const tooFew = new LoopDetector({
      ...baseConfig,
      minimumIndexGap: 2,
      minimumAreaM2: 0,
      minimumRouteLengthM: 0,
    }).detect([
      [29, 41],
      [29.001, 41],
      [29, 41],
    ], "simulation", null, 40_000);

    const tooShort = new LoopDetector({ ...baseConfig, minimumRouteLengthM: 1_000 })
      .detect(squareRoute, "simulation", null, 40_000);

    const invalidPolygon = new LoopDetector({ ...baseConfig, minimumIndexGap: 4 })
      .detect([
        [29, 41],
        [29.001, 41],
        [29, 41.001],
        [29.001, 41],
        [29, 41],
      ], "simulation", null, 40_000);

    const selfIntersection = new LoopDetector({ ...baseConfig, minimumIndexGap: 4 })
      .detect([
        [29, 41],
        [29.001, 41.001],
        [29, 41.001],
        [29.001, 41],
        [29, 41],
      ], "simulation", null, 40_000);

    expect(tooFew.diagnostic?.reason).toBe("TOO_FEW_POINTS");
    expect(tooShort.diagnostic?.reason).toBe("TOO_SHORT");
    expect(invalidPolygon.diagnostic?.reason).toBe("INVALID_POLYGON");
    expect(selfIntersection.diagnostic?.reason).toBe("SELF_INTERSECTION");
  });

  it("eski segment ucuna kesin temasta ardışık aynı koordinatı tekilleştirir", () => {
    const exactEndpointRoute: Coordinate[] = [
      [29, 41],
      [29.001, 41],
      [29.001, 41.001],
      [29.002, 41.0005],
      [29.001, 41],
    ];

    const result = new LoopDetector({ ...baseConfig, minimumIndexGap: 4 })
      .detect(exactEndpointRoute, "simulation", null, 50_000);

    expect(result.loop?.source).toBe("ACTIVE_ROUTE");
    expect(result.loop?.routeCoordinates.at(0)).toEqual([29.001, 41]);
    expect(result.loop?.routeCoordinates.at(1)).not.toEqual(result.loop?.routeCoordinates.at(0));
  });

  it("eşit uzaklıktaki kesin temas adaylarını en yeni segmente göre deterministik sıralar", () => {
    const route: Coordinate[] = [
      [29, 41],
      [29.002, 41],
      [29.002, 41.002],
      [29, 41.002],
      [29, 41.0005],
      [29.003, 41.0005],
    ];

    const result = new LoopDetector({ ...baseConfig, minimumIndexGap: 2 })
      .detect(route, "simulation", null, 60_000);

    expect(result.loop ?? result.diagnostic).not.toBeNull();
  });

  it("runtime UUID sağlayamadığında deterministik yerel loop kimliği üretir", () => {
    vi.stubGlobal("crypto", {});
    try {
      const result = new LoopDetector(baseConfig).detect(squareRoute, "simulation", null, 70_000);

      expect(result.loop?.id).toBe("70000-0-4");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
