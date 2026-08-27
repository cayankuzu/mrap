import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { RealLeaderboard } from "@/components/RealLeaderboard";
import { requireCurrentUser } from "@/lib/auth";
import { getLeaderboard } from "@/lib/repository";

export const metadata: Metadata = { title: "Sıralama" };
export default async function LeaderboardPage() {
  const user = await requireCurrentUser();
  const [entries, cityEntries] = await Promise.all([
    getLeaderboard(),
    getLeaderboard(user.cityId),
  ]);
  return <div className="content-page leaderboard-page"><header className="page-header"><div><span className="eyebrow">Şehir ve dünya</span><h1>Sıralama</h1><p>Benzersiz sahiplik alanına göre güncel oyuncu sıralaması.</p></div><span className="page-icon"><Trophy size={21} /></span></header><RealLeaderboard entries={entries} cityEntries={cityEntries} currentUserId={user.id} currentCity={user.city} /></div>;
}
