import { FeedClient } from "@/components/FeedClient";
import { followingPosts } from "@/lib/data";

export default function DemoHomePage() {
  return <div className="content-page feed-page"><div className="feed-layout"><section className="feed-column"><header className="page-header feed-header"><div><span className="eyebrow">Takip ettiklerin · Demo</span><h1>Akışın</h1></div></header><FeedClient initialPosts={followingPosts} /></section></div></div>;
}
