import { describe, expect, it } from "vitest";
import type { FeedPlayer, PostableTerritory, RealPost } from "@/lib/models";
import { createPostMutationState, postMutationReducer, postPageRevision, updateSavedProjection, updateSavedTotal, visiblePostsForMode } from "@/lib/post-mutation-state";

const user: FeedPlayer = { id: "author", username: "author", displayName: "Author", initials: "AU", color: "#123456", pattern: 0, avatarData: null };
const territory = { id: "territory", ownerId: "author", ownerUsername: "author", name: "Alan", district: "Kadıköy", color: "#123456", pattern: "solid", geojson: null, areaKm2: 1, newlyAddedAreaKm2: 1, overlapAreaKm2: 0, distanceKm: 1, durationSeconds: 60, createdAt: "2026-01-01T00:00:00.000Z" } as unknown as PostableTerritory;

function post(id: string, overrides: Partial<RealPost> = {}): RealPost {
  return { id, userId: user.id, user, territory, title: id, body: "", images: [], mapView: null, likes: 2, comments: 3, likedByMe: false, savedByMe: true, followedByMe: false, requestedByMe: false, createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

describe("post mutation state", () => {
  it("applies one author relation to every explore card and filters after a successful follow", () => {
    const posts = [post("one"), post("two")];
    const initial = createPostMutationState(posts);
    expect(visiblePostsForMode(posts, "explore", initial)).toHaveLength(2);
    const followed = postMutationReducer(initial, { type: "relation", userId: user.id, relation: "following" });
    expect(visiblePostsForMode(posts, "explore", followed)).toEqual([]);
  });

  it("keeps a private follow request visible in explore", () => {
    const posts = [post("private")];
    const requested = postMutationReducer(createPostMutationState(posts), { type: "relation", userId: user.id, relation: "requested" });
    expect(visiblePostsForMode(posts, "explore", requested)).toEqual(posts);
  });

  it("removes an unsaved post from every saved projection without changing other interactions", () => {
    const posts = [post("saved")];
    const initial = createPostMutationState(posts);
    const unsaved = postMutationReducer(initial, { type: "save", postId: "saved", saved: false });
    expect(visiblePostsForMode(posts, "saved", unsaved)).toEqual([]);
    expect(unsaved.interactionByPostId.saved).toMatchObject({ liked: false, likeCount: 2, commentCount: 3 });
  });

  it("preserves shared mutations when cursor pages register duplicate posts", () => {
    const first = post("same");
    let state = createPostMutationState([first]);
    state = postMutationReducer(state, { type: "like", postId: first.id, liked: true, count: 3 });
    state = postMutationReducer(state, { type: "register", posts: [{ ...first, likedByMe: false, likes: 2 }] });
    expect(state.interactionByPostId.same).toMatchObject({ liked: true, likeCount: 3 });
  });

  it("sunucu yenilemesinde aynı kartın authoritative etkileşimlerini ve içeriğini eşitler", () => {
    const first = post("same");
    let state = createPostMutationState([first, post("removed")]);
    state = postMutationReducer(state, { type: "like", postId: first.id, liked: true, count: 3 });
    const refreshed = { ...first, title: "Sunucudan yenilendi", likedByMe: false, likes: 7, comments: 9 };
    state = postMutationReducer(state, { type: "synchronize", posts: [refreshed] });
    expect(state.postById).toEqual({ same: refreshed });
    expect(state.interactionByPostId.same).toEqual({ liked: false, likeCount: 7, saved: true, commentCount: 9 });
  });

  it("updates the saved projection and count exactly once", () => {
    const saved = post("saved");
    const added = updateSavedProjection([], saved, true);
    expect(updateSavedProjection(added, saved, true)).toBe(added);
    expect(updateSavedProjection(added, saved, false)).toEqual([]);
    expect(updateSavedTotal(4, false, true)).toBe(3);
    expect(updateSavedTotal(3, false, false)).toBe(3);
  });

  it("aynı kimlikli sayfanın sunucu etkileşimi değiştiğinde yeni revision üretir", () => {
    const initial = post("same");
    expect(postPageRevision([initial], null)).not.toBe(postPageRevision([{ ...initial, likes: 9 }], null));
    expect(postPageRevision([initial], "cursor-a")).not.toBe(postPageRevision([initial], "cursor-b"));
  });
});
