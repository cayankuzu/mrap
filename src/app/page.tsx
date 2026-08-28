import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Footprints,
  Globe2,
  MapPin,
  Play,
  Route,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { MapArtwork } from "@/components/MapArtwork";
import type { Territory } from "@/lib/data";

const heroTerritory: Territory = {
  id: "hero",
  name: "Caddebostan Büyük Tur",
  district: "Kadıköy, İstanbul",
  area: "1,24 km²",
  distance: "6,8 km",
  duration: "54 dk",
  color: "#bdf565",
  variant: 1,
};

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <Logo />
        <nav aria-label="Tanıtım sayfası gezintisi">
          <a href="#how">Nasıl çalışır?</a>
          <a href="#community">Topluluk</a>
          <a href="#safety">Güvenlik</a>
        </nav>
        <div className="landing-nav-actions">
          <Link href="/login" className="nav-login">Giriş yap</Link>
          <Link href="/register" className="nav-cta">Aramıza katıl <ArrowRight size={16} /></Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="hero-pill"><span /> Şehrin yeni oyunu şimdi başlıyor</span>
            <h1>Adımlarınla<br /><em>şehri sar.</em></h1>
            <p>Yürü, rotanı kapat ve şehrin gerçek haritasında kendi alanını oluştur. Arkadaşlarınla yarış, hikâyeni ölümsüzleştir.</p>
            <div className="hero-actions">
              <Link href="/register" className="hero-primary">Ücretsiz başla <ArrowRight size={19} /></Link>
              <Link href="/demo/home" className="hero-secondary"><Play size={18} fill="currentColor" /> Etkileşimli demoyu gör</Link>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-map-orbit hero-map-orbit--one" />
            <div className="hero-map-orbit hero-map-orbit--two" />
            <div className="hero-phone">
              <div className="phone-bar"><Logo compact /><span>Kadıköy</span><i /></div>
              <div className="phone-map"><MapArtwork territory={heroTerritory} live /><span className="live-chip"><i /> Kayıt açık</span></div>
              <div className="phone-session">
                <span><small>MESAFE</small><strong>4,82 km</strong></span>
                <span><small>SÜRE</small><strong>38:21</strong></span>
                <span><small>ALAN</small><strong>0,86 km²</strong></span>
              </div>
              <Link href="/demo/play"><Route size={18} /> Rotayı başlat</Link>
            </div>
            <div className="floating-stat floating-stat--top"><span><Trophy size={18} /></span><div><small>Şehir sıran</small><strong>#24 <em>↑ 6</em></strong></div></div>
            <div className="floating-stat floating-stat--bottom"><span><Sparkles size={18} /></span><div><small>Yeni alan</small><strong>+0,86 km²</strong></div></div>
          </div>
        </section>

        <section className="how-section" id="how">
          <div className="section-heading">
            <span className="eyebrow">Nasıl çalışır?</span>
            <h2>Üç adımda şehre<br />kendi imzanı bırak.</h2>
            <p>Günlük yürüyüşün artık sadece bir rota değil; sana ait yaşayan bir hikâye.</p>
          </div>
          <div className="steps-grid">
            <article><span className="step-number">01</span><div className="step-icon"><Footprints /></div><h3>Harekete geç</h3><p>Konumunu aç, güvenli rotanı seç ve yürümeye başla.</p></article>
            <article className="featured-step"><span className="step-number">02</span><div className="step-icon"><Route /></div><h3>Kapatma fırsatını yakala</h3><p>Aktif rotana veya kendi alan sınırına yeniden temas et; kapatmaya sen karar ver.</p></article>
            <article><span className="step-number">03</span><div className="step-icon"><Camera /></div><h3>Ölümsüzleştir</h3><p>Alanını seç, harita kadrajını hazırla ve hikâyeni toplulukla paylaş.</p></article>
          </div>
        </section>

        <section className="community-section" id="community">
          <div className="community-preview">
            <div className="community-card community-card--back"><MapArtwork territory={{ ...heroTerritory, color: "#8f7cff", variant: 2 }} /></div>
            <div className="community-card community-card--front">
              <header><span className="avatar avatar--md" style={{ "--avatar-color": "#ff8066" } as React.CSSProperties}>DK</span><div><strong>Defne Kaya</strong><small>@defnek · 12 dk</small></div></header>
              <p>Sabahın en iyi rotası. Sahil artık biraz daha mercan. 🌊</p>
              <div className="map-snapshot map-snapshot--compact">
                <div className="snapshot-map" style={{ "--territory-color": "#ff8066" } as React.CSSProperties}>
                  <MapArtwork territory={{ ...heroTerritory, color: "#ff8066" }} />
                  <span className="snapshot-badge"><MapPin size={12} /> {heroTerritory.district}</span>
                  <span className="snapshot-area-label">{heroTerritory.area}</span>
                </div>
                <div className="snapshot-meta">
                  <div><span className="snapshot-kicker"><Route size={14} /> ALAN KAYDI</span><strong>{heroTerritory.name}</strong></div>
                  <div className="snapshot-stats"><span><small>Mesafe</small>{heroTerritory.distance}</span><span><small>Süre</small>{heroTerritory.duration}</span><span><small>Alan</small>{heroTerritory.area}</span></div>
                </div>
              </div>
              <footer><span>♥ 284</span><span>◯ 18</span><span>↗ Paylaş</span></footer>
            </div>
          </div>
          <div className="community-copy">
            <span className="eyebrow">Topluluğunu keşfet</span>
            <h2>Her alanın<br />anlatacak bir hikâyesi var.</h2>
            <p>Takip ettiklerinin rotalarını ana sayfanda gör. Yeni kaşifleri keşfet, alanlarından ilham al ve kendi hikâyeni paylaş.</p>
            <ul>
              <li><Check size={17} /> Takip akışı ve keşfet topluluğu</li>
              <li><Check size={17} /> Otomatik harita görüntüsü</li>
              <li><Check size={17} /> Başlık, açıklama ve 6 fotoğrafa kadar paylaşım</li>
            </ul>
            <Link href="/register">Topluluğa katıl <ChevronRight size={18} /></Link>
          </div>
        </section>

        <section className="safety-section" id="safety">
          <div className="safety-copy">
            <span className="eyebrow">Gizlilik sende</span>
            <h2>Alanını göster.<br />Konumunu değil.</h2>
            <p>mrap, oyun heyecanını güvenli bir deneyimle buluşturur. Tam konumun başka oyuncularla paylaşılmaz.</p>
            <div className="safety-features">
              <span><ShieldCheck size={20} /><div><strong>Oturum bazlı konum</strong><small>Yalnızca sen başlattığında</small></div></span>
              <span><Globe2 size={20} /><div><strong>Güvenli paylaşım</strong><small>Canlı noktanı akışta göstermez</small></div></span>
              <span><Users size={20} /><div><strong>Kontrol sende</strong><small>Kimlerin göreceğini seçersin</small></div></span>
            </div>
          </div>
          <div className="safety-map"><MapArtwork territory={{ ...heroTerritory, color: "#15221b", variant: 4 }} /><span className="privacy-bubble"><ShieldCheck size={17} /> Tam konum gizli</span><span className="safety-pin"><MapPin size={18} fill="currentColor" /></span></div>
        </section>

        <section className="landing-final-cta">
          <span className="eyebrow">İlk alanın seni bekliyor</span>
          <h2>Şehir büyük.<br />Nereden başlayacaksın?</h2>
          <p>mrap’e katıl, ilk rotanı bugün kapat.</p>
          <Link href="/register">Ücretsiz hesabını oluştur <ArrowRight size={19} /></Link>
          <div className="cta-rings" aria-hidden="true"><i /><i /><i /></div>
        </section>
      </main>

      <footer className="landing-footer">
        <Logo />
        <p>Gerçek dünya. Gerçek adımlar. Sana ait alanlar.</p>
        <div><Link href="/privacy">Gizlilik</Link><Link href="/terms">Koşullar</Link><Link href="/help">Yardım</Link></div>
        <small>© 2026 mrap · MeMoDe tarafından</small>
        <small>Konum kataloğu: <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noreferrer">Countries States Cities Database (ODbL)</a></small>
      </footer>
    </div>
  );
}
