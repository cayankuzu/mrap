"use client";

import { useState } from "react";
import { Bookmark, Grid2X2 } from "lucide-react";
import { PostCard } from "@/components/PostCard";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { useI18n } from "@/i18n/I18nProvider";
import type { Post } from "@/lib/data";

export function DemoProfileTabs({ posts, availablePosts }: { posts: Post[]; availablePosts: Post[] }) {
  const { dictionary: copy } = useI18n();
  const { social } = useDemoProfile();
  const [tab, setTab] = useState<"posts" | "saved">("posts");
  const savedPosts = availablePosts.filter((post) => social.savedPostIds.includes(post.id));
  const items = tab === "posts" ? posts : savedPosts;
  return <section className="profile-posts-section"><header className="profile-content-tabs" aria-label={copy.feed.profileContents}><button type="button" className={tab === "posts" ? "is-active" : ""} onClick={() => setTab("posts")}><Grid2X2 size={17} /> {copy.feed.posts} <span>{posts.length}</span></button><button type="button" className={tab === "saved" ? "is-active" : ""} onClick={() => setTab("saved")}><Bookmark size={17} /> {copy.feed.saved} <span>{savedPosts.length}</span></button></header>{items.length ? <div className="adaptive-post-flow">{items.map((post) => <PostCard key={post.id} post={post} />)}</div> : <div className="real-empty-state profile-post-empty"><span><Bookmark size={26} /></span><h3>Kaydedilmiş gönderi yok</h3><p>Demo akışında kaydettiğin paylaşımlar burada görünür.</p></div>}</section>;
}
