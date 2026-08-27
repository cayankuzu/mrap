import type { RegionPatchEvent, RegionSnapshot } from "@/lib/game/authoritative-types";

type RegionPhase = "buffering" | "live" | "desynced";
type RegionState = {
  phase: RegionPhase;
  lastAppliedVersion: number;
  minimumSnapshotVersion: number;
  buffered: RegionPatchEvent[];
  seenEventIds: Set<string>;
};

export type ReconcileDecision =
  | { action: "buffer" | "ignore"; regionId: string }
  | { action: "apply"; regionId: string; event: RegionPatchEvent }
  | { action: "refetch"; regionId: string };

export class RealtimeRegionReconciler {
  private readonly regions = new Map<string, RegionState>();

  begin(regionIds: readonly string[]) {
    const wanted = new Set(regionIds);
    for (const regionId of wanted) {
      if (!this.regions.has(regionId)) {
        this.regions.set(regionId, {
          phase: "buffering",
          lastAppliedVersion: 0,
          minimumSnapshotVersion: 0,
          buffered: [],
          seenEventIds: new Set(),
        });
      }
    }
    for (const regionId of this.regions.keys()) if (!wanted.has(regionId)) this.regions.delete(regionId);
  }

  receive(event: RegionPatchEvent): ReconcileDecision {
    const state = this.regions.get(event.regionId);
    if (!state || state.seenEventIds.has(event.eventId)) return { action: "ignore", regionId: event.regionId };
    state.seenEventIds.add(event.eventId);
    if (!isValidVersion(event.version) || !isValidVersion(event.previousVersion) || event.version !== event.previousVersion + 1) {
      return this.markDesynced(event.regionId, state, Math.max(state.lastAppliedVersion + 1, event.version));
    }
    if (state.phase === "buffering") {
      state.buffered.push(event);
      return { action: "buffer", regionId: event.regionId };
    }
    if (event.version <= state.lastAppliedVersion) return { action: "ignore", regionId: event.regionId };
    if (
      state.phase === "desynced"
      || event.requiresRefetch === true
      || event.version !== state.lastAppliedVersion + 1
      || event.previousVersion !== state.lastAppliedVersion
    ) {
      return this.markDesynced(event.regionId, state, event.version);
    }
    state.lastAppliedVersion = event.version;
    return { action: "apply", regionId: event.regionId, event };
  }

  applySnapshot(snapshot: RegionSnapshot) {
    const decisions: ReconcileDecision[] = [];
    for (const [regionId, version] of Object.entries(snapshot.versions)) {
      const state = this.regions.get(regionId);
      if (!state) continue;
      if (!isValidVersion(version)) {
        decisions.push(this.markDesynced(regionId, state, state.lastAppliedVersion + 1));
        continue;
      }
      if (version < state.lastAppliedVersion) {
        if (state.phase === "desynced") decisions.push({ action: "refetch", regionId });
        continue;
      }
      if (state.phase === "desynced" && version < state.minimumSnapshotVersion) {
        decisions.push({ action: "refetch", regionId });
        continue;
      }
      state.lastAppliedVersion = version;
      state.phase = "live";
      state.minimumSnapshotVersion = 0;
      const buffered = state.buffered.toSorted((a, b) => a.version - b.version);
      state.buffered = [];
      for (const event of buffered) {
        if (event.version <= state.lastAppliedVersion) continue;
        if (
          event.requiresRefetch === true
          || event.version !== state.lastAppliedVersion + 1
          || event.previousVersion !== state.lastAppliedVersion
        ) {
          decisions.push(this.markDesynced(regionId, state, event.version));
          break;
        }
        state.lastAppliedVersion = event.version;
        decisions.push({ action: "apply", regionId, event });
      }
      state.seenEventIds.clear();
    }
    return decisions;
  }

  private markDesynced(regionId: string, state: RegionState, minimumSnapshotVersion: number): ReconcileDecision {
    state.phase = "desynced";
    if (isValidVersion(minimumSnapshotVersion)) {
      state.minimumSnapshotVersion = Math.max(state.minimumSnapshotVersion, minimumSnapshotVersion);
    }
    return { action: "refetch", regionId };
  }

  version(regionId: string) {
    return this.regions.get(regionId)?.lastAppliedVersion ?? 0;
  }

  isDesynced(regionId: string) {
    return this.regions.get(regionId)?.phase === "desynced";
  }
}

function isValidVersion(version: number) {
  return Number.isSafeInteger(version) && version >= 0;
}
