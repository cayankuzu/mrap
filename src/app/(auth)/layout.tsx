import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Images, Route, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { MapArtwork } from "@/components/MapArtwork";
import { TerritoryOwnerPath } from "@/components/TerritoryOwnerPath";

const AUTH_TERRITORY = { id: "auth-map", name: "Moda Döngüsü", district: "Kadıköy, İstanbul", area: "0,84 km²", distance: "4,7 km", duration: "42 dk", color: "#12CDB0", variant: 3 as const };

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="auth-visual">
        <Logo />
        <div className="auth-visual-intro"><span className="eyebrow">Gerçek dünya harita oyunu</span><h2>Rotanı kapat.<br />Şehirde iz bırak.</h2><p>Başlangıç noktasına dönmeden döngüler oluştur, benzersiz alanını büyüt ve hikâyeni paylaş.</p></div>
        <div className="auth-map">
          <div className="auth-map-topline"><span>Kadıköy</span><small>Kayıt yalnızca sende görünür</small></div>
          <div className="auth-map-canvas"><MapArtwork territory={AUTH_TERRITORY} live /><TerritoryOwnerPath username="defnek" variant={AUTH_TERRITORY.variant} /><div className="auth-route-badge"><span>+0,84 km²</span><small>benzersiz alan</small></div></div>
          <div className="auth-map-metrics"><span><small>Mesafe</small><strong>4,7 km</strong></span><span><small>Süre</small><strong>42 dk</strong></span><span><small>Alan</small><strong>0,84 km²</strong></span></div>
        </div>
        <div className="auth-proof-grid"><span><Route size={17} /><small>Özgür döngüler</small></span><span><ShieldCheck size={17} /><small>Gizli canlı konum</small></span><span><Images size={17} /><small>Harita + 6 fotoğraf</small></span></div>
      </aside>
      <section className="auth-content">
        <Link href="/" className="auth-back-link" aria-label="Ana sayfaya dön"><ArrowLeft size={18} /><span>Geri</span></Link>
        <div className="auth-mobile-logo"><Logo /></div>{children}<small className="auth-legal">Güvenli adımlar, sana ait alanlar.</small>
      </section>
    </main>
  );
}
