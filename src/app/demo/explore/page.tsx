import { Compass } from "lucide-react";
import { DemoPlayerSearch } from "@/components/DemoPlayerSearch";
import { PostCard } from "@/components/PostCard";
import { discoverPosts } from "@/lib/data";
import { DEMO_PLAYERS } from "@/lib/demo-profile";

export default function DemoExplorePage() {
  return (
    <div className="content-page explore-page">
      <header className="explore-pro-header"><span className="explore-pro-icon"><Compass size={25} /></span><div><span className="eyebrow">Topluluk · Demo</span><h1>Keşfet</h1><p>Takip etmediğin kaşiflerin alanlarını, rotalarını ve harita hikâyelerini bul.</p></div></header>
      <DemoPlayerSearch players={DEMO_PLAYERS} />
      <div className="explore-feed-heading"><div><span className="eyebrow">Yeni alanlar</span><h2>Topluluğun harita akışı</h2></div><span>Ekranına uyumlu · güncel</span></div>
      <div className="adaptive-post-flow">{discoverPosts.map((post) => <PostCard key={post.id} post={post} showFollow />)}</div>
    </div>
  );
}
