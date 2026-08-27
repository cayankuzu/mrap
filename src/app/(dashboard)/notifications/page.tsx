import type { Metadata } from "next";
import { NotificationsClient } from "@/components/NotificationsClient";
import { requireCurrentUser } from "@/lib/auth";
import { listFollowRequests, listNotifications } from "@/lib/repository";
export const metadata: Metadata = { title: "Bildirimler" };
export default async function NotificationsPage() {
  const user = await requireCurrentUser();
  const [notifications, requests] = await Promise.all([
    listNotifications(user.id),
    listFollowRequests(user.id),
  ]);
  return <div className="content-page notifications-page"><header className="page-header"><div><span className="eyebrow">Gerçek hareketler</span><h1>Bildirimler</h1></div></header><NotificationsClient initialNotifications={notifications} initialRequests={requests} /></div>;
}
