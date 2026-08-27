import { describe, expect, it } from "vitest";
import type {
  RegionPatchCell,
  RegionPatchEvent,
  RegionSnapshot,
} from "@/lib/game/authoritative-types";
import {
  RealtimeRegionReconciler,
  type ReconcileDecision,
} from "@/lib/realtime/region-reconciler";

const REGION = "12/2377/1534";

function event(
  version: number,
  previousVersion = version - 1,
  overrides: Partial<RegionPatchEvent> = {},
): RegionPatchEvent {
  return {
    eventId: `event-${version}`,
    type: "region_patch",
    worldId: "world-1",
    regionId: REGION,
    previousVersion,
    version,
    claimEventId: `claim-${version}`,
    changedCells: [{ cellId: `15/19000/${version}`, ownerId: `owner-${version}`, paintColorId: null }],
    committedAtServer: `2026-08-27T12:00:${String(version).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

function snapshot(version: number): RegionSnapshot {
  return {
    worldId: "world-1",
    versions: { [REGION]: version },
    generatedAtServer: "2026-08-27T12:01:00.000Z",
  };
}

function applyDecisions(cells: Map<string, RegionPatchCell>, decisions: readonly ReconcileDecision[]) {
  for (const decision of decisions) {
    if (decision.action !== "apply") continue;
    for (const cell of decision.event.changedCells ?? []) cells.set(cell.cellId, cell);
  }
}

function stateHash(cells: Map<string, RegionPatchCell>) {
  return JSON.stringify([...cells.entries()].toSorted(([left], [right]) => left.localeCompare(right)));
}

describe("RealtimeRegionReconciler", () => {
  it("11 — broadcast API snapshot cevabından önce gelirse buffer üzerinden uygular", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);

    expect(reconciler.receive(event(6))).toEqual({ action: "buffer", regionId: REGION });
    const decisions = reconciler.applySnapshot(snapshot(5));

    expect(decisions).toEqual([{ action: "apply", regionId: REGION, event: event(6) }]);
    expect(reconciler.version(REGION)).toBe(6);
    expect(reconciler.isDesynced(REGION)).toBe(false);
  });

  it("12 — API snapshot cevabı broadcastten önce gelirse patch'i doğrudan uygular", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    expect(reconciler.applySnapshot(snapshot(5))).toEqual([]);

    expect(reconciler.receive(event(6))).toEqual({ action: "apply", regionId: REGION, event: event(6) });
    expect(reconciler.version(REGION)).toBe(6);
  });

  it("13 — duplicate broadcast yalnızca bir kez uygulanır", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(5));
    const patch = event(6);

    expect(reconciler.receive(patch).action).toBe("apply");
    expect(reconciler.receive(patch)).toEqual({ action: "ignore", regionId: REGION });
    expect(reconciler.version(REGION)).toBe(6);
  });

  it("14 — ters sırada bufferlanan ardışık patchleri version sırasıyla uygular", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);

    expect(reconciler.receive(event(7, 6)).action).toBe("buffer");
    expect(reconciler.receive(event(6, 5)).action).toBe("buffer");
    const decisions = reconciler.applySnapshot(snapshot(5));

    expect(decisions.map((decision) => decision.action === "apply" ? decision.event.version : decision.action)).toEqual([6, 7]);
    expect(reconciler.version(REGION)).toBe(7);
  });

  it("15 — region version boşluğunu uygulatmak yerine desync ve refetch üretir", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(5));

    expect(reconciler.receive(event(7, 6))).toEqual({ action: "refetch", regionId: REGION });
    expect(reconciler.version(REGION)).toBe(5);
    expect(reconciler.isDesynced(REGION)).toBe(true);
  });

  it("16 — bağlantı kopukken kaçırılan üç değişikliği yeni snapshot ile yakalar", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(2));

    reconciler.begin([]);
    expect(reconciler.receive(event(3, 2)).action).toBe("ignore");
    expect(reconciler.receive(event(4, 3)).action).toBe("ignore");
    expect(reconciler.receive(event(5, 4)).action).toBe("ignore");

    reconciler.begin([REGION]);
    expect(reconciler.applySnapshot(snapshot(5))).toEqual([]);
    expect(reconciler.version(REGION)).toBe(5);
    expect(reconciler.receive(event(6, 5)).action).toBe("apply");
  });

  it("17 — reconnect sırasında yeterince yeni olmayan snapshotı reddedip güncel snapshotta convergence sağlar", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(3));
    expect(reconciler.receive(event(5, 4)).action).toBe("refetch");

    expect(reconciler.applySnapshot(snapshot(4))).toEqual([{ action: "refetch", regionId: REGION }]);
    expect(reconciler.version(REGION)).toBe(3);
    expect(reconciler.isDesynced(REGION)).toBe(true);

    expect(reconciler.applySnapshot(snapshot(5))).toEqual([]);
    expect(reconciler.version(REGION)).toBe(5);
    expect(reconciler.isDesynced(REGION)).toBe(false);
  });

  it("18 — farklı API/broadcast sıraları iki clientta aynı final map hashini üretir", () => {
    const beforeApi = new RealtimeRegionReconciler();
    const afterApi = new RealtimeRegionReconciler();
    const beforeApiCells = new Map<string, RegionPatchCell>();
    const afterApiCells = new Map<string, RegionPatchCell>();
    const baseCell: RegionPatchCell = { cellId: "15/19000/5", ownerId: "owner-5", paintColorId: null };
    const patches = [event(6, 5), event(7, 6)];
    beforeApi.begin([REGION]);
    afterApi.begin([REGION]);

    for (const patch of patches) beforeApi.receive(patch);
    beforeApiCells.set(baseCell.cellId, baseCell);
    applyDecisions(beforeApiCells, beforeApi.applySnapshot(snapshot(5)));

    afterApiCells.set(baseCell.cellId, baseCell);
    afterApi.applySnapshot(snapshot(5));
    for (const patch of patches) applyDecisions(afterApiCells, [afterApi.receive(patch)]);

    expect(beforeApi.version(REGION)).toBe(7);
    expect(afterApi.version(REGION)).toBe(7);
    expect(stateHash(beforeApiCells)).toBe(stateHash(afterApiCells));
  });

  it("19 — changedCells taşımayan büyük patch işaretinde incremental apply yerine refetch ister", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(5));
    const largePatch = event(6, 5, { requiresRefetch: true, changedCells: undefined });

    expect(reconciler.receive(largePatch)).toEqual({ action: "refetch", regionId: REGION });
    expect(reconciler.version(REGION)).toBe(5);
    expect(reconciler.applySnapshot(snapshot(5))).toEqual([{ action: "refetch", regionId: REGION }]);
    expect(reconciler.applySnapshot(snapshot(6))).toEqual([]);
    expect(reconciler.version(REGION)).toBe(6);
    expect(reconciler.isDesynced(REGION)).toBe(false);
  });

  it("20 — eski broadcast veya snapshot daha yeni state'i geri alamaz", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(10));
    expect(reconciler.receive(event(11, 10)).action).toBe("apply");

    expect(reconciler.applySnapshot(snapshot(9))).toEqual([]);
    expect(reconciler.receive(event(10, 9, { eventId: "late-event-10" }))).toEqual({ action: "ignore", regionId: REGION });
    expect(reconciler.version(REGION)).toBe(11);
    expect(reconciler.isDesynced(REGION)).toBe(false);
  });

  it("aynı eventId farklı regionlarda birbirini yanlışlıkla duplicate saydırmaz", () => {
    const otherRegion = "12/2378/1534";
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION, otherRegion]);
    reconciler.applySnapshot({ ...snapshot(5), versions: { [REGION]: 5, [otherRegion]: 8 } });
    const first = event(6, 5, { eventId: "shared-event" });
    const second = event(9, 8, { eventId: "shared-event", regionId: otherRegion });

    expect(reconciler.receive(first).action).toBe("apply");
    expect(reconciler.receive(second).action).toBe("apply");
    expect(reconciler.version(REGION)).toBe(6);
    expect(reconciler.version(otherRegion)).toBe(9);
  });

  it("takip edilmeyen region olayını ignore eder ve sonraki aboneliği zehirlemez", () => {
    const reconciler = new RealtimeRegionReconciler();
    const patch = event(1, 0);

    expect(reconciler.receive(patch)).toEqual({ action: "ignore", regionId: REGION });
    reconciler.begin([REGION]);
    expect(reconciler.receive(patch)).toEqual({ action: "buffer", regionId: REGION });
    expect(reconciler.applySnapshot(snapshot(0)).map((decision) => decision.action)).toEqual(["apply"]);
  });

  it("geçersiz version zincirini uygulamaz", () => {
    const reconciler = new RealtimeRegionReconciler();
    reconciler.begin([REGION]);
    reconciler.applySnapshot(snapshot(5));

    expect(reconciler.receive(event(6, 4))).toEqual({ action: "refetch", regionId: REGION });
    expect(reconciler.version(REGION)).toBe(5);
  });
});
