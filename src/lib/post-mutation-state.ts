import type { RealPost } from "@/lib/models";

export type PostAuthorRelation = "none" | "following" | "requested";

export type SharedPostInteraction = {
  liked: boolean;
  likeCount: number;
  saved: boolean;
  commentCount: number;
};

export type PostMutationState = {
  postById: Record<string, RealPost>;
  relationByUserId: Record<string, PostAuthorRelation>;
  interactionByPostId: Record<string, SharedPostInteraction>;
  followPendingByUserId: Record<string, boolean>;
  likePendingByPostId: Record<string, boolean>;
  savePendingByPostId: Record<string, boolean>;
};

export type PostMutationAction =
  | { type: "register"; posts: RealPost[] }
  | { type: "synchronize"; posts: RealPost[] }
  | { type: "relation"; userId: string; relation: PostAuthorRelation }
  | { type: "follow-pending"; userId: string; pending: boolean }
  | { type: "like"; postId: string; liked: boolean; count: number }
  | { type: "like-pending"; postId: string; pending: boolean }
  | { type: "save"; postId: string; saved: boolean }
  | { type: "save-pending"; postId: string; pending: boolean }
  | { type: "comment-count"; postId: string; count: number };

export function relationFromPost(post: RealPost): PostAuthorRelation {
  if (post.followedByMe) return "following";
  if (post.requestedByMe) return "requested";
  return "none";
}

export function interactionFromPost(post: RealPost): SharedPostInteraction {
  return {
    liked: post.likedByMe,
    likeCount: post.likes,
    saved: post.savedByMe,
    commentCount: post.comments,
  };
}

export function createPostMutationState(posts: RealPost[]): PostMutationState {
  return postMutationReducer({
    postById: {},
    relationByUserId: {},
    interactionByPostId: {},
    followPendingByUserId: {},
    likePendingByPostId: {},
    savePendingByPostId: {},
  }, { type: "register", posts });
}

export function postMutationReducer(state: PostMutationState, action: PostMutationAction): PostMutationState {
  if (action.type === "synchronize") {
    const synchronized = createPostMutationState(action.posts);
    return {
      ...synchronized,
      followPendingByUserId: state.followPendingByUserId,
      likePendingByPostId: state.likePendingByPostId,
      savePendingByPostId: state.savePendingByPostId,
    };
  }
  if (action.type === "register") {
    let registeredPosts = state.postById;
    let relations = state.relationByUserId;
    let interactions = state.interactionByPostId;
    for (const post of action.posts) {
      if (!(post.id in registeredPosts)) registeredPosts = { ...registeredPosts, [post.id]: post };
      if (!(post.userId in relations)) relations = { ...relations, [post.userId]: relationFromPost(post) };
      if (!(post.id in interactions)) interactions = { ...interactions, [post.id]: interactionFromPost(post) };
    }
    if (registeredPosts === state.postById && relations === state.relationByUserId && interactions === state.interactionByPostId) return state;
    return { ...state, postById: registeredPosts, relationByUserId: relations, interactionByPostId: interactions };
  }
  if (action.type === "relation") {
    if (state.relationByUserId[action.userId] === action.relation) return state;
    return { ...state, relationByUserId: { ...state.relationByUserId, [action.userId]: action.relation } };
  }
  if (action.type === "follow-pending") {
    if (Boolean(state.followPendingByUserId[action.userId]) === action.pending) return state;
    return { ...state, followPendingByUserId: { ...state.followPendingByUserId, [action.userId]: action.pending } };
  }
  if (action.type === "like") {
    const current = state.interactionByPostId[action.postId];
    if (!current || (current.liked === action.liked && current.likeCount === action.count)) return state;
    return { ...state, interactionByPostId: { ...state.interactionByPostId, [action.postId]: { ...current, liked: action.liked, likeCount: action.count } } };
  }
  if (action.type === "like-pending") {
    if (Boolean(state.likePendingByPostId[action.postId]) === action.pending) return state;
    return { ...state, likePendingByPostId: { ...state.likePendingByPostId, [action.postId]: action.pending } };
  }
  if (action.type === "save") {
    const current = state.interactionByPostId[action.postId];
    if (!current || current.saved === action.saved) return state;
    return { ...state, interactionByPostId: { ...state.interactionByPostId, [action.postId]: { ...current, saved: action.saved } } };
  }
  if (action.type === "save-pending") {
    if (Boolean(state.savePendingByPostId[action.postId]) === action.pending) return state;
    return { ...state, savePendingByPostId: { ...state.savePendingByPostId, [action.postId]: action.pending } };
  }
  const current = state.interactionByPostId[action.postId];
  const count = Math.max(0, action.count);
  if (!current || current.commentCount === count) return state;
  return { ...state, interactionByPostId: { ...state.interactionByPostId, [action.postId]: { ...current, commentCount: count } } };
}

export function visiblePostsForMode(posts: RealPost[], mode: "following" | "explore" | "mine" | "saved" | "user", state: PostMutationState) {
  if (mode === "explore") return posts.filter((post) => (state.relationByUserId[post.userId] ?? relationFromPost(post)) !== "following");
  if (mode === "saved") return posts.filter((post) => (state.interactionByPostId[post.id] ?? interactionFromPost(post)).saved);
  return posts;
}

export function updateSavedProjection(posts: RealPost[], post: RealPost, saved: boolean) {
  if (!saved) return posts.filter((item) => item.id !== post.id);
  return posts.some((item) => item.id === post.id) ? posts : [post, ...posts];
}

export function updateSavedTotal(total: number, saved: boolean, previous: boolean) {
  if (saved === previous) return total;
  return Math.max(0, total + (saved ? 1 : -1));
}

export function postPageRevision(posts: RealPost[], nextCursor: string | null) {
  return `${nextCursor ?? "end"}:${posts.map((post) => [
    post.id,
    post.createdAt,
    post.likes,
    post.comments,
    Number(post.likedByMe),
    Number(post.savedByMe),
    Number(post.followedByMe),
    Number(post.requestedByMe),
  ].join(":" )).join("|")}`;
}
