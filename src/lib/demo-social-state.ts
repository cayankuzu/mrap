import { CONTENT_LIMITS } from "@/lib/content-limits";

export const DEMO_SOCIAL_STORAGE_KEY = "mrap:demo-social:v1";
const VERSION = 2;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type DemoStoredComment = {
  id: string;
  body: string;
  createdAt: string;
};

export type DemoSocialState = {
  likedPostIds: string[];
  savedPostIds: string[];
  followedUsernames: string[];
  requestedUsernames: string[];
  unfollowedUsernames: string[];
  sharedPostIds: string[];
  commentsByPost: Record<string, DemoStoredComment[]>;
};

export type DemoFollowRelation = "none" | "following" | "requested";

export const EMPTY_DEMO_SOCIAL_STATE: DemoSocialState = Object.freeze({
  likedPostIds: [],
  savedPostIds: [],
  followedUsernames: [],
  requestedUsernames: [],
  unfollowedUsernames: [],
  sharedPostIds: [],
  commentsByPost: {},
});

type DemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let cachedRaw: string | null | undefined;
let cachedState = EMPTY_DEMO_SOCIAL_STATE;
let memoryOnlyState: DemoSocialState | null = null;

function safeIdList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && ID_PATTERN.test(entry)))].slice(0, 500);
}

export function parseDemoSocialState(value: unknown): DemoSocialState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_DEMO_SOCIAL_STATE;
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== 1 && candidate.v !== VERSION) return EMPTY_DEMO_SOCIAL_STATE;
  const commentsByPost: Record<string, DemoStoredComment[]> = {};
  let remainingComments = 100;
  if (candidate.commentsByPost && typeof candidate.commentsByPost === "object" && !Array.isArray(candidate.commentsByPost)) {
    for (const [postId, comments] of Object.entries(candidate.commentsByPost)) {
      if (!ID_PATTERN.test(postId) || !Array.isArray(comments) || remainingComments <= 0) continue;
      const safeComments = comments.filter((comment): comment is DemoStoredComment => {
        if (!comment || typeof comment !== "object") return false;
        const item = comment as Partial<DemoStoredComment>;
        return typeof item.id === "string" && ID_PATTERN.test(item.id)
          && typeof item.body === "string" && item.body.trim().length >= CONTENT_LIMITS.commentBody.min
          && item.body.length <= CONTENT_LIMITS.commentBody.max
          && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt));
      }).slice(0, Math.min(50, remainingComments));
      if (safeComments.length) commentsByPost[postId] = safeComments;
      remainingComments -= safeComments.length;
    }
  }
  const requestedUsernames = safeIdList(candidate.requestedUsernames);
  const requested = new Set(requestedUsernames);
  const followedUsernames = safeIdList(candidate.followedUsernames).filter((username) => !requested.has(username));
  const followed = new Set(followedUsernames);
  const unfollowedUsernames = safeIdList(candidate.unfollowedUsernames).filter((username) => !requested.has(username) && !followed.has(username));
  return {
    likedPostIds: safeIdList(candidate.likedPostIds),
    savedPostIds: safeIdList(candidate.savedPostIds),
    followedUsernames,
    requestedUsernames,
    unfollowedUsernames,
    sharedPostIds: safeIdList(candidate.sharedPostIds),
    commentsByPost,
  };
}

export function demoFollowRelation(state: DemoSocialState, username: string, initialRelation: DemoFollowRelation = "none"): DemoFollowRelation {
  if (state.requestedUsernames.includes(username)) return "requested";
  if (state.followedUsernames.includes(username)) return "following";
  if (state.unfollowedUsernames.includes(username)) return "none";
  return initialRelation;
}

export function toggleDemoFollowRelation(
  state: DemoSocialState,
  input: { username: string; accountVisibility: "public" | "private"; initialRelation?: DemoFollowRelation },
): DemoSocialState {
  const current = demoFollowRelation(state, input.username, input.initialRelation);
  const next: DemoFollowRelation = current === "none"
    ? input.accountVisibility === "private" ? "requested" : "following"
    : "none";
  const withoutUsername = (values: string[]) => values.filter((value) => value !== input.username);
  return {
    ...state,
    followedUsernames: next === "following" ? [...withoutUsername(state.followedUsernames), input.username] : withoutUsername(state.followedUsernames),
    requestedUsernames: next === "requested" ? [...withoutUsername(state.requestedUsernames), input.username] : withoutUsername(state.requestedUsernames),
    unfollowedUsernames: next === "none" ? [...withoutUsername(state.unfollowedUsernames), input.username] : withoutUsername(state.unfollowedUsernames),
  };
}

export function readDemoSocialState(storage: DemoStorage) {
  if (memoryOnlyState) return memoryOnlyState;
  try {
    const raw = storage.getItem(DEMO_SOCIAL_STORAGE_KEY);
    if (raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    cachedState = raw ? parseDemoSocialState(JSON.parse(raw)) : EMPTY_DEMO_SOCIAL_STATE;
    return cachedState;
  } catch {
    return cachedState;
  }
}

export function writeDemoSocialState(storage: DemoStorage, state: DemoSocialState) {
  const safe = parseDemoSocialState({ v: VERSION, ...state });
  const raw = JSON.stringify({ v: VERSION, ...safe });
  try {
    storage.setItem(DEMO_SOCIAL_STORAGE_KEY, raw);
    memoryOnlyState = null;
  } catch {
    memoryOnlyState = safe;
  }
  cachedRaw = raw;
  cachedState = safe;
  return safe;
}

export function clearDemoSocialState(storage: DemoStorage) {
  try { storage.removeItem(DEMO_SOCIAL_STORAGE_KEY); } catch { /* Best effort. */ }
  memoryOnlyState = null;
  cachedRaw = null;
  cachedState = EMPTY_DEMO_SOCIAL_STATE;
}
