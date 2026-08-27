"use client";

import dynamic from "next/dynamic";
import type { AppUser, TerritoryMapState } from "@/lib/models";

const GameMap = dynamic(() => import("@/components/GameMap").then((module) => module.GameMap), {
  ssr: false,
  loading: () => <div className="game-map-page"><div className="map-loading"><span /><strong>Oyun haritası yükleniyor</strong><small>Harita ve alan hesaplama sistemi hazırlanıyor…</small></div></div>,
});

export function GameMapLoader(props: { user: AppUser; mapState: TerritoryMapState; demo?: boolean }) {
  return <GameMap {...props} />;
}
