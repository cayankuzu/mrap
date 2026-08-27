import { Bell } from "lucide-react";
import Link from "next/link";
import { RealFeed } from "@/components/RealFeed";
import { requireCurrentUser } from "@/lib/auth";
import { toFeedPlayerReference } from "@/lib/feed-player";
import { listPostableTerritories, listPostPage } from "@/lib/repository";

export default async function HomePage() {
  const user = await requireCurrentUser();
  const [postPage, territories] = await Promise.all([
    listPostPage(user.id, "following"),
    listPostableTerritories(user.id),
  ]);
  return (
    <div className="content-page feed-page">
      <div className="feed-layout">
        <section className="feed-column">
          <header className="page-header feed-header"><div><span className="eyebrow">Gerçek hesabın</span><h1>Akışın</h1></div><Link href="/notifications" className="desktop-notification-button" aria-label="Bildirimler"><Bell size={20} /></Link></header>
          <RealFeed initialPosts={postPage.posts} initialNextCursor={postPage.nextCursor} territories={territories} currentUser={toFeedPlayerReference(user)} />
        </section>
      </div>
    </div>
  );
}
