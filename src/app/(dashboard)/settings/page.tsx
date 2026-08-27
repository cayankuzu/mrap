import type { Metadata } from "next";
import { SettingsClient } from "@/components/SettingsClient";
import { requireCurrentUser } from "@/lib/auth";
export const metadata: Metadata = { title: "Ayarlar" };
export default async function SettingsPage() { const user = await requireCurrentUser(); return <div className="content-page settings-page"><header className="page-header"><div><span className="eyebrow">Hesap merkezi</span><h1>Ayarlar</h1><p>Profil düzenleme ile oyun, gizlilik ve hesap seçenekleri ayrı bölümlerde.</p></div></header><SettingsClient initialUser={user} /></div>; }
