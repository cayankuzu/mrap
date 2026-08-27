"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Heart, MessageCircle, Send } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { MapSnapshot } from "@/components/MapSnapshot";
import { PostMediaCarousel } from "@/components/PostMediaCarousel";
import { PostCommentsDialog, type PostCommentViewModel } from "@/components/PostCommentsDialog";
import { PostLikesDialog, type LikeListUser } from "@/components/PostLikesDialog";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { getDemoPlayer } from "@/lib/demo-profile";
import { demoFollowRelation } from "@/lib/demo-social-state";
import { useLongPress } from "@/lib/use-long-press";
import type { Post } from "@/lib/data";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

const DEMO_LIKERS: LikeListUser[] = [
  { id: "demo-defne", username: "defnek", displayName: "Defne Kaya", initials: "DK", color: "#ff8066", avatarData: null },
  { id: "demo-emir", username: "emiruns", displayName: "Emir Arslan", initials: "EA", color: "#8f7cff", avatarData: null },
  { id: "demo-ceren", username: "cerenstep", displayName: "Ceren Yılmaz", initials: "CY", color: "#48c9a5", avatarData: null },
  { id: "demo-selin", username: "selinmoves", displayName: "Selin Işık", initials: "Sİ", color: "#f3b83f", avatarData: null },
];

const DEMO_COMMENT_TEXTS = [
  "Renk seçimi bu rotaya çok yakışmış.",
  "Bir sonraki yürüyüşte bu hattı ben de deneyeceğim.",
  "Alan sınırı haritada çok net görünüyor.",
  "Rotanın kapanış noktası gerçekten iyi düşünülmüş.",
  "Şehrin bu kısmını böyle görmek çok güzel.",
  "Yeni alan için tebrikler!",
] as const;

function demoComment(post: Post, index: number): PostCommentViewModel {
  const user = DEMO_LIKERS[index % DEMO_LIKERS.length];
  return {
    id: `${post.id}-comment-${index}`,
    body: DEMO_COMMENT_TEXTS[index % DEMO_COMMENT_TEXTS.length],
    user,
    createdAtLabel: index === 0 ? "şimdi" : `${index + 2} dk`,
  };
}

export function PostCard({ post, showFollow = false }: { post: Post; showFollow?: boolean }) {
  const { dictionary: copy } = useI18n();
  const { user: demoUser, social, togglePostLike, togglePostSave, toggleFollow, markPostShared, addPostComment } = useDemoProfile();
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [loadedDemoCount, setLoadedDemoCount] = useState(Math.min(6, post.comments));
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [likesOpen, setLikesOpen] = useState(false);
  const liked = social.likedPostIds.includes(post.id);
  const saved = social.savedPostIds.includes(post.id);
  const demoPlayer = getDemoPlayer(post.user.handle);
  const initialRelation = demoPlayer?.relation ?? "none";
  const relation = demoFollowRelation(social, post.user.handle, initialRelation);
  const shared = social.sharedPostIds.includes(post.id);
  const storedComments = social.commentsByPost[post.id] ?? [];
  const comments: PostCommentViewModel[] = [
    ...storedComments.map((item) => ({ ...item, user: { ...demoUser, profileHref: "/demo/profile" }, createdAtLabel: "şimdi" })),
    ...Array.from({ length: loadedDemoCount }, (_, index) => demoComment(post, index)),
  ];
  const commentCount = post.comments + storedComments.length;
  const likeLongPress = useLongPress(() => togglePostLike(post.id), () => setLikesOpen(true));
  const shareTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
  }, []);

  async function sharePost() {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/demo/users/${post.user.handle}#post-${post.id}`);
      markPostShared(post.id);
      setCopyFeedback(true);
      if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = window.setTimeout(() => { setCopyFeedback(false); shareTimerRef.current = null; }, 1800);
    } catch {
      setCopyFeedback(false);
    }
  }

  function submitComment(body: string) {
    addPostComment(post.id, body);
    setComment("");
  }

  function loadMoreComments() {
    const nextCount = Math.min(post.comments, loadedDemoCount + 6);
    setLoadedDemoCount(nextCount);
  }

  return (
    <article className="post-card" id={`post-${post.id}`}>
      <header className="post-header">
        <Link href={`/demo/users/${post.user.handle}`}><Avatar user={post.user} /></Link>
        <div className="post-author">
          <Link href={`/demo/users/${post.user.handle}`}><strong>{post.user.name}</strong></Link>
          <span>@{post.user.handle} · {post.time}</span>
        </div>
        {showFollow ? <button className={`text-button${relation !== "none" ? " is-following" : ""}`} type="button" onClick={() => toggleFollow(post.user.handle, demoPlayer?.accountVisibility ?? "public", initialRelation)}>{relation === "following" ? copy.feed.following : relation === "requested" ? copy.feed.requested : copy.feed.follow}</button> : null}
      </header>

      <div className="post-story-copy"><h2>{post.title}</h2>{post.text ? <p className="post-copy">{post.text}</p> : null}</div>
      <MapSnapshot territory={post.territory} ownerHandle={post.user.handle} snapshotSrc={post.mapSnapshot} mapView={post.mapView} />
      <PostMediaCarousel items={post.imageSources?.length ? post.imageSources.map((src, index) => ({ id: `${post.id}-${index}`, src, alt: formatMessage(copy.feed.routePhotoAlt, { district: post.territory.district, index: index + 1 }) })) : (post.photos ?? (post.photo ? [post.photo] : [])).map((variant, index) => ({ id: `${post.id}-${index}`, variant, alt: formatMessage(copy.feed.routePhotoAlt, { district: post.territory.district, index: index + 1 }) }))} />

      <footer className="post-actions">
        <button type="button" className={liked ? "is-liked" : ""} {...likeLongPress} aria-pressed={liked} aria-haspopup="dialog" aria-expanded={likesOpen} aria-label={`${liked ? copy.feed.unlike : copy.feed.like}. ${copy.feed.likeLongPressHint}`}>
          <Heart size={20} fill={liked ? "currentColor" : "none"} /> {post.likes + (liked ? 1 : 0)}
        </button>
        <button type="button" onClick={() => setCommentOpen(true)} aria-haspopup="dialog" aria-expanded={commentOpen} aria-label={formatMessage(copy.feed.showCommentsAria, { count: commentCount })}>
          <MessageCircle size={20} /> {commentCount}
        </button>
        <button type="button" onClick={() => void sharePost()} className={shared || copyFeedback ? "is-shared" : ""} aria-pressed={shared}>
          <Send size={19} /> {copyFeedback ? copy.feed.copied : shared ? copy.feed.shared : copy.feed.share}
        </button>
        <button type="button" className={`save-action${saved ? " is-saved" : ""}`} onClick={() => togglePostSave(post.id)} aria-label={saved ? copy.feed.removeSavedPost : copy.feed.savePost} aria-pressed={saved}>
          <Bookmark size={20} fill={saved ? "currentColor" : "none"} />
        </button>
      </footer>

      <PostCommentsDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        comments={comments}
        total={commentCount}
        currentUser={{ ...demoUser, profileHref: "/demo/profile" }}
        draft={comment}
        onDraftChange={setComment}
        onSubmit={submitComment}
        hasMore={loadedDemoCount < post.comments}
        onLoadMore={loadMoreComments}
        profilePrefix="/demo/users"
      />
      <PostLikesDialog open={likesOpen} onClose={() => setLikesOpen(false)} users={DEMO_LIKERS} total={post.likes + (liked ? 1 : 0)} profilePrefix="/demo/users" />
    </article>
  );
}
