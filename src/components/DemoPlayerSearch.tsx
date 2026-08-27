"use client";

import Link from "next/link";
import { LockKeyhole, MapPin, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import type { PlayerSearchResult } from "@/lib/models";
import { normalizeUserSearchText } from "@/lib/user-search";

export function DemoPlayerSearch({ players }: { players: PlayerSearchResult[] }) {
  const [query, setQuery] = useState("");
  const [focusWithin, setFocusWithin] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeUserSearchText(deferredQuery);
  const searchActive = focusWithin && normalizedQuery.length > 0;
  const filteredPlayers = useMemo(() => {
    if (!normalizedQuery) return [];
    return players.filter((player) => [player.displayName, player.username, player.city].some((value) => normalizeUserSearchText(value).includes(normalizedQuery)));
  }, [normalizedQuery, players]);

  return <section
    className={`player-search-card player-search-card--compact${searchActive ? " is-searching" : ""}`}
    role="search"
    aria-label="Kullanıcı ara"
    onFocusCapture={() => setFocusWithin(true)}
    onBlurCapture={(event) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setFocusWithin(false);
    }}
  >
    <label className="search-field"><Search size={18} /><input type="search" role="combobox" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad veya @kullanıcı adı" aria-label="Demo kullanıcılarında ara" aria-expanded={searchActive} aria-autocomplete="list" aria-controls={searchActive ? "demo-player-search-results" : undefined} maxLength={40} autoComplete="off" /></label>
    {searchActive ? <div className="player-search-popover" id="demo-player-search-results">
      <span className="visually-hidden" role="status" aria-live="polite">{filteredPlayers.length} kullanıcı bulundu.</span>
      <div className="player-search-results">
        {filteredPlayers.map((player) => <article key={player.id}>
          <UserAvatar user={player} href={`/demo/users/${encodeURIComponent(player.username)}`} />
          <Link href={`/demo/users/${encodeURIComponent(player.username)}`}><strong>{player.displayName}{player.accountVisibility === "private" ? <LockKeyhole size={12} /> : null}</strong><small>@{player.username} · <MapPin size={11} /> {player.city}</small><em>{player.followers.toLocaleString("tr-TR")} takipçi · {player.routes} alan</em></Link>
        </article>)}
        {!filteredPlayers.length ? <div className="player-search-empty">Bu aramayla eşleşen demo kullanıcısı yok.</div> : null}
      </div>
    </div> : null}
  </section>;
}
