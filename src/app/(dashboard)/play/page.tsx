import type { Metadata } from "next";
import { GameMapLoader } from "@/components/GameMapLoader";
import { requireCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Harita" };
export default async function PlayPage() {
  const user = await requireCurrentUser();
  // Confirmed ownership is loaded by viewport through the private, versioned region protocol.
  return <GameMapLoader user={user} mapState={{ territories: [], paints: [] }} />;
}
