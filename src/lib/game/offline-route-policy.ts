import type { AuthoritativeUiState } from "@/lib/game/authoritative-types";

export type LocationCaptureDisposition = "authoritative_online" | "personal_offline_draft";

/** Offline/unknown-network samples must never enter the competitive point command stream. */
export function locationCaptureDisposition(
  browserOnline: boolean,
  authoritativeState: AuthoritativeUiState,
): LocationCaptureDisposition {
  return browserOnline && authoritativeState !== "PAUSED_OFFLINE"
    ? "authoritative_online"
    : "personal_offline_draft";
}

export function requiresOnlineSegmentBoundary(offlineDraftPointCount: number) {
  return Number.isSafeInteger(offlineDraftPointCount) && offlineDraftPointCount > 0;
}
