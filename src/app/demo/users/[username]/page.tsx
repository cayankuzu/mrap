import { notFound } from "next/navigation";
import { DemoPlayerProfileClient } from "@/components/DemoPlayerProfileClient";
import { discoverPosts, followingPosts } from "@/lib/data";
import { DEMO_PLAYERS, getDemoConnections, getDemoPlayer } from "@/lib/demo-profile";

export default async function DemoPlayerProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const username = decodeURIComponent((await params).username);
  const user = getDemoPlayer(username);
  if (!user) notFound();
  const posts = [...followingPosts, ...discoverPosts].filter((post) => post.user.handle === username);
  const connections = getDemoConnections(username);
  return <DemoPlayerProfileClient user={user} posts={posts} followers={connections.followers} following={connections.following} rank={DEMO_PLAYERS.findIndex((player) => player.username === username) + 1} />;
}
