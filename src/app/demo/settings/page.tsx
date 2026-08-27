import type { Metadata } from "next";
import { DemoSettingsClient } from "@/components/DemoSettingsClient";

export const metadata: Metadata = { title: "Demo profil ayarları" };

export default function DemoSettingsPage() {
  return <div className="content-page settings-page">
    <header className="page-header"><div><span className="eyebrow">Demo hesap merkezi</span><h1>Ayarlar</h1><p>Profil düzenleme ile oyun ve gizlilik tercihlerini ayrı bölümlerde dene.</p></div></header>
    <DemoSettingsClient />
  </div>;
}
