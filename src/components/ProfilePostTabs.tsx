"use client";

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, Grid2X2, MapPin } from "lucide-react";
import { PaginatedPostGrid, PostMutationProvider } from "@/components/RealFeed";
import { useI18n } from "@/i18n/I18nProvider";
import type { FeedPlayer, RealPost } from "@/lib/models";
import { updateSavedProjection, updateSavedTotal } from "@/lib/post-mutation-state";

export function ProfilePostTabs({
  posts,
  postsNextCursor = null,
  postsTotal = posts.length,
  savedPosts = [],
  savedNextCursor = null,
  savedTotal = savedPosts.length,
  currentUser,
  showSaved = false,
  ownerId,
}: {
  posts: RealPost[];
  postsNextCursor?: string | null;
  postsTotal?: number;
  savedPosts?: RealPost[];
  savedNextCursor?: string | null;
  savedTotal?: number;
  currentUser: FeedPlayer;
  showSaved?: boolean;
  ownerId?: string;
}) {
  const { dictionary: copy } = useI18n();
  const [tab, setTab] = useState<"posts" | "saved">("posts");
  const [savedProjection, setSavedProjection] = useState({ source: savedPosts, sourceTotal: savedTotal, items: savedPosts, total: savedTotal });
  const savedSourceChanged = savedProjection.source !== savedPosts || savedProjection.sourceTotal !== savedTotal;
  const savedItems = savedSourceChanged ? savedPosts : savedProjection.items;
  const savedDisplayTotal = savedSourceChanged ? savedTotal : savedProjection.total;
  const tabsetId = useId();
  const postsTabRef = useRef<HTMLButtonElement>(null);
  const savedTabRef = useRef<HTMLButtonElement>(null);
  const postsTabId = `${tabsetId}-posts`;
  const savedTabId = `${tabsetId}-saved`;
  const postsPanelId = `${tabsetId}-posts-panel`;
  const savedPanelId = `${tabsetId}-saved-panel`;
  const mutationPosts = useMemo(() => {
    const known = new Set<string>();
    return [...posts, ...savedItems].filter((post) => {
      if (known.has(post.id)) return false;
      known.add(post.id);
      return true;
    });
  }, [posts, savedItems]);
  const authoritativePosts = useMemo(() => {
    const known = new Set<string>();
    return [...posts, ...savedPosts].filter((post) => {
      if (known.has(post.id)) return false;
      known.add(post.id);
      return true;
    });
  }, [posts, savedPosts]);

  const handleSavedChange = useCallback((post: RealPost, saved: boolean, previous: boolean) => {
    setSavedProjection((current) => {
      const sourceChanged = current.source !== savedPosts || current.sourceTotal !== savedTotal;
      const currentItems = sourceChanged ? savedPosts : current.items;
      const currentTotal = sourceChanged ? savedTotal : current.total;
      return {
        source: savedPosts,
        sourceTotal: savedTotal,
        items: updateSavedProjection(currentItems, post, saved),
        total: updateSavedTotal(currentTotal, saved, previous),
      };
    });
  }, [savedPosts, savedTotal]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!showSaved || (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End")) return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "posts" : "saved";
    setTab(next);
    window.requestAnimationFrame(() => (next === "posts" ? postsTabRef : savedTabRef).current?.focus());
  }

  return <PostMutationProvider initialPosts={mutationPosts} authoritativePosts={authoritativePosts} onSavedChange={handleSavedChange}><section className="profile-posts-section">
    <header className="profile-content-tabs" role="tablist" aria-label={copy.feed.profileContents}>
      <button ref={postsTabRef} id={postsTabId} type="button" role="tab" aria-selected={tab === "posts"} aria-controls={postsPanelId} tabIndex={tab === "posts" ? 0 : -1} className={tab === "posts" ? "is-active" : ""} onClick={() => setTab("posts")} onKeyDown={handleTabKeyDown}><Grid2X2 size={17} /> {copy.feed.posts} <span>{postsTotal}</span></button>
      {showSaved ? <button ref={savedTabRef} id={savedTabId} type="button" role="tab" aria-selected={tab === "saved"} aria-controls={savedPanelId} tabIndex={tab === "saved" ? 0 : -1} className={tab === "saved" ? "is-active" : ""} onClick={() => setTab("saved")} onKeyDown={handleTabKeyDown}><Bookmark size={17} /> {copy.feed.saved} <span>{savedDisplayTotal}</span></button> : null}
    </header>
    <div id={postsPanelId} role="tabpanel" aria-labelledby={postsTabId} tabIndex={0} hidden={tab !== "posts"}>
      {posts.length ? <PaginatedPostGrid key={`posts:${posts[0]?.id}:${postsNextCursor ?? "end"}`} initialPosts={posts} initialNextCursor={postsNextCursor} currentUser={currentUser} mode={ownerId ? "user" : "mine"} ownerId={ownerId} /> : <div className="real-empty-state profile-post-empty"><span><MapPin size={26} /></span><h3>{copy.feed.noPostsTitle}</h3><p>{copy.feed.noPostsBody}</p></div>}
    </div>
    {showSaved ? <div id={savedPanelId} role="tabpanel" aria-labelledby={savedTabId} tabIndex={0} hidden={tab !== "saved"}>
      {savedItems.length || savedNextCursor ? <PaginatedPostGrid initialPosts={savedItems} initialNextCursor={savedNextCursor} currentUser={currentUser} mode="saved" /> : <div className="real-empty-state profile-post-empty"><span><Bookmark size={26} /></span><h3>{copy.feed.noSavedTitle}</h3><p>{copy.feed.noSavedBody}</p></div>}
    </div> : null}
  </section></PostMutationProvider>;
}
