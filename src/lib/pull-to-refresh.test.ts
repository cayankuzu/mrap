import { describe, expect, it } from "vitest";
import { evaluatePullGesture, PULL_TO_REFRESH_CONFIG } from "@/lib/pull-to-refresh";

describe("mobil çekerek yenileme hareketi", () => {
  it("küçük aşağı hareketi kaydırma niyeti oluşana kadar bekletir", () => {
    expect(evaluatePullGesture(0, PULL_TO_REFRESH_CONFIG.intentDistance - 1)).toMatchObject({
      phase: "pending",
      ready: false,
      visualDistance: 0,
    });
  });

  it("yatay galeri hareketini iptal eder", () => {
    expect(evaluatePullGesture(50, 24)).toMatchObject({ phase: "cancelled", ready: false });
  });

  it("eşik altındaki dikey çekişi görselleştirir ama yenilemez", () => {
    const gesture = evaluatePullGesture(4, PULL_TO_REFRESH_CONFIG.activationDistance - 1);
    expect(gesture.phase).toBe("pulling");
    expect(gesture.progress).toBeLessThan(1);
    expect(gesture.ready).toBe(false);
  });

  it("eşikte tek bir yenileme fırsatı üretir ve görsel mesafeyi sınırlar", () => {
    const threshold = evaluatePullGesture(2, PULL_TO_REFRESH_CONFIG.activationDistance);
    const longPull = evaluatePullGesture(2, 500);
    expect(threshold).toMatchObject({ phase: "pulling", progress: 1, ready: true });
    expect(longPull.visualDistance).toBe(PULL_TO_REFRESH_CONFIG.maximumVisualDistance);
  });

  it("yukarı hareketi yenileme olarak kabul etmez", () => {
    expect(evaluatePullGesture(0, -30)).toMatchObject({ phase: "cancelled", ready: false });
  });
});

