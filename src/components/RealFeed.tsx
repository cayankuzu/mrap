"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, FormEvent, createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bookmark, Heart, ImagePlus, LoaderCircle, MapPin, MessageCircle, Plus, Route, Send, Sparkles, X } from "lucide-react";
import { PhotoSelectionGrid } from "@/components/PhotoSelectionGrid";
import { PostMediaCarousel } from "@/components/PostMediaCarousel";
import { PostCommentsDialog, type PostCommentViewModel } from "@/components/PostCommentsDialog";
import { PostLikesDialog, type LikeListUser } from "@/components/PostLikesDialog";
import { DeferredTerritoryInteractiveMap } from "@/components/DeferredTerritoryInteractiveMap";
import { UserAvatar } from "@/components/UserAvatar";
import { optimizeImage } from "@/lib/client-image";
import { readableTextColor } from "@/lib/app-config";
import { CONTENT_LIMITS, MEDIA_LIMITS } from "@/lib/content-limits";
import { desiredStateRequest } from "@/lib/desired-state-request";
import { postComposerDraftKey, readPostComposerDraft, removePostComposerDraft, writePostComposerDraft } from "@/lib/post-composer-draft";
import { POST_PUBLISH_TIMEOUT_MS, PostPublishClient, type PostPublishPayload } from "@/lib/post-publish-client";
import { createPostPublishAttemptStore, postPublishAttemptKey } from "@/lib/post-publish-attempt";
import { postDetailPath } from "@/lib/post-resource";
import { createPostMutationState, interactionFromPost, postMutationReducer, postPageRevision, relationFromPost, visiblePostsForMode, type PostAuthorRelation, type PostMutationState } from "@/lib/post-mutation-state";
import { useMrapRefresh } from "@/lib/refresh-events";
import { useModalDialog } from "@/lib/use-modal-dialog";
import { useLongPress } from "@/lib/use-long-press";
import type { MapCameraState } from "@/lib/map-preview";
import type { FeedPlayer, PostableTerritory, PostComment, PostPage, RealPost } from "@/lib/models";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

const TerritoryFrameEditor = dynamic(() => import("@/components/TerritoryFrameEditor").then((module) => module.TerritoryFrameEditor), { ssr: false, loading: () => <div className="empty-snapshot"><span>Harita kadrajı hazırlanıyor…</span></div> });

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "şimdi";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dk`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} sa`;
  return `${Math.floor(seconds / 86400)} gün`;
}

function commentViewModel(comment: PostComment): PostCommentViewModel {
  return {
    id: comment.id,
    body: comment.body,
    user: comment.user,
    createdAt: comment.createdAt,
    createdAtLabel: relativeTime(comment.createdAt),
    status: "sent",
  };
}

function createCommentAttemptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `pending-${crypto.randomUUID()}`;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return `pending-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("Güvenli yorum anahtarı üretilemedi.");
}

type PostMutationContextValue = {
  state: PostMutationState;
  registerPosts: (posts: RealPost[]) => void;
  setRelation: (userId: string, relation: PostAuthorRelation) => void;
  setFollowPending: (userId: string, pending: boolean) => void;
  setLike: (postId: string, liked: boolean, count: number) => void;
  setLikePending: (postId: string, pending: boolean) => void;
  setSaved: (post: RealPost, saved: boolean, previous: boolean) => void;
  setSavePending: (postId: string, pending: boolean) => void;
  setCommentCount: (postId: string, count: number) => void;
};

const PostMutationContext = createContext<PostMutationContextValue | null>(null);

export function PostMutationProvider({
  initialPosts,
  authoritativePosts = initialPosts,
  onSavedChange,
  children,
}: {
  initialPosts: RealPost[];
  authoritativePosts?: RealPost[];
  onSavedChange?: (post: RealPost, saved: boolean, previous: boolean) => void;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(postMutationReducer, initialPosts, createPostMutationState);
  const onSavedChangeRef = useRef(onSavedChange);
  useEffect(() => { onSavedChangeRef.current = onSavedChange; }, [onSavedChange]);
  const registerPosts = useCallback((posts: RealPost[]) => dispatch({ type: "register", posts }), []);
  const setRelation = useCallback((userId: string, relation: PostAuthorRelation) => dispatch({ type: "relation", userId, relation }), []);
  const setFollowPending = useCallback((userId: string, pending: boolean) => dispatch({ type: "follow-pending", userId, pending }), []);
  const setLike = useCallback((postId: string, liked: boolean, count: number) => dispatch({ type: "like", postId, liked, count }), []);
  const setLikePending = useCallback((postId: string, pending: boolean) => dispatch({ type: "like-pending", postId, pending }), []);
  const setSaved = useCallback((post: RealPost, saved: boolean, previous: boolean) => {
    dispatch({ type: "save", postId: post.id, saved });
    if (saved !== previous) onSavedChangeRef.current?.(post, saved, previous);
  }, []);
  const setSavePending = useCallback((postId: string, pending: boolean) => dispatch({ type: "save-pending", postId, pending }), []);
  const setCommentCount = useCallback((postId: string, count: number) => dispatch({ type: "comment-count", postId, count }), []);

  useEffect(() => { dispatch({ type: "synchronize", posts: authoritativePosts }); }, [authoritativePosts]);

  const value = useMemo<PostMutationContextValue>(() => ({
    state,
    registerPosts,
    setRelation,
    setFollowPending,
    setLike,
    setLikePending,
    setSaved,
    setSavePending,
    setCommentCount,
  }), [registerPosts, setCommentCount, setFollowPending, setLike, setLikePending, setRelation, setSavePending, setSaved, state]);

  return <PostMutationContext.Provider value={value}>{children}</PostMutationContext.Provider>;
}

export function RealTerritoryCard({ territory, mapView, compact = false }: { territory: PostableTerritory; mapView?: MapCameraState | null; compact?: boolean }) {
  const { dictionary: copy } = useI18n();
  const hours = Math.floor(territory.durationSeconds / 3600);
  const minutes = Math.floor((territory.durationSeconds % 3600) / 60);
  const duration = territory.durationSeconds < 60 ? `${territory.durationSeconds} sn` : `${hours ? `${hours} sa ` : ""}${minutes} dk`;
  return (
    <div className={`real-territory-card${compact ? " is-compact" : ""}`} style={{ "--territory-color": territory.color } as React.CSSProperties}>
      <DeferredTerritoryInteractiveMap territory={{ ...territory, geojson: territory.geojson, variant: territory.pattern }} ownerUsername={territory.ownerUsername} mapView={mapView} compact={compact} />
      <div className="snapshot-meta">
        <div><span className="snapshot-kicker"><Route size={14} /> {copy.feed.areaRecord}</span><strong>{territory.name}</strong><small className="snapshot-location"><MapPin size={12} /> {territory.district}</small></div>
        <div className="snapshot-stats"><span><small>{copy.feed.totalPath}</small>{territory.distanceKm.toFixed(2).replace(".", ",")} km</span><span><small>{copy.feed.closedArea}</small>{territory.areaKm2.toFixed(3).replace(".", ",")} km²</span><span><small>{copy.feed.newOwnership}</small>{territory.newlyAddedAreaKm2.toFixed(3).replace(".", ",")} km²</span></div>
      </div>
      {territory.overlapAreaKm2 > 0 ? <small className="claim-overlap-note">{territory.overlapAreaKm2.toFixed(3).replace(".", ",")} km² mevcut alan son renkle yeniden boyandı · {duration}</small> : null}
    </div>
  );
}

function RealPostCardContent({ post, currentUser, showFollow, compact = false }: { post: RealPost; currentUser: FeedPlayer; showFollow?: boolean; compact?: boolean }) {
  const { dictionary: copy } = useI18n();
  const mutation = useContext(PostMutationContext)!;
  const interaction = mutation.state.interactionByPostId[post.id] ?? interactionFromPost(post);
  const relation = mutation.state.relationByUserId[post.userId] ?? relationFromPost(post);
  const liked = interaction.liked;
  const likeCount = interaction.likeCount;
  const commentCount = interaction.commentCount;
  const saved = interaction.saved;
  const likePending = Boolean(mutation.state.likePendingByPostId[post.id]);
  const followPending = Boolean(mutation.state.followPendingByUserId[post.userId]);
  const savePending = Boolean(mutation.state.savePendingByPostId[post.id]);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<PostCommentViewModel[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentSubmitError, setCommentSubmitError] = useState("");
  const [shared, setShared] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const [likers, setLikers] = useState<LikeListUser[]>([]);
  const [likersLoading, setLikersLoading] = useState(false);
  const [likersError, setLikersError] = useState("");
  const [actionError, setActionError] = useState("");
  const commentsRequestRef = useRef<AbortController | null>(null);
  const commentSubmitPendingRef = useRef(false);
  const shareTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    commentsRequestRef.current?.abort();
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
  }, []);

  async function togglePostLike() {
    if (likePending) return;
    mutation.setLikePending(post.id, true);
    setActionError("");
    try {
      const response = await fetch(`/api/posts/${post.id}/like`, desiredStateRequest(!liked));
      const result = await response.json() as { liked?: boolean; count?: number; error?: string };
      if (!response.ok || typeof result.liked !== "boolean" || typeof result.count !== "number") throw new Error(result.error || "Beğeni güncellenemedi.");
      mutation.setLike(post.id, result.liked, result.count);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Beğeni güncellenemedi.");
    } finally {
      mutation.setLikePending(post.id, false);
    }
  }

  async function openLikeList() {
    setLikesOpen(true);
    setLikersLoading(true);
    setLikersError("");
    try {
      const response = await fetch(`/api/posts/${post.id}/likes`, { cache: "no-store" });
      const result = await response.json() as { users?: LikeListUser[]; error?: string };
      if (!response.ok || !result.users) { setLikersError(result.error || "Beğenenler yüklenemedi."); return; }
      setLikers(result.users);
    } catch {
      setLikersError("Bağlantı kurulamadı. Yeniden deneyebilirsin.");
    } finally {
      setLikersLoading(false);
    }
  }

  const likeLongPress = useLongPress(() => void togglePostLike(), () => void openLikeList());

  async function toggleUserFollow() {
    if (followPending) return;
    mutation.setFollowPending(post.userId, true);
    setActionError("");
    try {
      const response = await fetch(`/api/follows/${post.userId}`, desiredStateRequest(relation === "none"));
      const result = await response.json() as { status?: "none" | "following" | "requested"; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error || "Takip durumu güncellenemedi.");
      mutation.setRelation(post.userId, result.status);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Takip durumu güncellenemedi.");
    } finally {
      mutation.setFollowPending(post.userId, false);
    }
  }

  async function loadComments(cursor: string | null = null) {
    if (cursor ? commentsLoadingMore : commentsLoading) return;
    const controller = new AbortController();
    commentsRequestRef.current?.abort();
    commentsRequestRef.current = controller;
    if (cursor) setCommentsLoadingMore(true); else setCommentsLoading(true);
    setCommentsError("");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/posts/${post.id}/comments?${query}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as { comments?: PostComment[]; nextCursor?: string | null; total?: number; error?: string };
      if (!response.ok || !result.comments || typeof result.total !== "number") throw new Error(result.error || "Yorumlar yüklenemedi.");
      const incoming = result.comments.map(commentViewModel);
      setComments((current) => {
        if (!cursor) {
          const unsent = current.filter((item) => item.status === "pending" || item.status === "failed");
          const unsentIds = new Set(unsent.map((item) => item.id));
          return [...unsent, ...incoming.filter((item) => !unsentIds.has(item.id))];
        }
        const known = new Set(current.map((item) => item.id));
        return [...current, ...incoming.filter((item) => !known.has(item.id))];
      });
      setCommentsCursor(result.nextCursor ?? null);
      mutation.setCommentCount(post.id, result.total);
      setCommentsLoaded(true);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setCommentsError(loadError instanceof Error ? loadError.message : "Yorumlar yüklenemedi.");
    } finally {
      if (commentsRequestRef.current === controller) {
        setCommentsLoading(false);
        setCommentsLoadingMore(false);
        commentsRequestRef.current = null;
      }
    }
  }

  function openComments() {
    setCommentOpen(true);
    if (!commentsLoaded && !commentsLoading) void loadComments();
  }

  async function submitComment(body: string, previousId?: string) {
    if (commentSubmitPendingRef.current) return;
    let optimisticId: string;
    try {
      optimisticId = previousId ?? createCommentAttemptId();
    } catch (keyError) {
      setCommentSubmitError(keyError instanceof Error ? keyError.message : "Yorum gönderilemedi.");
      return;
    }
    const optimistic: PostCommentViewModel = {
      id: optimisticId,
      body,
      user: currentUser,
      createdAt: new Date().toISOString(),
      createdAtLabel: "şimdi",
      status: "pending",
    };
    commentSubmitPendingRef.current = true;
    setCommentSubmitting(true);
    setCommentSubmitError("");
    setComment("");
    setComments((current) => previousId
      ? current.map((item) => item.id === previousId ? optimistic : item)
      : [optimistic, ...current]);
    try {
      const response = await fetch(`/api/posts/${post.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, idempotencyKey: optimisticId }) });
      const result = await response.json() as { comment?: PostComment; total?: number; error?: string };
      if (!response.ok || !result.comment || typeof result.total !== "number") throw new Error(result.error || "Yorum gönderilemedi.");
      const savedComment = commentViewModel(result.comment);
      setComments((current) => {
        const optimisticIndex = current.findIndex((item) => item.id === optimisticId);
        const next = current.filter((item) => item.id !== optimisticId && item.id !== savedComment.id);
        next.splice(Math.max(0, optimisticIndex), 0, savedComment);
        return next;
      });
      mutation.setCommentCount(post.id, result.total);
      setCommentsLoaded(true);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Yorum gönderilemedi.";
      setComments((current) => current.map((item) => item.id === optimisticId ? { ...item, status: "failed" } : item));
      setCommentSubmitError(message);
    } finally {
      commentSubmitPendingRef.current = false;
      setCommentSubmitting(false);
    }
  }

  async function sharePost() {
    setActionError("");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Tarayıcı bağlantı kopyalamayı desteklemiyor.");
      await navigator.clipboard.writeText(`${location.origin}${postDetailPath(post.id)}`);
      setShared(true);
      if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = window.setTimeout(() => { setShared(false); shareTimerRef.current = null; }, 1600);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Bağlantı kopyalanamadı.");
    }
  }

  async function togglePostSave() {
    if (savePending) return;
    mutation.setSavePending(post.id, true);
    setActionError("");
    try {
      const response = await fetch(`/api/posts/${post.id}/save`, desiredStateRequest(!saved));
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || typeof result.saved !== "boolean") throw new Error(result.error || "Kaydetme durumu güncellenemedi.");
      mutation.setSaved(post, result.saved, saved);
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Kaydetme durumu güncellenemedi.");
    } finally {
      mutation.setSavePending(post.id, false);
    }
  }

  useMrapRefresh("panel", commentOpen || likesOpen, () => {
    if (commentOpen) void loadComments();
    if (likesOpen) void openLikeList();
  });

  return (
    <article className={`post-card${compact ? " is-grid-card" : ""}`} id={`post-${post.id}`}>
      <header className="post-header">
        <UserAvatar user={post.user} href={`/users/${encodeURIComponent(post.user.username)}`} />
        <div className="post-author"><Link href={`/users/${encodeURIComponent(post.user.username)}`}><strong>{post.user.displayName}</strong></Link><span>@{post.user.username} · {relativeTime(post.createdAt)}</span></div>
        {showFollow && post.userId !== currentUser.id ? <button className={`text-button${relation !== "none" ? " is-following" : ""}`} type="button" onClick={toggleUserFollow} disabled={followPending} aria-busy={followPending}>{followPending ? copy.common.processing : relation === "following" ? copy.feed.following : relation === "requested" ? copy.feed.requested : copy.feed.follow}</button> : null}
      </header>
      <div className="post-story-copy"><h2>{post.title}</h2>{post.body ? <p className="post-copy">{post.body}</p> : null}</div>
      <RealTerritoryCard territory={post.territory} mapView={post.mapView} compact={compact} />
      <PostMediaCarousel compact={compact} items={post.images.map((src, index) => ({ id: `${post.id}-${index}`, src, alt: formatMessage(copy.feed.postPhotoAlt, { name: post.user.displayName, index: index + 1 }) }))} />
      <footer className="post-actions">
        <button type="button" className={liked ? "is-liked" : ""} {...likeLongPress} disabled={likePending} aria-busy={likePending} aria-pressed={liked} aria-haspopup="dialog" aria-expanded={likesOpen} aria-label={`${liked ? copy.feed.unlike : copy.feed.like}. ${copy.feed.likeLongPressHint}`}><Heart size={20} fill={liked ? "currentColor" : "none"} /> {likeCount}</button>
        <button type="button" onClick={openComments} aria-haspopup="dialog" aria-expanded={commentOpen} aria-label={formatMessage(copy.feed.showCommentsAria, { count: commentCount })}><MessageCircle size={20} /> {commentCount}</button>
        <button type="button" onClick={sharePost} className={shared ? "is-shared" : ""}><Send size={19} /> {shared ? copy.feed.copied : copy.feed.share}</button>
        <button type="button" className={`save-action${saved ? " is-saved" : ""}`} onClick={togglePostSave} disabled={savePending} aria-busy={savePending} aria-label={saved ? copy.feed.removeSavedPost : copy.feed.savePost} aria-pressed={saved}><Bookmark size={20} fill={saved ? "currentColor" : "none"} /></button>
      </footer>
      {actionError ? <p className="post-action-error" role="alert">{actionError}</p> : null}
      <PostCommentsDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        comments={comments}
        total={commentCount}
        currentUser={currentUser}
        draft={comment}
        onDraftChange={setComment}
        onSubmit={submitComment}
        loading={commentsLoading}
        error={commentsError}
        onRetry={() => loadComments()}
        hasMore={Boolean(commentsCursor)}
        loadingMore={commentsLoadingMore}
        onLoadMore={() => commentsCursor ? loadComments(commentsCursor) : undefined}
        submitting={commentSubmitting}
        submitError={commentSubmitError}
        onRetryComment={(failedComment) => submitComment(failedComment.body, failedComment.id)}
      />
      <PostLikesDialog open={likesOpen} onClose={() => setLikesOpen(false)} users={likers} total={likeCount} loading={likersLoading} error={likersError} onRetry={openLikeList} />
    </article>
  );
}

