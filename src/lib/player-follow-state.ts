import type { PlayerSearchResult } from "@/lib/models";

export function applyPlayerFollowResult(
  players: PlayerSearchResult[],
  playerId: string,
  nextRelation: PlayerSearchResult["relation"],
) {
  return players.map((player) => {
    if (player.id !== playerId || player.relation === nextRelation) return player;
    const previousContribution = player.relation === "following" ? 1 : 0;
    const nextContribution = nextRelation === "following" ? 1 : 0;
    return {
      ...player,
      relation: nextRelation,
      followers: Math.max(0, player.followers + nextContribution - previousContribution),
    };
  });
}
