"use client";

import { useDemoProfile } from "@/components/DemoProfileProvider";
import { GameMapLoader } from "@/components/GameMapLoader";

export default function DemoPlayPage() {
  const { user } = useDemoProfile();
  return <GameMapLoader user={user} mapState={{ territories: [], paints: [] }} demo />;
}
