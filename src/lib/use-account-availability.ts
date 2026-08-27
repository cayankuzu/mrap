"use client";

import { useEffect, useState } from "react";
import { isValidEmail, isValidUsername } from "@/lib/validation";

export type AvailabilityStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "error";

export function useAccountAvailability(field: "email" | "username", value: string, enabled = true) {
  const normalizedValue = value.trim();
  const valid = field === "email" ? isValidEmail(normalizedValue) : isValidUsername(normalizedValue);
  const requestKey = `${field}:${normalizedValue}`;
  const [result, setResult] = useState<{ key: string; status: AvailabilityStatus }>({ key: "", status: "idle" });

  useEffect(() => {
    if (!enabled || !normalizedValue || !valid) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setResult({ key: requestKey, status: "checking" });
      try {
        const response = await fetch("/api/auth/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field, value: normalizedValue }),
          signal: controller.signal,
        });
        if (!response.ok) { setResult({ key: requestKey, status: "error" }); return; }
        const result = await response.json() as { valid: boolean; available: boolean };
        setResult({ key: requestKey, status: !result.valid ? "invalid" : result.available ? "available" : "taken" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResult({ key: requestKey, status: "error" });
      }
    }, 320);

    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [enabled, field, normalizedValue, requestKey, valid]);

  if (!enabled || !normalizedValue) return "idle";
  if (!valid) return "invalid";
  return result.key === requestKey ? result.status : "checking";
}
