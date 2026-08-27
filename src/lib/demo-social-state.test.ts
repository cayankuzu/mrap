import { describe, expect, it } from "vitest";
import { DEMO_SOCIAL_STORAGE_KEY, EMPTY_DEMO_SOCIAL_STATE, demoFollowRelation, parseDemoSocialState, readDemoSocialState, toggleDemoFollowRelation, writeDemoSocialState } from "@/lib/demo-social-state";

class MemoryStorage {
  value: string | null = null;
  getItem(key: string) { return key === DEMO_SOCIAL_STORAGE_KEY ? this.value : null; }
  setItem(key: string, value: string) { if (key === DEMO_SOCIAL_STORAGE_KEY) this.value = value; }
  removeItem(key: string) { if (key === DEMO_SOCIAL_STORAGE_KEY) this.value = null; }
}

describe("demo sosyal state", () => {
  it("beğeni, kayıt, takip, paylaşım ve yorumu ekran değişimlerine dayanıklı saklar", () => {
    const storage = new MemoryStorage();
    const state = writeDemoSocialState(storage, {
      likedPostIds: ["post-1"],
      savedPostIds: ["post-2"],
      followedUsernames: ["defnek"],
      requestedUsernames: ["denizaras"],
      unfollowedUsernames: [],
      sharedPostIds: ["post-1"],
      commentsByPost: { "post-1": [{ id: "comment-1", body: "Çok güzel bir rota.", createdAt: new Date().toISOString() }] },
    });
    expect(readDemoSocialState(storage)).toEqual(state);
  });

  it("bozuk, aşırı veya bilinmeyen alanları güvenli varsayılana indirger", () => {
    expect(parseDemoSocialState(null)).toBe(EMPTY_DEMO_SOCIAL_STATE);
    expect(parseDemoSocialState({ v: 1, likedPostIds: ["../bad", "ok"], savedPostIds: "bad", followedUsernames: [], commentsByPost: { "post-1": [{ id: "bad id", body: "x", createdAt: "now" }] }, extra: true })).toEqual({
      likedPostIds: ["ok"], savedPostIds: [], followedUsernames: [], requestedUsernames: [], unfollowedUsernames: [], sharedPostIds: [], commentsByPost: {},
    });
  });

  it("açık hesabı takip eder, gizli hesaba istek yollar ve açık seçimi reload için saklar", () => {
    const publicFollow = toggleDemoFollowRelation(EMPTY_DEMO_SOCIAL_STATE, { username: "defnek", accountVisibility: "public" });
    expect(demoFollowRelation(publicFollow, "defnek")).toBe("following");
    const privateRequest = toggleDemoFollowRelation(publicFollow, { username: "denizaras", accountVisibility: "private" });
    expect(demoFollowRelation(privateRequest, "denizaras")).toBe("requested");
    const unfollowedSeed = toggleDemoFollowRelation(privateRequest, { username: "keremruns", accountVisibility: "private", initialRelation: "following" });
    expect(demoFollowRelation(unfollowedSeed, "keremruns", "following")).toBe("none");
  });
});
