import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("feed harita performans sınırı", () => {
  it("akış bileşenleri MapLibre haritasını statik olarak ana pakete taşımaz", () => {
    expect(source("src/components/RealFeed.tsx")).not.toContain('from "@/components/TerritoryInteractiveMap"');
    expect(source("src/components/MapSnapshot.tsx")).not.toContain('from "@/components/TerritoryInteractiveMap"');
  });

  it("gerçek etkileşimli haritayı ayrı ve tembel bir parçadan yükler", () => {
    const deferredSource = source("src/components/DeferredTerritoryInteractiveMap.tsx");
    expect(deferredSource).toContain('lazy(() => import("@/components/TerritoryInteractiveMap")');
    expect(deferredSource).toContain("requestIdleCallback");
    expect(deferredSource).toContain("activateAndOpen");
  });
});
