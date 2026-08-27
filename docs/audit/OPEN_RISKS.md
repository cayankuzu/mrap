# mrap açık riskler

Tarih: 27 Ağustos 2026  
Release durumu: **NO-GO**  
Aktif risk sayısı: **1 P0, 6 P1, 5 P2, 1 P3**.

Bu kayıt yalnız kalan riskleri içerir. Başlangıçta açık olan yorum paneli, yorum pagination/idempotency, sosyal mutation yakınsaması, Unicode kullanıcı adı, medya doğrulama, hesap silme onayı, Supabase Auth e-posta doğrulama akışı, merkezi production environment doğrulaması, SBOM/bağımlılık güncelleme politikası ve temel CI açıkları kod düzeyinde kapatılmıştır. Dış platform kabulü ayrı risk olmaya devam eder.

## P0 — release engeli

### R-F001 — Production dağıtımı ve dış ağ kabulü tamamlanmadı

- Kanıt: bağlı Supabase kabul projesinde `001`–`015` migration push, uzak lint, `schema=15` runtime contractı ve iki geçici kullanıcıyla claim + sosyal ürün smoke testi geçti. Test hesaplarının Auth/profil/territory temizliği doğrulandı. Buna karşılık bu ortamda Vercel team/project, production hostname, Cloudflare zone/token ve Turnstile yetkileri yoktur.
- Etki: uzak veri düzlemi kabul edilmiş olsa da uygulamanın gerçek public origin, proxy zinciri, cache/WAF ve production secret scope davranışı kanıtlanmış değildir. `world-main` bilinçli olarak `draft` ve rekabetçi claim kapalıdır.
- Kapatma koşulu: Vercel project/env/domain bağlantısı; Cloudflare DNS/TLS/WAF/cache/origin kuralları; Turnstile hostname'i; gerçek production host smoke; e-posta/Storage/Realtime kabulü; rollback/restore ve kontrollü world activation onayı.
- Sahip: backend/platform.
- Durum: **Açık — release blocker**.

## P1 — yüksek öncelik

### R-F002 — Performans bütçeleri başarısız

- Kanıt: `docs/PERFORMANCE_BUDGET.md:9-16,27-31`.
- Etki: Landing LCP 3,98 sn; harita LCP 5,05 sn ve TBT 651 ms; düşük sınıf mobil cihazlarda oyun başlangıcı gecikir.
- Kapatma koşulu: güncel production Lighthouse/RUM; landing ≥95, map ≥90, LCP ≤2,5 sn, INP ≤200 ms ve bundle bütçe CI kapısı.
- Durum: Açık.

### R-F003 — Gerçek cihaz ve iki-instance realtime kabulü eksik

- Kanıt: üç motorlu paket `81 passed / 114 koşullu skipped / 0 failed`; ayrı mobil matris `20 passed / 28 koşullu skipped / 0 failed`. Chromium gerçek geolocation allow/deny, dokunmatik fotoğraf kaydırma, etkileşimli mini harita ve takip listesi navigasyonu; 390×844 gerçek SQLite kayıt→loop→claim→post→silme yaşam döngüsü de geçti.
- Eksik: fiziksel iOS/Android cihaz, iki ayrı Vercel instance'ı, hosted reconnect/backpressure, offline session takeover ve uzun süreli hareket testi.
- Kapatma koşulu: gerçek cihaz çiftinde ve iki production-benzeri instance üzerinde convergence/reconnect kanıtı.
- Durum: Açık; yerel browser kapsamı tamamlandı, dış cihaz/altyapı kapsamı bekliyor.

### R-F004 — Çekirdek domain dal kapsamı hedef altında

- Kanıt: son global coverage satır %87,02, dal %80,72, fonksiyon %90,45; tanımlı %85/%80 kapıları geçti. Bazı nadir çekirdek state/rollback dalları yine %95 hedefinin altındadır.
- Etki: nadir state geçişi, kesinti ve claim rollback regresyonları kaçabilir.
- Kapatma koşulu: güvenlik/ownership/realtime çekirdek modüllerinde dal ≥%95 ve mutation/boundary senaryoları.
- Durum: Açık.

### R-F005 — Realtime transport polling yapıyor; hosted yayın/backpressure kabulü yok

- Kanıt: `src/app/api/game/regions/stream/route.ts` periyodik snapshot/event okur; `src/server/game/authoritative-config.ts` varsayılan polling aralığını tanımlar. Supabase store ortak veriyi okuyabilir, ancak private Supabase Realtime/Broadcast taşımasının production kabulü yoktur.
- Etki: açık SSE bağlantıları düzenli sorgu üretir; yük, yeniden bağlanma ve çoklu instance backpressure davranışı kanıtlanmamıştır.
- Kapatma koşulu: kimlik kontrollü hosted realtime transport veya ölçümlü polling bütçesi; replay cursor, backpressure, multi-instance ve iki istemci hash eşitliği testi.
- Durum: Açık.

