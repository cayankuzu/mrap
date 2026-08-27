import type { Metadata } from "next";
import { Camera, MapPin, Route, Trophy } from "lucide-react";
import { ProfileActions } from "@/components/ProfileActions";
import { ProfilePostTabs } from "@/components/ProfilePostTabs";
import { SocialConnections } from "@/components/SocialConnections";
import { UserAvatar } from "@/components/UserAvatar";
import { requireCurrentUser } from "@/lib/auth";
import { toFeedPlayerReference } from "@/lib/feed-player";
import { getLeaderboardRank, getUserStats, listPostPage, listSavedPostPage } from "@/lib/repository";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const [postPage, savedPostPage, stats, rank] = await Promise.all([
    listPostPage(user.id, "mine"),
    listSavedPostPage(user.id),
    getUserStats(user.id),
    getLeaderboardRank(user.id),
  ]);
  return <div className="content-page profile-page">
    <section className="profile-hero">
      <div className="profile-cover real-profile-cover" style={user.coverData ? { backgroundImage: `url(${user.coverData})` } : undefined}><div className={`profile-pattern pattern-${user.pattern}`} style={{ "--profile-color": user.color } as React.CSSProperties}><span>@{user.username} · @{user.username} · @{user.username}</span></div></div>
      <ProfileActions />
      <div className="profile-identity"><UserAvatar user={user} size="xl" /><div><h1>{user.displayName}</h1><span>@{user.username} · <MapPin size={14} /> {user.city}, {user.country}</span><p>{user.bio || "Henüz bir biyografi eklemedin. İlk rotan hikâyenin başlangıcı olsun."}</p></div></div>
      <div className="profile-social"><SocialConnections followersCount={stats.followers} followingCount={stats.following} userId={user.id} /><span className="profile-joined">{new Date(user.createdAt).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })} tarihinden beri</span></div>
    </section>
    <section className="profile-stats-grid">
      <article><span className="stat-icon"><MapPin size={20} /></span><div><small>Sahip olunan alan</small><strong>{Number(stats.area).toFixed(3)} km²</strong><em>Benzersiz sahiplik</em></div></article>
      <article><span className="stat-icon"><Route size={20} /></span><div><small>Toplam mesafe</small><strong>{Number(stats.distance).toFixed(2)} km</strong><em>İzlenen bütün yol</em></div></article>
      <article><span className="stat-icon"><Camera size={20} /></span><div><small>Kapatılan alan</small><strong>{Number(stats.closed_area).toFixed(3)} km²</strong><em>{stats.routes} başarılı kapatma</em></div></article>
      <article><span className="stat-icon"><Trophy size={20} /></span><div><small>Genel sıra</small><strong>{rank ? `#${rank}` : "—"}</strong><em>Benzersiz alana göre</em></div></article>
    </section>
    <ProfilePostTabs posts={postPage.posts} postsNextCursor={postPage.nextCursor} postsTotal={postPage.total} savedPosts={savedPostPage.posts} savedNextCursor={savedPostPage.nextCursor} savedTotal={savedPostPage.total} currentUser={toFeedPlayerReference(user)} showSaved />
  </div>;
}
