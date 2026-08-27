import { useEffect, useRef } from "react";

export const MRAP_REFRESH_EVENT = "mrap:refresh";

export type MrapRefreshScope = "screen" | "panel";
export type MrapRefreshSource = "button" | "pull";
export type MrapRefreshDetail = { source: MrapRefreshSource; scope: MrapRefreshScope };

export function readMrapRefreshDetail(event: Event): MrapRefreshDetail | null {
  if (event.type !== MRAP_REFRESH_EVENT) return null;
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") return null;
  const candidate = detail as Partial<MrapRefreshDetail>;
  if (candidate.source !== "button" && candidate.source !== "pull") return null;
  if (candidate.scope !== "screen" && candidate.scope !== "panel") return null;
  return { source: candidate.source, scope: candidate.scope };
}

export function dispatchMrapRefresh(target: EventTarget, detail: MrapRefreshDetail) {
  return target.dispatchEvent(new CustomEvent<MrapRefreshDetail>(MRAP_REFRESH_EVENT, { detail }));
}

export function useMrapRefresh(scope: MrapRefreshScope, enabled: boolean, onRefresh: (detail: MrapRefreshDetail) => void) {
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    const handleRefresh = (event: Event) => {
      const detail = readMrapRefreshDetail(event);
      if (detail?.scope === scope) onRefreshRef.current(detail);
    };
    window.addEventListener(MRAP_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(MRAP_REFRESH_EVENT, handleRefresh);
  }, [enabled, scope]);
}