### R-F006 — Açık rotalar saklanıyor fakat kullanıcıya sunulmuyor

- Kanıt: `src/server/game/schema.ts:184`, `src/server/game/authoritative-store.ts:1220`, `src/app/api/route-sessions/route.ts:6`; profil veya paylaşım UI tüketicisi yok.
- Etki: Claim olmadan biten rota kaydedilse de daha sonra bulunamaz/paylaşılamaz.
- Kapatma koşulu: mevcut profil/paylaşım yapısı içinde özel rota geçmişi ve açık rotanın ownership/skor üretmediğini doğrulayan E2E.
- Durum: Açık.

### R-F010 — UGC güvenlik operasyonu yalnız şema düzeyinde

- Kanıt: `src/server/game/schema.ts:224-262` rapor/moderasyon/engelleme tablolarını tanımlıyor; bunları kullanan repository/API/UI yok.
- Etki: Gönderi ve yorum kötüye kullanımında kullanıcı ve operasyon ekibi için uygulanabilir süreç yok.
- Kapatma koşulu: mevcut sosyal akış içinde en az raporlama/engelleme, oran sınırı, audit ve moderasyon kuyruğu operasyon prosedürü.
- Durum: Açık.

## P2 — orta öncelik

### R-F011 — Runtime analitik sink noop

- Kanıt: `src/lib/analytics.ts:604,771-774`, `src/components/AnalyticsReporter.tsx:10`.
- Etki: tipli event şeması bulunmasına rağmen auth/post/game/realtime funnel ve hata oranları gözlenemiyor.
- Kapatma koşulu: PII'siz production sink, örnek dashboard/alert ve olay contract testleri.

### R-F012 — Kaynak, pil ve uzun oturum ölçümü yok

- Kanıt: `docs/PERFORMANCE_BUDGET.md:42-50`.
- Etki: 30 dakika GPS+MapLibre oturumunda heap, CPU, FPS ve pil davranışı bilinmiyor.
- Kapatma koşulu: sabit cihaz profiliyle heap/CPU/frame/battery benchmark ve leak testi.

### R-F013 — Büyük orchestration dosyaları

- Kanıt: `src/components/GameMap.tsx` yaklaşık 1.700+ satır, `src/server/game/authoritative-store.ts` yaklaşık 1.600+ satır, `src/app/globals.css` yaklaşık 2.000+ satır.
- Etki: değişiklik alanı ve regresyon maliyeti artıyor.
- Kapatma koşulu: davranış değiştirmeden location/session/realtime/map/UI orchestration sınırlarına bölme ve eşdeğer testler.

### R-F014 — Strict CSP ve production ağ zinciri kabulü tamam değil

- Kanıt: `next.config.ts` production `script-src 'unsafe-inline'` kullanır. `src/server/http/rate-limit.ts` Supabase modunda dağıtık RPC kullanır, fakat güvenilir istemci IP anahtarı yalnız doğrulanmış proxy başlık zinciriyle anlamlıdır; Cloudflare/Vercel zinciri henüz dış ortamda kabul edilmedi.
- Etki: CSP savunma derinliği ve gerçek production trafik kimliği hedef standardı karşılamıyor.
- Kapatma koşulu: nonce/hash CSP; doğrulanmış Cloudflare/Vercel origin chain; spoof edilmiş forwarding başlıkları ve dağıtık rate-limit için production testi.

### R-F015 — Performance ve uzak staging CI kapıları yok

- Kanıt: mobil visual regression baseline ve tam yolculuk testleri vardır; `.github/workflows/quality.yml` coverage/audit/build/smoke/multiplayer/E2E çalıştırır. Lighthouse/bundle budget ve uzak staging migration/smoke işi CI'da yoktur.
- Etki: performans veya dış entegrasyon regresyonu PR kapısından geçebilir.
- Kapatma koşulu: Lighthouse/bundle kapısı ve yetkili preview/staging veri kabul işi.

## P3 — teslimat hijyeni

### R-F017 — Eski çalışma adı taşıyan yerel artifaktlar

- Kanıt: repository kökünde eski çalışma adıyla oluşturulmuş geliştirme logları ve `data/` altında eski yerel SQLite artifaktları bulunuyor.
- Etki: ürün runtime'ı değil; teslimat/marka hijyeni.
- Kapatma koşulu: aktif süreç kapandıktan sonra güvenli, doğrulanmış hedeflerle artifaktların temizlenmesi veya git ignore kapsamı.

## Değişmez release kuralları

- Ürünün adı yalnız **mrap**.
- Docker kullanılmayacak.
- Başka oyuncunun kesin GPS'i veya tamamlanmamış rotası yayınlanmayacak.
- Client ownership/score/polygon kararı veremeyecek.
- Ortak production adapter'ın uzak kabulü ve bütün P0'lar kapanmadan release `PASS` olmayacak.
- Kanıtlanmamış hiçbir kategoriye 9,8 verilmeyecek.
