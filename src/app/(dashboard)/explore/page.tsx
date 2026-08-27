import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { RealFeed } from "@/components/RealFeed";
import { PlayerSearch } from "@/components/PlayerSearch";
import { requireCurrentUser } from "@/lib/auth";
import { toFeedPlayerReference } from "@/lib/feed-player";
import { listPostPage } from "@/lib/repository";

export const metadata: Metadata = { title: "Keşfet" };

export default async function ExplorePage() {
  const user = await requireCurrentUser();
  const postPage = await listPostPage(user.id, "explore");
  return (
    <div className="content-page explore-page">
      <header className="explore-pro-header"><span className="explore-pro-icon"><Compass size={25} /></span><div><span className="eyebrow">Gerçek topluluk</span><h1>Keşfet</h1><p>Takip etmediğin oyuncuların yeni alanlarını, rotalarını ve harita hikâyelerini bul.</p></div></header>
      <PlayerSearch />
      <div className="explore-feed-heading"><div><span className="eyebrow">Yeni alanlar</span><h2>Topluluğun harita akışı</h2></div><span>Ekranına uyumlu · güncel</span></div>
      <RealFeed initialPosts={postPage.posts} initialNextCursor={postPage.nextCursor} territories={[]} currentUser={toFeedPlayerReference(user)} explore />
    </div>
  );
}
