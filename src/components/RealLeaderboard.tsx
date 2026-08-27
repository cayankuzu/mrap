"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Crown, MapPin, Search, Trophy } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { LEADERBOARD_LIMIT } from "@/lib/content-limits";
import { filterLeaderboardEntries } from "@/lib/leaderboard-filter";
import type { LeaderboardEntry } from "@/lib/models";
import { useI18n } from "@/i18n/I18nProvider";

export function RealLeaderboard({ entries, cityEntries, currentUserId, currentCity }: { entries: LeaderboardEntry[]; cityEntries: LeaderboardEntry[]; currentUserId: string; currentCity: string }) {
  const { dictionary: copy } = useI18n();
  const [scope, setScope] = useState<"city" | "all">("all");
  const [query, setQuery] = useState("");
  const source = scope === "all" ? entries : cityEntries;
  const filtered = useMemo(() => filterLeaderboardEntries(source, query), [query, source]);

  return <div className="real-leaderboard">
    <div className="leaderboard-city-summary"><span><MapPin size={18} /></span><div><small>{copy.leaderboard.cityRanking}</small><strong>{currentCity}</strong></div><p>{copy.leaderboard.uniqueAreaHint}</p></div>
    <div className="real-leaderboard-tools"><div className="scope-tabs" role="tablist" aria-label={copy.leaderboard.scopeAria}><button type="button" role="tab" aria-selected={scope === "all"} className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>{copy.leaderboard.allPlayers}</button><button type="button" role="tab" aria-selected={scope === "city"} className={scope === "city" ? "is-active" : ""} onClick={() => setScope("city")}>{currentCity}</button></div><label className="search-field"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`İlk ${LEADERBOARD_LIMIT} oyuncuda ara`} aria-label={`${scope === "all" ? "Genel" : currentCity} sıralamasında oyuncu ara`} maxLength={40} autoComplete="off" /></label></div>
    <p className="leaderboard-result-note" role="status">{query ? `${filtered.length} oyuncu eşleşti. ` : ""}{scope === "all" ? "Genel" : currentCity} sıralamasının ilk {LEADERBOARD_LIMIT} oyuncusu gösteriliyor.</p>
    {filtered.length ? <div className="real-rank-list">{filtered.map((entry) => {
      const href = entry.id === currentUserId ? "/profile" : `/users/${encodeURIComponent(entry.username)}`;
      return <article key={entry.id} className={entry.id === currentUserId ? "is-you" : ""}><span className="real-rank-number">{entry.rank === 1 ? <Crown size={20} /> : entry.rank}</span><UserAvatar user={entry} href={href} /><Link href={href} className="real-rank-user"><strong>{entry.displayName}{entry.id === currentUserId ? " · Sen" : ""}</strong><small>@{entry.username} · <MapPin size={11} /> {entry.city}</small></Link><span className="real-rank-metric"><strong>{Number(entry.areaKm2).toFixed(3)} km²</strong><small>{entry.routes} alan kapatma</small></span></article>;
    })}</div> : <div className="real-empty-state"><span><Trophy size={26} /></span><h3>{copy.leaderboard.emptyTitle}</h3><p>{copy.leaderboard.emptyBody}</p></div>}
  </div>;
}
