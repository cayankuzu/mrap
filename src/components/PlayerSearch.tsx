"use client";

import Link from "next/link";
import { LockKeyhole, MapPin, Search, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import type { PlayerSearchResult } from "@/lib/models";
import { applyPlayerFollowResult } from "@/lib/player-follow-state";
import { normalizeUserSearchText } from "@/lib/user-search";

function relationLabel(relation: PlayerSearchResult["relation"]) {
  if (relation === "following") return "Takipte";
  if (relation === "requested") return "İstek gönderildi";
  return "Takip et";
}

export function PlayerSearch() {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerSearchResult[]>([]);
  const [focusWithin, setFocusWithin] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const pendingIdsRef = useRef(new Set<string>());
  const searchSequenceRef = useRef(0);
  const normalizedQuery = normalizeUserSearchText(query);
  const searchActive = focusWithin && normalizedQuery.length > 0;

  useEffect(() => {
    if (!searchActive) return;
    const controller = new AbortController();
    const sequence = ++searchSequenceRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearchError("");
      try {
        const response = await fetch(`/api/users?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
        const result = await response.json().catch(() => null) as { players?: PlayerSearchResult[]; error?: string } | null;
        if (sequence !== searchSequenceRef.current) return;
        if (!response.ok || !result?.players) {
          setSearchError(result?.error || "Kullanıcılar yüklenemedi.");
          return;
        }
        setPlayers(result.players);
        setSearchedQuery(normalizedQuery);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (sequence === searchSequenceRef.current) setSearchError("Arama yapılamadı. İnternet bağlantını kontrol edip yeniden dene.");
      } finally {
        if (sequence === searchSequenceRef.current) setLoading(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [normalizedQuery, searchActive]);

  function updateQuery(value: string) {
    setQuery(value);
    setPlayers([]);
    setSearchedQuery("");
    setSearchError("");
    setActionError("");
    setLoading(normalizeUserSearchText(value).length > 0);
  }

  async function follow(playerId: string) {
    if (pendingIdsRef.current.has(playerId)) return;
    const currentRelation = players.find((player) => player.id === playerId)?.relation;
    if (!currentRelation) return;
    pendingIdsRef.current.add(playerId);
    setPendingIds(new Set(pendingIdsRef.current));
    setActionError("");
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(playerId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desired: currentRelation === "none" }),
      });
      const result = await response.json().catch(() => null) as { status?: PlayerSearchResult["relation"]; error?: string } | null;
      if (!response.ok || !result?.status) {
        setActionError(result?.error || "Takip işlemi tamamlanamadı.");
        return;
      }
      setPlayers((current) => applyPlayerFollowResult(current, playerId, result.status!));
    } catch {
      setActionError("Takip işlemi tamamlanamadı. İnternet bağlantını kontrol edip yeniden dene.");
    } finally {
      pendingIdsRef.current.delete(playerId);
      setPendingIds(new Set(pendingIdsRef.current));
    }
  }

  return (
    <section
      className={`player-search-card player-search-card--compact${searchActive ? " is-searching" : ""}`}
      role="search"
      aria-label="Kullanıcı ara"
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setFocusWithin(false);
      }}
    >
      <label className="search-field">
        <Search size={18} />
        <input
          type="search"
          role="combobox"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Ad veya @kullanıcı adı"
          aria-label="Kullanıcı ara"
          aria-expanded={searchActive}
          aria-autocomplete="list"
          aria-controls={searchActive ? "player-search-results" : undefined}
          maxLength={40}
          autoComplete="off"
        />
        {loading && searchActive ? <i className="mini-loader" /> : null}
      </label>
      {searchActive ? (
        <div className="player-search-popover" id="player-search-results" aria-busy={loading}>
          <span className="visually-hidden" role="status" aria-live="polite">{loading ? "Kullanıcılar aranıyor." : searchedQuery === normalizedQuery ? `${players.length} kullanıcı bulundu.` : "Arama için yazmaya devam et."}</span>
          {searchError ? <div className="player-search-error" role="alert">{searchError}</div> : null}
          {actionError ? <div className="player-search-error" role="alert">{actionError}</div> : null}
          <div className="player-search-results">
            {players.map((player) => {
              const pending = pendingIds.has(player.id);
              return <article key={player.id}>
                <UserAvatar user={player} href={`/users/${encodeURIComponent(player.username)}`} />
                <Link href={`/users/${encodeURIComponent(player.username)}`}><strong>{player.displayName}{player.accountVisibility === "private" ? <LockKeyhole size={12} /> : null}</strong><small>@{player.username} · <MapPin size={11} /> {player.city}</small><em>{player.followers.toLocaleString("tr-TR")} takipçi · {player.routes} alan</em></Link>
                <button type="button" className={player.relation !== "none" ? "is-active" : ""} onClick={() => void follow(player.id)} disabled={pending} aria-busy={pending} aria-label={`${player.displayName}: ${relationLabel(player.relation)}`}><UserPlus size={15} /> {pending ? "İşleniyor…" : relationLabel(player.relation)}</button>
              </article>;
            })}
            {!players.length && !loading && !searchError && searchedQuery === normalizedQuery ? <div className="player-search-empty">Bu aramayla eşleşen gerçek kullanıcı yok.</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
