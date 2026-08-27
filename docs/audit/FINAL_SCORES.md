# mrap kalite denetimi — güncel kanıt

Tarih: 27 Ağustos 2026  
Release kararı: **NO-GO — dış dağıtım kapısı açık**

Bu rapor hedeflenen `9,8/10` değerini sonuç çıkarmak için kullanmaz. Puan ancak çalışan
ürün kanıtıyla verilir; eksik Vercel/Cloudflare, gerçek cihaz, yük ve operasyon kanıtı
varken bütün kategorilere 9,8 yazmak gerçeğe aykırı olur.

## Doğrulanmış son paket

- TypeScript, ESLint ve 303 dosyalık kaynak hijyeni kapıları geçti.
- 100 test dosyasında 695/695 test geçti.
- Coverage: satır `%87,02`, dal `%80,72`, fonksiyon `%90,45`; zorunlu
  satır `%85` ve dal `%80` eşikleri geçti.
- Production build 42 route ile tamamlandı.
- Üç motorlu E2E: 81 geçti, 114 kapsam gereği atlandı, 0 hata.
- Sekiz mobil viewport: 20 geçti, 28 hedef-boyut koşulu nedeniyle atlandı, 0 hata.
- 390×844 tam yaşam döngüsü ve dokuz görsel baseline geçti.
- `npm audit`: 0 bilinen açık; production CycloneDX SBOM üretildi.
- Bağlı Supabase kabul projesinde migration `001`–`015`, uzak lint, runtime
  contract ve iki geçici kullanıcılı claim + sosyal smoke geçti. Hesap temizliği
  Auth, profil ve territory sahipliği seviyesinde doğrulandı.

## 35 kategori kanıt durumu

| # | Kategori | Güncel kanıt durumu |
|---:|---|---|
| 1 | UI/UX ve görsel tasarım | Yerel kapı geçti; görsel baseline var, fiziksel cihaz incelemesi bekliyor |
| 2 | Çoklu cihaz ve responsive | 320×568–480×800 mobil matris ve geniş ekran testleri geçti |
| 3 | Performans ve algılanan hız | Açık; güncel production Lighthouse/RUM ve uzun oturum ölçümü yok |
| 4 | Güvenlik ve veri gizliliği | Güçlü yerel/uzak DB kanıtı var; gerçek proxy/WAF/DAST kabulü bekliyor |
| 5 | Mimari ve kod kalitesi | Provider ayrımı ve authoritative domain doğrulandı |
| 6 | Kod tekrarı ve DRY | Yerel kaynak kapısı geçti; büyük orchestration dosyaları hâlâ risk |
| 7 | Hardcode ve konfigürasyon | Typed env ve merkezi gameplay kuralları var |
| 8 | Durum yönetimi | Açık state machine, recovery ve sosyal yakınsama testli |
| 9 | Ağ, API ve realtime | API/DB sözleşmesi geçti; hosted backpressure/iki-instance kabulü bekliyor |
| 10 | Erişilebilirlik | Axe kritik/serious kapısı ve panel odak akışları geçti; gerçek ekran okuyucu bekliyor |
| 11 | Ölçeklenebilirlik | Supabase adapter/DB hazır; load/soak ve production instance kanıtı yok |
| 12 | Hata yönetimi ve dayanıklılık | Idempotency, replay, rollback ve recovery otomatik testli |
| 13 | Test kapsamı | 695 unit/integration + çok motorlu/mobil E2E geçti; çekirdek `%95` dal hedefi açık |
| 14 | Türkçe ve i18n | Görünür ürün Türkçe; typed locale registry, provider ve fallback var |
| 15 | Çevrimdışı ve kalıcılık | Kişisel taslak/rekabetçi rota ayrımı testli; uzun kesinti saha testi yok |
| 16 | Bildirim ve deep link | Yerel ve uzak sosyal smoke ile doğrulandı |
| 17 | Analitik ve izleme | Açık; production sink/dashboard/alarm yok |
| 18 | CI/CD | Kalite workflow'u ve SBOM var; uzak staging/Lighthouse kapısı eksik |
| 19 | Belgeleme | Mimari, güvenlik, concurrency, recovery ve deployment kayıtları güncel |
| 20 | Sosyal ağ iş mantığı | Takip/gizli hesap/beğeni/kayıt/yorum testli; moderasyon UI'ı açık risk |
| 21 | Bağımlılık yönetimi | Audit temiz ve SBOM üretildi |
| 22 | Pil ve kaynak optimizasyonu | Açık; 30 dakikalık gerçek cihaz ölçümü yok |
| 23 | Tarayıcı/platform uyumu | Chromium, Firefox ve WebKit kritik akışları geçti; fiziksel Safari/Android bekliyor |
| 24 | Production/PWA/deployment | Bloke; Vercel/Cloudflare/domain/Turnstile yetkileri yok |
| 25 | Yatırımcı sunumu olgunluğu | Ürün demosu güçlü; public shared-world/SLO/yük kanıtı yok |
| 26 | Kod okunabilirliği ve basitlik | Strict TS temiz; büyük GameMap/store/CSS modülleri bakım riski |
| 27 | Genel olgunluk | Yerel MVP ve uzak DB kabulü güçlü; production operasyonu tamamlanmadı |
| 28 | Kod mimarisi ve yapı | UI/domain/location/store sınırları ve server-authoritative adapter var |
| 29 | Kod kalitesi | Typecheck/lint/test kapıları geçti |
| 30 | KISS | MVP kapsamı korunuyor; oyun orchestration'ı bölünmeye aday |
| 31 | Hardcode derin denetimi | İş kuralları config/DB contractta; production origin dış panelde bekliyor |
| 32 | DRY derin denetimi | Ortak sosyal, modal, harita ve provider kalıpları kullanılıyor |
| 33 | Kod seviyesi performans | Viewport/region sınırları var; profiler ve production budget açık |
| 34 | Test edilebilirlik | Fake clock/location/grid ve store contractları kullanılıyor |
| 35 | Ölçeklenebilirlik/genişleyebilirlik | Supabase/PostGIS swap tamam; hosted realtime/load kanıtı bekliyor |

## 9,8 eşiği kararı

Yerel kalite paketi temizdir; ancak tüm 35 başlık için minimum `9,8/10` henüz
kanıtlanmış değildir. Özellikle performans, analitik, pil, gerçek cihaz,
load/soak, restore ve public ağ zinciri tamamlanmadan böyle bir puan verilmez.
Production dünya bu nedenle `draft` ve `competitive_claims_enabled=false`
durumunda kalır.
