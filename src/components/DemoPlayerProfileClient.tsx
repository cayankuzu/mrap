"use client";

import { Camera, LockKeyhole, MapPin, Route, Trophy } from "lucide-react";
import { DemoFollowButton } from "@/components/DemoFollowButton";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { PostCard } from "@/components/PostCard";
import { ProfileAvatarMedia, ProfileCoverMedia } from "@/components/ProfileMedia";
import { SocialConnections } from "@/components/SocialConnections";
import { demoFollowRelation, type DemoFollowRelation } from "@/lib/demo-social-state";
import type { DemoPlayer } from "@/lib/demo-profile";
import type { Post } from "@/lib/data";
import type { SocialConnection } from "@/lib/models";

export function DemoPlayerProfileClient({
  user,
  posts,
  followers,
  following,
  rank,
}: {
  user: DemoPlayer;
  posts: Post[];
  followers: SocialConnection[];
  following: SocialConnection[];
  rank: number;
}) {
  const { social } = useDemoProfile();
  const initialRelation = user.relation as DemoFollowRelation;
  const relation = demoFollowRelation(social, user.username, initialRelation);
  const canView = user.accountVisibility === "public" || relation === "following";
  const followerCount = Math.max(0, user.followers + (relation === "following" ? 1 : 0) - (initialRelation === "following" ? 1 : 0));
  const totalDistanceKm = user.routes * 3.4;
  const closedAreaKm2 = user.areaKm2 * 1.18;

  return <div className="content-page player-profile-page profile-page">
    <section className="profile-hero player-profile-hero" style={{ "--profile-color": user.color } as React.CSSProperties}>
      <ProfileCoverMedia user={user} />
      <div className="profile-identity player-profile-identity">
        <ProfileAvatarMedia user={user} />
        <div>
          <span className="eyebrow">{user.accountVisibility === "private" ? <><LockKeyhole size={12} /> Gizli hesap</> : "Herkese açık hesap"}</span>
          <h1>{user.displayName}</h1>
          <span>@{user.username} · <MapPin size={13} /> {user.city}, {user.country}</span>
          <p>{user.bio || "Bu kaşif henüz biyografi eklememiş."}</p>
        </div>
        <DemoFollowButton username={user.username} accountVisibility={user.accountVisibility} initialRelation={initialRelation} />
      </div>
      <div className="profile-social">
        <SocialConnections followers={followers} following={following} followersCount={followerCount} followingCount={following.length} profileHrefPrefix="/demo/users" accessLocked={!canView} />
        <span className="profile-joined">{new Date(user.createdAt).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })} tarihinden beri</span>
      </div>
    </section>

    <section className="profile-stats-grid">
      <article><span className="stat-icon"><MapPin size={20} /></span><div><small>Sahip olunan alan</small><strong>{user.areaKm2.toFixed(3)} km²</strong><em>Benzersiz sahiplik</em></div></article>
      <article><span className="stat-icon"><Route size={20} /></span><div><small>Toplam mesafe</small><strong>{totalDistanceKm.toFixed(2)} km</strong><em>İzlenen bütün yol</em></div></article>
      <article><span className="stat-icon"><Camera size={20} /></span><div><small>Kapatılan alan</small><strong>{closedAreaKm2.toFixed(3)} km²</strong><em>{user.routes} başarılı kapatma</em></div></article>
      <article><span className="stat-icon"><Trophy size={20} /></span><div><small>Genel sıra</small><strong>#{rank}</strong><em>Benzersiz alana göre</em></div></article>
    </section>

    {canView ? <section className="profile-posts-section">
      <header className="profile-content-tabs"><span className="is-active">Gönderiler · {posts.length}</span></header>
      {posts.length ? <div className="adaptive-post-flow">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <div className="real-empty-state profile-post-empty"><span><MapPin size={26} /></span><h3>Henüz gönderi yok</h3><p>Bu demo kullanıcısının yeni harita hikâyeleri burada görünecek.</p></div>}
    </section> : <section className="private-profile-lock"><LockKeyhole size={28} /><h2>Bu hesap gizli</h2><p>{relation === "requested" ? "Takip isteğin gönderildi. Kabul edildiğinde gönderileri görebileceksin." : "Gönderilerini görmek için takip isteğinin kabul edilmesi gerekiyor."}</p></section>}
  </div>;
}
