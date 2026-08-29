"use client";

import { useMemo } from "react";
import { LeaderboardClient } from "@/components/LeaderboardClient";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { DEMO_PLAYERS } from "@/lib/demo-profile";
import { demoFollowRelation } from "@/lib/demo-social-state";
import type { LeaderboardEntry } from "@/lib/models";

export function DemoLeaderboard() {
  const { user, social } = useDemoProfile();
  const { entries, followingIds } = useMemo(() => {
    const players: LeaderboardEntry[] = DEMO_PLAYERS.map((player, index) => ({
      id: player.id,
      username: player.username,
      displayName: player.displayName,
      initials: player.initials,
      color: player.color,
      pattern: player.pattern,
      countryCode: player.countryCode,
      cityId: player.cityId,
      country: player.country,
      city: player.city,
      avatarData: player.avatarData,
      areaKm2: player.areaKm2,
      routes: player.routes,
      rank: index + 1,
    }));
    players.push({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      initials: user.initials,
      color: user.color,
      pattern: user.pattern,
      countryCode: user.countryCode,
      cityId: user.cityId,
      country: user.country,
      city: user.city,
      avatarData: user.avatarData,
      areaKm2: 0,
      routes: 0,
      rank: players.length + 1,
    });
    return {
      entries: players,
      followingIds: DEMO_PLAYERS
        .filter((player) => demoFollowRelation(social, player.username, player.relation) === "following")
        .map((player) => player.id),
    };
  }, [social, user]);

  return (
    <LeaderboardClient
      entries={entries}
      currentUser={user}
      followingIds={followingIds}
      profileBasePath="/demo/users"
      selfProfilePath="/demo/profile"
    />
  );
}
