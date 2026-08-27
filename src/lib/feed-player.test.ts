import { describe, expect, it } from "vitest";
import { toFeedPlayerReference } from "@/lib/feed-player";

const player = {
  id: "user_1",
  username: "oyuncu",
  displayName: "Ada Yılmaz",
  initials: "AY",
  color: "#0D8BFF",
  pattern: 1,
  avatarData: "data:image/jpeg;base64,/9j/2Q==",
};

describe("feed oyuncu referansı", () => {
  it("base64 avatar yerine yetkili medya adresi üretir", () => {
    expect(toFeedPlayerReference(player)).toEqual({
      ...player,
      avatarData: "/api/users/user_1/avatar",
    });
  });

  it("avatarı olmayan kullanıcıyı null bırakır", () => {
    expect(toFeedPlayerReference({ ...player, avatarData: null }).avatarData).toBeNull();
  });
});
