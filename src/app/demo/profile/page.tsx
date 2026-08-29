"use client";

import { Camera, MapPin, Route, Trophy } from "lucide-react";
import { DemoProfileTabs } from "@/components/DemoProfileTabs";
import { ProfileActions } from "@/components/ProfileActions";
import { ProfileAvatarMedia, ProfileCoverMedia } from "@/components/ProfileMedia";
import { useDemoProfile } from "@/components/DemoProfileProvider";
import { SocialConnections } from "@/components/SocialConnections";
import { discoverPosts, followingPosts } from "@/lib/data";
import { DEMO_FOLLOWERS, DEMO_FOLLOWING } from "@/lib/demo-profile";

export default function DemoProfilePage() {
  const { user } = useDemoProfile();
  return <div className="content-page profile-page">
    <section className="profile-hero">
      <ProfileCoverMedia user={user} />
      <ProfileActions settingsHref="/demo/settings" demo />
      <div className="profile-identity"><ProfileAvatarMedia user={user} /><div><h1>{user.displayName}</h1><span>@{user.username} · <MapPin size={14} /> {user.city}, {user.country}</span><p>{user.bio || "Henüz bir biyografi eklemedin."}</p></div></div>
      <div className="profile-social"><SocialConnections followers={DEMO_FOLLOWERS} following={DEMO_FOLLOWING} profileHrefPrefix="/demo/users" /><span className="profile-joined">Demo profilin bu tarayıcıda saklanır</span></div>
    </section>
    <section className="profile-stats-grid">
      <article><span className="stat-icon"><MapPin size={20} /></span><div><small>Sahip olunan alan</small><strong>12,8 km²</strong><em>Benzersiz sahiplik</em></div></article>
      <article><span className="stat-icon"><Route size={20} /></span><div><small>Toplam mesafe</small><strong>28,4 km</strong><em>İzlenen bütün yol</em></div></article>
      <article><span className="stat-icon"><Camera size={20} /></span><div><small>Kapatılan alan</small><strong>15,6 km²</strong><em>34 başarılı kapatma</em></div></article>
      <article><span className="stat-icon"><Trophy size={20} /></span><div><small>Genel sıra</small><strong>#24</strong><em>Benzersiz alana göre</em></div></article>
    </section>
    <DemoProfileTabs posts={followingPosts} availablePosts={[...followingPosts, ...discoverPosts].filter((post, index, all) => all.findIndex((item) => item.id === post.id) === index)} />
  </div>;
}
