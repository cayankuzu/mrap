"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { evaluatePullGesture } from "@/lib/pull-to-refresh";

const MOBILE_QUERY = "(max-width: 900px)";
const REFRESH_IGNORE_SELECTOR = [
  "button",
  "a",
  "label",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  "[data-no-pull]",
  "[data-pull-refresh-ignore]",
  ".maplibregl-map",
  ".game-map-viewport",
  ".territory-frame-map",
  ".post-media-strip",
  ".lightbox-photo-swipe-surface",
  ".color-palette-track",
  ".upload-preview-grid",
].join(",");

type RefreshScope = "screen" | "panel";
type PullSession = {
  startX: number;
  startY: number;
  scrollContainer: HTMLElement | null;
  scope: RefreshScope;
  cancelled: boolean;
  ready: boolean;
};

function nearestVerticalScrollContainer(target: Element) {
  let element: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
  while (element && element !== document.body && element !== document.documentElement) {
    const { overflowY } = window.getComputedStyle(element);
    if (/auto|scroll/.test(overflowY) && element.scrollHeight > element.clientHeight + 1) return element;
    element = element.parentElement;
  }
  return null;
}

function isAtTop(scrollContainer: HTMLElement | null, scope: RefreshScope) {
  if (scrollContainer) return scrollContainer.scrollTop <= 0;
  // A modal/panel owns its own refresh surface. The document behind it may
  // remain scrolled to the trigger, which must not block a pull that starts on
  // the panel header. Scrollable panel bodies are still checked above.
  if (scope === "panel") return true;
  return (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;
}

function refreshScope(target: Element): RefreshScope {
  return target.closest("[role='dialog'], .connection-modal, .composer-modal, .game-session-card, .developer-panel")
    ? "panel"
    : "screen";
}

export function PullToRefresh({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: (scope: RefreshScope) => void }) {
  const [pull, setPull] = useState({ distance: 0, progress: 0, ready: false, scope: "screen" as RefreshScope });
  const sessionRef = useRef<PullSession | null>(null);
  const refreshingRef = useRef(refreshing);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const mobile = window.matchMedia(MOBILE_QUERY);
    let listeningForMove = false;

    function stopListeningForMove() {
      if (!listeningForMove) return;
      document.removeEventListener("touchmove", move, true);
      listeningForMove = false;
    }

    function listenForMove() {
      if (listeningForMove) return;
      document.addEventListener("touchmove", move, { passive: false, capture: true });
      listeningForMove = true;
    }

    function reset() {
      stopListeningForMove();
      sessionRef.current = null;
      setPull({ distance: 0, progress: 0, ready: false, scope: "screen" });
    }

    function start(event: TouchEvent) {
      if (!mobile.matches || refreshingRef.current || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(REFRESH_IGNORE_SELECTOR)) return;
      const scope = refreshScope(target);
      const scrollContainer = nearestVerticalScrollContainer(target);
      if (!isAtTop(scrollContainer, scope)) return;
      const touch = event.touches[0];
      sessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        scrollContainer,
        scope,
        cancelled: false,
        ready: false,
      };
      // Non-passive dinleyici yalnızca sayfanın tepesinde başlayan olası bir
      // pull hareketi boyunca vardır; normal mobil kaydırma yolu bloklanmaz.
      listenForMove();
    }

    function move(event: TouchEvent) {
      const session = sessionRef.current;
      if (!session || session.cancelled || event.touches.length !== 1) return;
      if (!isAtTop(session.scrollContainer, session.scope)) {
        session.cancelled = true;
        stopListeningForMove();
        setPull({ distance: 0, progress: 0, ready: false, scope: session.scope });
        return;
      }
      const touch = event.touches[0];
      const gesture = evaluatePullGesture(touch.clientX - session.startX, touch.clientY - session.startY);
      if (gesture.phase === "cancelled") {
        session.cancelled = true;
        stopListeningForMove();
        setPull({ distance: 0, progress: 0, ready: false, scope: session.scope });
        return;
      }
      if (gesture.phase !== "pulling") return;
      if (event.cancelable) event.preventDefault();
      session.ready = gesture.ready;
      setPull({ distance: gesture.visualDistance, progress: gesture.progress, ready: gesture.ready, scope: session.scope });
    }

    function finish() {
      const session = sessionRef.current;
      const shouldRefresh = Boolean(session && !session.cancelled && session.ready && !refreshingRef.current);
      const scope = session?.scope ?? "screen";
      reset();
      if (shouldRefresh) onRefreshRef.current(scope);
    }

    document.addEventListener("touchstart", start, { passive: true, capture: true });
    document.addEventListener("touchend", finish, { passive: true, capture: true });
    document.addEventListener("touchcancel", reset, { passive: true, capture: true });
    return () => {
      document.removeEventListener("touchstart", start, true);
      stopListeningForMove();
      document.removeEventListener("touchend", finish, true);
      document.removeEventListener("touchcancel", reset, true);
    };
  }, []);

  const active = refreshing || pull.distance > 0;
  const label = refreshing ? "İçerik yenileniyor" : pull.ready ? "Yenilemek için bırak" : "Yenilemek için aşağı çek";
  return (
    <output
      className={`pull-refresh-indicator${active ? " is-visible" : ""}${refreshing ? " is-refreshing" : ""}${pull.scope === "panel" ? " is-panel" : ""}`}
      style={{ "--pull-distance": `${pull.distance}px`, "--pull-progress": pull.progress } as React.CSSProperties}
      aria-live="polite"
      aria-hidden={!active}
      data-pull-state={refreshing ? "refreshing" : pull.ready ? "ready" : active ? "pulling" : "idle"}
    >
      <RefreshCw size={17} aria-hidden="true" />
      <span>{label}</span>
    </output>
  );
}
