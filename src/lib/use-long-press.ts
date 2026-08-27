"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

export function useLongPress(onPress: () => void, onLongPress: () => void, delayMs = 500) {
  const timerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const onPressRef = useRef(onPress);
  const onLongPressRef = useRef(onLongPress);

  useEffect(() => { onPressRef.current = onPress; }, [onPress]);
  useEffect(() => { onLongPressRef.current = onLongPress; }, [onLongPress]);
  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function cancelTimer() {
    if (!timerRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cancelTimer();
      longPressTriggeredRef.current = false;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        longPressTriggeredRef.current = true;
        onLongPressRef.current();
      }, delayMs);
    },
    onPointerUp: cancelTimer,
    onPointerCancel: cancelTimer,
    onPointerLeave: cancelTimer,
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== " " || event.repeat) return;
      cancelTimer();
      longPressTriggeredRef.current = false;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        longPressTriggeredRef.current = true;
        onLongPressRef.current();
      }, delayMs);
    },
    onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key === " ") cancelTimer();
    },
    onBlur() {
      cancelTimer();
    },
    onClick(event: MouseEvent<HTMLButtonElement>) {
      if (longPressTriggeredRef.current) {
        event.preventDefault();
        longPressTriggeredRef.current = false;
        return;
      }
      onPressRef.current();
    },
    onContextMenu(event: MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      cancelTimer();
      if (longPressTriggeredRef.current) return;
      longPressTriggeredRef.current = true;
      onLongPressRef.current();
    },
  };
}
