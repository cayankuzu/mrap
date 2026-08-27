"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, RefreshCw, Users, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { CONNECTION_PAGE_LIMITS } from "@/lib/content-limits";
import type { ConnectionPage, SocialConnection } from "@/lib/models";
import { useMrapRefresh } from "@/lib/refresh-events";

type ConnectionType = "followers" | "following";
type LoadedPages = Partial<Record<ConnectionType, ConnectionPage>>;

type SocialConnectionsProps = {
  followers?: SocialConnection[];
  following?: SocialConnection[];
  followersCount?: number;
  followingCount?: number;
  profileHrefPrefix?: string;
  userId?: string;
  accessLocked?: boolean;
};

export function SocialConnections({
  followers = [],
  following = [],
  followersCount,
  followingCount,
  profileHrefPrefix = "/users",
  userId,
  accessLocked = false,
}: SocialConnectionsProps) {
  const [open, setOpen] = useState<ConnectionType | null>(null);
  const [pages, setPages] = useState<LoadedPages>({});
  const [loading, setLoading] = useState<ConnectionType | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const dialogId = useId();
  const titleId = useId();
  const followersTriggerRef = useRef<HTMLButtonElement>(null);
  const followingTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const followerTotal = pages.followers?.total ?? followersCount ?? followers.length;
  const followingTotal = pages.following?.total ?? followingCount ?? following.length;
  const fallbackItems = open === "followers" ? followers : following;
  const currentPage = open ? pages[open] : undefined;
  const items = currentPage?.connections ?? fallbackItems;

  const closeModal = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setLoading(null);
    setLoadError("");
    setOpen(null);
  }, []);

  const loadPage = useCallback(async (type: ConnectionType, cursor: string | null) => {
    if (!userId || accessLocked || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(type);
    setLoadError("");
    setRetryCursor(cursor);
    try {
      const searchParams = new URLSearchParams({ type, limit: String(CONNECTION_PAGE_LIMITS.default) });
      if (cursor) searchParams.set("cursor", cursor);
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/connections?${searchParams}`, { signal: controller.signal });
      const result = await response.json().catch(() => null) as (ConnectionPage & { error?: string }) | null;
      if (!response.ok || !result?.connections) {
        setLoadError(result?.error || "Bağlantı listesi yüklenemedi.");
        return;
      }
      setPages((current) => {
        const previous = cursor ? current[type]?.connections ?? [] : [];
        const knownIds = new Set(previous.map(({ user }) => user.id));
        const nextConnections = [...previous, ...result.connections.filter(({ user }) => !knownIds.has(user.id))];
        return { ...current, [type]: { connections: nextConnections, nextCursor: result.nextCursor, total: result.total } };
      });
      setRetryCursor(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadError("Bağlantı listesi yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(null);
      }
    }
  }, [accessLocked, userId]);

  function openList(type: ConnectionType) {
    setOpen(type);
    setLoadError("");
    setRetryCursor(null);
    if (userId && !accessLocked && !pages[type]) void loadPage(type, null);
  }

  useMrapRefresh("panel", Boolean(open && userId && !accessLocked), () => {
    if (!open) return;
    requestRef.current?.abort();
    requestRef.current = null;
    void loadPage(open, null);
  });

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = open === "followers" ? followersTriggerRef.current : followingTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
      returnFocusRef.current = null;
    };
  }, [closeModal, open]);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  const initialLoading = Boolean(open && loading === open && !currentPage);
  return <>
    <div className="profile-connection-buttons">
      <button ref={followersTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={open === "followers"} aria-controls={open ? dialogId : undefined} onClick={() => openList("followers")}><strong>{followerTotal.toLocaleString("tr-TR")}</strong> Takipçi</button>
      <button ref={followingTriggerRef} type="button" aria-haspopup="dialog" aria-expanded={open === "following"} aria-controls={open ? dialogId : undefined} onClick={() => openList("following")}><strong>{followingTotal.toLocaleString("tr-TR")}</strong> Takip</button>
    </div>
    {open ? <div className="modal-backdrop connection-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <section ref={dialogRef} id={dialogId} className="connection-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header><div><span className="eyebrow">Topluluk</span><h2 id={titleId}>{open === "followers" ? "Takipçiler" : "Takip edilenler"}</h2></div><button ref={closeButtonRef} type="button" className="icon-button" onClick={closeModal} aria-label="Listeyi kapat"><X size={20} /></button></header>
        {accessLocked ? <div className="connection-empty" role="status" aria-live="polite"><LockKeyhole size={25} /><strong>Bağlantılar gizli</strong><span>Takip isteğin kabul edildiğinde bu listeyi görebilirsin.</span></div> : initialLoading ? <div className="connection-empty" role="status" aria-live="polite"><i className="mini-loader" /><strong>Liste yükleniyor…</strong><span>Bağlantılar güvenli şekilde getiriliyor.</span></div> : items.length ? <div className="connection-list" aria-busy={loading === open}>
          {items.map(({ user }) => <Link href={`${profileHrefPrefix}/${encodeURIComponent(user.username)}`} key={user.id} onClick={closeModal}><UserAvatar user={user} /><span><strong>{user.displayName}</strong><small>@{user.username} · {user.city}</small></span></Link>)}
          {loadError ? <div className="connection-load-state is-error" role="alert"><span>{loadError}</span><button type="button" onClick={() => void loadPage(open, retryCursor)}><RefreshCw size={14} /> Yeniden dene</button></div> : currentPage?.nextCursor ? <button type="button" className="connection-load-more" disabled={loading === open} onClick={() => void loadPage(open, currentPage.nextCursor)}>{loading === open ? "Yükleniyor…" : "Daha fazla göster"}</button> : null}
        </div> : <div className="connection-empty" role={loadError ? "alert" : "status"} aria-live="polite"><Users size={25} /><strong>{loadError || "Liste henüz boş"}</strong><span>{loadError ? "Lütfen biraz sonra yeniden dene." : "Yeni bağlantılar burada görünecek."}</span>{loadError ? <button type="button" className="connection-load-more" onClick={() => void loadPage(open, retryCursor)}><RefreshCw size={14} /> Yeniden dene</button> : null}</div>}
      </section>
    </div> : null}
  </>;
}
