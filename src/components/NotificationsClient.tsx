"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Bell, Check, CheckCheck, Heart, MapPin, ShieldAlert, UserPlus, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { notificationClientReducer, type NotificationClientItem, type NotificationFollowRequest } from "@/lib/notification-client-state";
import { notificationCategory } from "@/lib/notification-presentation";

export function NotificationsClient({ initialNotifications, initialRequests }: { initialNotifications: NotificationClientItem[]; initialRequests: NotificationFollowRequest[] }) {
  const [{ items, requests }, dispatch] = useReducer(notificationClientReducer, { items: initialNotifications, requests: initialRequests });
  const [filter, setFilter] = useState<"all" | "territory" | "social">("all");
  const [actionError, setActionError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const filtered = useMemo(() => filter === "all" ? items : items.filter((item) => notificationCategory(item.type) === filter), [filter, items]);
  useEffect(() => {
    dispatch({ type: "synchronize", items: initialNotifications, requests: initialRequests });
  }, [initialNotifications, initialRequests]);
  async function markAll() {
    if (markingAll) return;
    setMarkingAll(true); setActionError("");
    try {
      const response = await fetch("/api/notifications", { method: "PUT" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Bildirimler güncellenemedi.");
      dispatch({ type: "mark-all-read", readAt: new Date().toISOString() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Bildirimler güncellenemedi.");
    } finally { setMarkingAll(false); }
  }
  async function resolve(requesterId: string, action: "accept" | "reject") {
    if (resolvingId) return;
    setResolvingId(requesterId); setActionError("");
    try {
      const response = await fetch(`/api/follow-requests/${requesterId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Takip isteği güncellenemedi.");
      dispatch({ type: "resolve-request", requesterId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Takip isteği güncellenemedi.");
    } finally { setResolvingId(null); }
  }
  return <>
    {actionError ? <div className="form-error" role="alert">{actionError}</div> : null}
    {requests.length ? <section className="follow-request-card"><header><span><UserPlus size={19} /></span><div><h2>Takip istekleri</h2><p>Gizli hesabını kimlerin görebileceğine sen karar ver.</p></div></header>{requests.map((request) => <article key={request.user.id}><UserAvatar user={request.user} href={`/users/${encodeURIComponent(request.user.username)}`} /><Link href={`/users/${encodeURIComponent(request.user.username)}`} className="follow-request-user"><strong>{request.user.displayName}</strong><small>@{request.user.username}</small></Link><button type="button" className="accept-request" onClick={() => void resolve(request.user.id, "accept")} disabled={Boolean(resolvingId)} aria-busy={resolvingId === request.user.id}><Check size={16} /> {resolvingId === request.user.id ? "İşleniyor…" : "Kabul"}</button><button type="button" className="reject-request" onClick={() => void resolve(request.user.id, "reject")} disabled={Boolean(resolvingId)} aria-label="Takip isteğini reddet"><X size={16} /></button></article>)}</section> : null}
    <div className="notification-page-tools"><div className="notification-tabs"><button className={filter === "all" ? "is-active" : ""} type="button" onClick={() => setFilter("all")}>Tümü</button><button className={filter === "territory" ? "is-active" : ""} type="button" onClick={() => setFilter("territory")}>Alanlar</button><button className={filter === "social" ? "is-active" : ""} type="button" onClick={() => setFilter("social")}>Sosyal</button></div>{items.some((item) => !item.read_at) ? <button type="button" className="text-button" onClick={() => void markAll()} disabled={markingAll} aria-busy={markingAll}><CheckCheck size={16} /> {markingAll ? "İşleniyor…" : "Tümünü okundu işaretle"}</button> : null}</div>
    {filtered.length ? <section className="notification-list">{filtered.map((item) => { const category = notificationCategory(item.type); const Icon = category === "territory" ? MapPin : category === "social" ? Heart : ShieldAlert; const content = <><span className="notification-icon"><Icon size={20} /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("tr-TR")}</small></div></>; return <article key={item.id} className={!item.read_at ? "is-unread" : ""}>{item.href ? <Link className="notification-main" href={item.href}>{content}</Link> : <div className="notification-main">{content}</div>}{!item.read_at ? <i /> : null}</article>; })}</section> : <div className="real-empty-state"><span><Bell size={26} /></span><h3>Bildirim yok</h3><p>Gerçek alan ve sosyal hareketlerin burada görünecek.</p></div>}
  </>;
}