export function RealPostCard(props: { post: RealPost; currentUser: FeedPlayer; showFollow?: boolean; compact?: boolean }) {
  const mutation = useContext(PostMutationContext);
  if (mutation) return <RealPostCardContent {...props} />;
  return <PostMutationProvider initialPosts={[props.post]}><RealPostCardContent {...props} /></PostMutationProvider>;
}

export function RealPostGrid({ posts, currentUser, showFollow = false }: { posts: RealPost[]; currentUser: FeedPlayer; showFollow?: boolean }) {
  const mutation = useContext(PostMutationContext);
  const content = <div className="feed-list adaptive-post-flow">{posts.map((post) => <RealPostCardContent key={post.id} post={post} currentUser={currentUser} showFollow={showFollow} compact />)}</div>;
  if (mutation) return content;
  return <PostMutationProvider initialPosts={posts}>{content}</PostMutationProvider>;
}

export type PostFeedRequestMode = "following" | "explore" | "mine" | "saved" | "user";

function PaginatedPostGridContent({
  initialPosts,
  initialNextCursor,
  currentUser,
  mode,
  ownerId,
  showFollow = false,
}: {
  initialPosts: RealPost[];
  initialNextCursor: string | null;
  currentUser: FeedPlayer;
  mode: PostFeedRequestMode;
  ownerId?: string;
  showFollow?: boolean;
}) {
  const mutation = useContext(PostMutationContext)!;
  const registerPosts = mutation.registerPosts;
  const [posts, setPosts] = useState(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    registerPosts(initialPosts);
  }, [initialPosts, registerPosts]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingMore(true);
    setLoadError("");
    try {
      const query = new URLSearchParams({ mode, cursor: nextCursor });
      if (mode === "user" && ownerId) query.set("ownerId", ownerId);
      const response = await fetch(`/api/posts?${query}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as Partial<PostPage> & { error?: string };
      if (!response.ok || !Array.isArray(result.posts)) throw new Error(result.error || "Gönderiler yüklenemedi.");
      registerPosts(result.posts);
      setPosts((current) => {
        const known = new Set(current.map((post) => post.id));
        return [...current, ...result.posts!.filter((post) => !known.has(post.id))];
      });
      setNextCursor(typeof result.nextCursor === "string" ? result.nextCursor : null);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setLoadError(loadError instanceof Error ? loadError.message : "Gönderiler yüklenemedi.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  const candidatePosts = mode === "saved"
    ? Array.from(new Map([...posts, ...Object.values(mutation.state.postById)].map((post) => [post.id, post])).values())
    : posts;
  const visiblePosts = visiblePostsForMode(candidatePosts, mode, mutation.state);

  return <>
    <RealPostGrid posts={visiblePosts} currentUser={currentUser} showFollow={showFollow} />
    {loadError ? <div className="feed-pagination-error" role="alert"><span>{loadError}</span><button type="button" onClick={() => void loadMore()}>Tekrar dene</button></div> : null}
    {nextCursor ? <div className="feed-pagination"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} aria-busy={loadingMore}>{loadingMore ? <><LoaderCircle size={17} className="post-comments-spinner" aria-hidden="true" /> Yükleniyor…</> : "Daha fazla gönderi göster"}</button></div> : null}
  </>;
}

export function PaginatedPostGrid(props: {
  initialPosts: RealPost[];
  initialNextCursor: string | null;
  currentUser: FeedPlayer;
  mode: PostFeedRequestMode;
  ownerId?: string;
  showFollow?: boolean;
}) {
  const mutation = useContext(PostMutationContext);
  const pageKey = postPageRevision(props.initialPosts, props.initialNextCursor);
  if (mutation) return <PaginatedPostGridContent key={pageKey} {...props} />;
  return <PostMutationProvider initialPosts={props.initialPosts}><PaginatedPostGridContent key={pageKey} {...props} /></PostMutationProvider>;
}

export function RealFeed({ initialPosts, initialNextCursor, territories, currentUser, explore = false }: { initialPosts: RealPost[]; initialNextCursor: string | null; territories: PostableTerritory[]; currentUser: FeedPlayer; explore?: boolean }) {
  const { dictionary: copy } = useI18n();
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [territoryId, setTerritoryId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [mapSnapshot, setMapSnapshot] = useState("");
  const [mapView, setMapView] = useState<MapCameraState | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [publishRetryAvailable, setPublishRetryAvailable] = useState(false);
  const [published, setPublished] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerDialogRef = useRef<HTMLElement>(null);
  const publishedTimerRef = useRef<number | null>(null);
  const publisherRef = useRef<PostPublishClient | null>(null);
  const publishGenerationRef = useRef(0);
  const draftReadyRef = useRef(false);
  const draftKey = postComposerDraftKey(currentUser.id);
  const publishAttemptKey = postPublishAttemptKey(currentUser.id);
  const selected = territories.find((territory) => territory.id === territoryId);

  useModalDialog(composerOpen, closeComposer, composerDialogRef);
  useEffect(() => {
    if (explore) return;
    const frame = window.requestAnimationFrame(() => {
      const draft = readPostComposerDraft(window.sessionStorage, draftKey);
      if (draft) {
        setTitle(draft.title);
        setText(draft.body);
        setTerritoryId(territories.some((territory) => territory.id === draft.territoryId) ? draft.territoryId : "");
      }
      draftReadyRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draftKey, explore, territories]);

  useEffect(() => {
    if (explore || !draftReadyRef.current) return;
    const timer = window.setTimeout(() => {
      writePostComposerDraft(window.sessionStorage, draftKey, { title, body: text, territoryId });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftKey, explore, territoryId, text, title]);

  useEffect(() => () => {
    publishGenerationRef.current += 1;
    publisherRef.current?.abort();
    if (publishedTimerRef.current !== null) window.clearTimeout(publishedTimerRef.current);
  }, []);

  function getPublisher() {
    if (!publisherRef.current) {
      publisherRef.current = new PostPublishClient(
        (input, init) => fetch(input, init),
        POST_PUBLISH_TIMEOUT_MS,
        undefined,
        createPostPublishAttemptStore(window.sessionStorage, publishAttemptKey),
      );
    }
    return publisherRef.current;
  }

  function closeComposer() {
    publishGenerationRef.current += 1;
    publisherRef.current?.abort();
    setPending(false);
    setPublishRetryAvailable(false);
    setComposerOpen(false);
  }

  async function handleImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (images.length + files.length > MEDIA_LIMITS.postImages.maxCount) { setPublishRetryAvailable(false); setError(`Bir paylaşımda en fazla ${MEDIA_LIMITS.postImages.maxCount} fotoğraf olabilir.`); return; }
    try {
      const loaded = await Promise.all(files.map((file) => optimizeImage(file)));
      setImages((current) => [...current, ...loaded].slice(0, MEDIA_LIMITS.postImages.maxCount));
      setError("");
      setPublishRetryAvailable(false);
    } catch (imageError) {
      setPublishRetryAvailable(false);
      setError(imageError instanceof Error ? imageError.message : "Fotoğraflar işlenemedi.");
    }
  }

  async function attemptPublish() {
    if (!selected || !mapSnapshot || !mapView || title.trim().length < CONTENT_LIMITS.postTitle.min) return;
    const publisher = getPublisher();
    if (publisher.isPending()) return;
    const generation = publishGenerationRef.current + 1;
    publishGenerationRef.current = generation;
    setPending(true);
    setError("");
    setPublishRetryAvailable(false);
    const payload: PostPublishPayload = { territoryId: selected.id, title, body: text, images, mapSnapshot, mapView };
    const result = await publisher.publish(payload, { online: navigator.onLine !== false });
    if (generation !== publishGenerationRef.current) return;
    setPending(false);
    if (result.status === "busy" || result.status === "aborted") return;
    if (result.status !== "success") {
      setError(result.message);
      setPublishRetryAvailable(true);
      return;
    }
    removePostComposerDraft(window.sessionStorage, draftKey);
    setComposerOpen(false); setTitle(""); setText(""); setTerritoryId(""); setMapSnapshot(""); setMapView(null); setImages([]); setPublished(true);
    if (publishedTimerRef.current !== null) window.clearTimeout(publishedTimerRef.current);
    publishedTimerRef.current = window.setTimeout(() => { setPublished(false); publishedTimerRef.current = null; }, 2200);
    router.refresh();
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void attemptPublish();
  }

  return (
    <>
      {!explore ? (
        <button type="button" className="composer-launcher" onClick={() => setComposerOpen(true)}>
          <span className="avatar avatar--md" style={{ "--avatar-color": currentUser.color, "--avatar-text-color": readableTextColor(currentUser.color) } as React.CSSProperties}>{currentUser.initials}</span><span>{territories.length ? copy.feed.immortalizeArea : copy.feed.closeFirstArea}</span><span className="composer-add"><Plus size={20} /></span>
        </button>
      ) : null}
      {published ? <div className="toast"><Sparkles size={18} /> {copy.feed.publishedToast}</div> : null}
      {initialPosts.length ? <PaginatedPostGrid key={`${explore ? "explore" : "following"}:${initialPosts[0]?.id}:${initialNextCursor ?? "end"}`} initialPosts={initialPosts} initialNextCursor={initialNextCursor} currentUser={currentUser} mode={explore ? "explore" : "following"} showFollow={explore} /> : (
        <div className="real-empty-state"><span><MapPin size={26} /></span><h3>{explore ? copy.feed.exploreEmptyTitle : copy.feed.followingEmptyTitle}</h3><p>{explore ? copy.feed.exploreEmptyBody : territories.length ? "Kapladığın alanlardan birini paylaş ve gerçek akışını başlat." : "Haritaya geç, gerçek veya sanal konumla ilk döngünü kapat."}</p>{!explore ? <button type="button" className="primary-button" onClick={() => territories.length ? setComposerOpen(true) : router.push("/play")}>{territories.length ? copy.feed.createFirstPost : copy.feed.goToMap}</button> : null}</div>
      )}
      {composerOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section ref={composerDialogRef} className="composer-modal" role="dialog" aria-modal="true" aria-labelledby="real-composer-title" tabIndex={-1}>
            <header className="modal-header"><div><span className="eyebrow">{copy.feed.realPost}</span><h2 id="real-composer-title">{copy.feed.immortalizeTitle}</h2></div><button type="button" className="icon-button" onClick={closeComposer} aria-label={copy.dialogs.closeDialog}><X size={21} /></button></header>
            {error ? <div className="form-error composer-publish-error" role="alert"><span>{error}</span>{publishRetryAvailable ? <button type="button" onClick={() => void attemptPublish()} disabled={pending}>{pending ? "Deneniyor…" : "Yeniden dene"}</button> : null}</div> : null}
            <form onSubmit={publish}>
              <label className="composer-text-field"><span>{copy.feed.title} <small>{title.length}/{CONTENT_LIMITS.postTitle.max}</small></span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={copy.feed.titlePlaceholder} minLength={CONTENT_LIMITS.postTitle.min} maxLength={CONTENT_LIMITS.postTitle.max} required autoFocus /></label>
              <label className="composer-text-field"><span>{copy.feed.description} <small>{text.length}/{CONTENT_LIMITS.postBody.max}</small></span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={copy.feed.descriptionPlaceholder} maxLength={CONTENT_LIMITS.postBody.max} /></label>
              <div className="field-block"><label htmlFor="real-territory-select"><MapPin size={17} /> {copy.feed.relatedArea} <strong>{copy.feed.required}</strong></label><select id="real-territory-select" value={territoryId} onChange={(event) => { setTerritoryId(event.target.value); setMapSnapshot(""); setMapView(null); }} required><option value="">{copy.feed.chooseArea}</option>{territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name} · +{territory.newlyAddedAreaKm2.toFixed(3)} km²</option>)}</select></div>
              {selected ? <div className="composer-map-preview"><TerritoryFrameEditor key={selected.id} territory={selected} ownerUsername={selected.ownerUsername} onSave={(snapshot, view) => { setMapSnapshot(snapshot); setMapView(view); }} /></div> : <div className="empty-snapshot"><MapPin size={24} /><span>{territories.length ? copy.feed.chooseAreaFrameHint : copy.feed.noRealArea}</span></div>}
              <PhotoSelectionGrid images={images} onChange={setImages} />
              <div className="composer-footer"><input ref={fileRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImages} tabIndex={-1} /><button type="button" className="secondary-button" onClick={() => fileRef.current?.click()} disabled={images.length >= MEDIA_LIMITS.postImages.maxCount}><ImagePlus size={18} /> {copy.feed.addPhoto} <small>{images.length}/{MEDIA_LIMITS.postImages.maxCount}</small></button><button type="submit" className="primary-button" disabled={!selected || !mapSnapshot || !mapView || title.trim().length < CONTENT_LIMITS.postTitle.min || pending}><Send size={18} /> {pending ? copy.feed.publishing : copy.feed.share}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
