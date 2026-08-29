import type { Metadata } from "next";
import { Camera, LockKeyhole, MapPin, Route, Trophy } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { FollowButton } from "@/components/FollowButton";
import { ProfileAvatarMedia, ProfileCoverMedia } from "@/components/ProfileMedia";
import { ProfilePostTabs } from "@/components/ProfilePostTabs";
import { SocialConnections } from "@/components/SocialConnections";
import { requireCurrentUser } from "@/lib/auth";
import { toFeedPlayerReference } from "@/lib/feed-player";
import { normalizePostResourceId, postDetailPath } from "@/lib/post-resource";
import { getLeaderboardRank, getPlayerProfile, listUserPostPage } from "@/lib/repository";

export const metadata: Metadata = { title: "Oyuncu profili" };

export default async function PlayerProfilePage({ params, searchParams }: { params: Promise<{ username: string }>; searchParams: Promise<{ post?: string | string[] }> }) {
  const viewer = await requireCurrentUser();
  const legacyPostId = normalizePostResourceId((await searchParams).post);
  if (legacyPostId) redirect(postDetailPath(legacyPostId));
  const username = decodeURIComponent((await params).username);
  if (username === viewer.username) redirect("/profile");
  const profile = await getPlayerProfile(username, viewer.id);
  if (!profile) notFound();
  const [postPage, rank] = await Promise.all([
    profile.canView ? listUserPostPage(viewer.id, profile.user.id) : Promise.resolve({ posts: [], nextCursor: null, total: 0 }),
    getLeaderboardRank(profile.user.id),
  ]);
  return <div className="content-page player-profile-page profile-page">
    <section className="profile-hero player-profile-hero" style={{ "--profile-color": profile.user.color } as React.CSSProperties}>
      <ProfileCoverMedia user={profile.user} />
      <div className="profile-identity player-profile-identity"><ProfileAvatarMedia user={profile.user} /><div><span className="eyebrow">{profile.user.accountVisibility === "private" ? <><LockKeyhole size={12} /> Gizli hesap</> : "Herkese açık hesap"}</span><h1>{profile.user.displayName}</h1><span>@{profile.user.username} · <MapPin size={13} /> {profile.user.city}, {profile.user.country}</span><p>{profile.user.bio || "Bu kaşif henüz biyografi eklememiş."}</p></div><FollowButton userId={profile.user.id} initialRelation={profile.relation === "following" ? "following" : profile.relation === "requested" ? "requested" : "none"} /></div>
      <div className="profile-social"><SocialConnections followersCount={profile.stats.followers} followingCount={profile.stats.following} userId={profile.user.id} /><span className="profile-joined">{new Date(profile.user.createdAt).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })} tarihinden beri</span></div>
    </section>
    <section className="profile-stats-grid">
      <article><span className="stat-icon"><MapPin size={20} /></span><div><small>Sahip olunan alan</small><strong>{Number(profile.stats.area).toFixed(3)} km²</strong><em>Benzersiz sahiplik</em></div></article>
      <article><span className="stat-icon"><Route size={20} /></span><div><small>Toplam mesafe</small><strong>{Number(profile.stats.distance).toFixed(2)} km</strong><em>İzlenen bütün yol</em></div></article>
      <article><span className="stat-icon"><Camera size={20} /></span><div><small>Kapatılan alan</small><strong>{Number(profile.stats.closed_area).toFixed(3)} km²</strong><em>{profile.stats.routes} başarılı kapatma</em></div></article>
      <article><span className="stat-icon"><Trophy size={20} /></span><div><small>Genel sıra</small><strong>{rank ? `#${rank}` : "—"}</strong><em>Benzersiz alana göre</em></div></article>
    </section>
    {profile.canView ? <ProfilePostTabs posts={postPage.posts} postsNextCursor={postPage.nextCursor} postsTotal={postPage.total} currentUser={toFeedPlayerReference(viewer)} ownerId={profile.user.id} /> : <section className="private-profile-lock"><LockKeyhole size={28} /><h2>Bu hesap gizli</h2><p>Gönderilerini görmek için takip isteğinin kabul edilmesi gerekiyor.</p></section>}
  </div>;
}
