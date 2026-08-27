"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/features/security/turnstile/server-config";

type ChallengeState = "idle" | "loading" | "verified" | "expired" | "error";

type TurnstileWidgetApi = Readonly<{
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}>;

declare global {
  interface Window {
    turnstile?: TurnstileWidgetApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY?.trim() ?? "";

export function turnstileIsConfiguredForClient() {
  return Boolean(SITE_KEY);
}

export function TurnstileChallenge({
  action,
  onTokenChange,
  resetKey,
}: Readonly<{
  action: TurnstileAction;
  onTokenChange: (token: string | null) => void;
  resetKey: number;
}>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [state, setState] = useState<ChallengeState>("idle");

  const clearToken = useCallback((nextState: ChallengeState) => {
    onTokenChange(null);
    setState(nextState);
  }, [onTokenChange]);

  useEffect(() => {
    if (!SITE_KEY || !scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
    let active = true;
    setState("loading");
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        action,
        theme: "auto",
        language: "tr",
        size: "flexible",
        appearance: "interaction-only",
        callback: (token: string) => {
          onTokenChange(token);
          setState("verified");
        },
        "expired-callback": () => clearToken("expired"),
        "timeout-callback": () => clearToken("expired"),
        "error-callback": () => {
          clearToken("error");
          return true;
        },
      });
    } catch {
      // Defer render-failure state until external widget synchronization has
      // left the effect body; this avoids a cascading synchronous render.
      queueMicrotask(() => {
        if (active) clearToken("error");
      });
    }
    return () => { active = false; };
  }, [action, clearToken, onTokenChange, scriptReady]);

  useEffect(() => {
    if (!SITE_KEY || resetKey === 0 || !widgetIdRef.current || !window.turnstile) return;
    clearToken("loading");
    window.turnstile.reset(widgetIdRef.current);
  }, [clearToken, resetKey]);

  useEffect(() => () => {
    if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    widgetIdRef.current = null;
  }, []);

  if (!SITE_KEY) return null;

  const stateMessage = state === "verified"
    ? "Güvenlik doğrulaması tamamlandı."
    : state === "expired"
      ? "Doğrulamanın süresi doldu; lütfen yeniden tamamla."
      : state === "error"
        ? "Güvenlik doğrulaması yüklenemedi; lütfen yeniden dene."
        : "Güvenlik doğrulaması hazırlanıyor.";

  return (
    <div className="turnstile-challenge">
      <Script
        id="mrap-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => clearToken("error")}
      />
      <div ref={containerRef} className="turnstile-widget" aria-label="Bot koruması" />
      <p className={`turnstile-state is-${state}`} role={state === "error" || state === "expired" ? "alert" : "status"} aria-live="polite">
        {stateMessage}
      </p>
      {state === "error" || state === "expired" ? (
        <button
          type="button"
          className="turnstile-retry"
          onClick={() => {
            if (!widgetIdRef.current || !window.turnstile) return;
            clearToken("loading");
            window.turnstile.reset(widgetIdRef.current);
          }}
        >
          Yeniden dene
        </button>
      ) : null}
    </div>
  );
}
