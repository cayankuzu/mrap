import { describe, expect, it } from "vitest";
import { canViewConnectionList } from "@/lib/social-access";

describe("takip bağlantısı görünürlüğü", () => {
  it("herkese açık hesabın listesini authenticated izleyiciye açar", () => {
    expect(canViewConnectionList({ accountVisibility: "public", ownerId: "owner", viewerId: "viewer", viewerFollowsOwner: false })).toBe(true);
  });

  it("gizli hesabı yalnız sahibine veya kabul edilmiş takipçisine açar", () => {
    expect(canViewConnectionList({ accountVisibility: "private", ownerId: "owner", viewerId: "owner", viewerFollowsOwner: false })).toBe(true);
    expect(canViewConnectionList({ accountVisibility: "private", ownerId: "owner", viewerId: "viewer", viewerFollowsOwner: true })).toBe(true);
    expect(canViewConnectionList({ accountVisibility: "private", ownerId: "owner", viewerId: "viewer", viewerFollowsOwner: false })).toBe(false);
  });
});
