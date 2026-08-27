"use client";

import { useDemoProfile } from "@/components/DemoProfileProvider";
import { SettingsClient } from "@/components/SettingsClient";
import { DEMO_PLAYERS } from "@/lib/demo-profile";
import { isValidUsername, normalizeUsername } from "@/lib/validation";

function resolveDemoUsernameAvailability(value: string) {
  const username = normalizeUsername(value);
  if (!isValidUsername(username)) return "invalid" as const;
  return DEMO_PLAYERS.some((player) => player.username === username) ? "taken" as const : "available" as const;
}

export function DemoSettingsClient() {
  const { user, hydrated, saveProfile, resetProfile } = useDemoProfile();
  if (!hydrated) return <div className="settings-card" role="status" aria-live="polite">Demo profilin hazırlanıyor…</div>;
  return <SettingsClient initialUser={user} saveProfile={saveProfile} resolveUsernameAvailability={resolveDemoUsernameAvailability} resetDemo={resetProfile} />;
}
