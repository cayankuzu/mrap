import { describe, expect, it } from "vitest";
import type { PlayerSearchResult } from "@/lib/models";
import { applyPlayerFollowResult } from "@/lib/player-follow-state";

const player: PlayerSearchResult = {
  id: "user-1",
  username: "cayan",
  displayName: "Çayan Akın",
  initials: "ÇA",
  color: "#0D8BFF",
  pattern: 0,
  city: "İstanbul",
  accountVisibility: "public",
  avatarData: null,
  followers: 10,
  routes: 3,
  areaKm2: 1.2,
  relation: "none",
};

describe("oyuncu takip sonucu", () => {
  it("aynı başarılı sonucu iki kez uyguladığında takipçi sayısını yalnız bir kez artırır", () => {
    const first = applyPlayerFollowResult([player], player.id, "following");
    const repeated = applyPlayerFollowResult(first, player.id, "following");
    expect(repeated[0]).toMatchObject({ relation: "following", followers: 11 });
  });

  it("takip bırakıldığında sayıyı bir kez azaltır ve sıfırın altına indirmez", () => {
    const followed = { ...player, relation: "following" as const, followers: 1 };
    expect(applyPlayerFollowResult([followed], player.id, "none")[0].followers).toBe(0);
    expect(applyPlayerFollowResult([{ ...followed, followers: 0 }], player.id, "none")[0].followers).toBe(0);
  });
});
