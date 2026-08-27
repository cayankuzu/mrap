# mrap 35 kategori kanıt matrisi

Tarih: 27 Ağustos 2026  
Kural: `PASS` yalnız final puanı ≥9,8 ve ilgili otomatik, manuel ve ölçülebilir kapıların tamamı geçtiğinde verilir. Bu nedenle çalışan yerel özellikler bulunmasına rağmen aşağıdaki bütün kategoriler kanıt eşiğine göre `FAIL` durumundadır.

## 1. UI/UX ve görsel tasarım

**Kategori:** UI/UX & Görsel Tasarım  
**Başlangıç puanı:** 8,2  
**Final puanı:** 9,2  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`src/components/PostCard.tsx`] Başlangıçta yorumlar gönderi altında açılıyordu.
- [`src/app/globals.css`] Harita panelleri ve iki sütun akışta taşma/ölü alan sorunları vardı.
- Görsel regression baseline/golden set yok.

**Uygulanan çözümler:**
- [`src/components/PostCommentsDialog.tsx:84`] Yorumlar ayrı erişilebilir panel oldu.
- [`src/components/MediaLightbox.tsx:7`] Harita, fotoğraf ve beğeni için ortak odak yönetimli panel kullanıldı.
- [`src/app/globals.css:1504`] Adaptif masonry akışı ve responsive kart davranışı eklendi.

**Neden bu çözüm seçildi:**
- Mevcut light-theme kimliğini koruyup tekrar eden modal davranışını tek primitive'de toplar.

**Otomatik kanıt:**
- `tests/e2e/smoke.spec.ts`, `responsive.spec.ts`, `accessibility.spec.ts`.
- Final E2E paketi: yeniden çalıştırılıyor.

**Manuel kanıt:**
- `artifacts/audit/post-detail-320.png`, `post-detail-1920.png` incelendi.
- Bütün ekranlar için güncel visual regression karşılaştırması yok.

**Ölçüm:**
- Önce: inline yorum ve görünür taşma raporları.
- Sonra: hedef screenshotlarda post-detail yatay taşma yok; tam golden-diff ölçümü yok.
- Hedef: bütün kritik ekranlarda 0 overlap ve visual regression PASS.

**Açık risk:** R-F015.

## 2. Çoklu cihaz ve responsive uyum

**Kategori:** Çoklu Cihaz & Responsive Uyum  
**Başlangıç puanı:** 8,5  
**Final puanı:** 9,3  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Küçük telefon, kısa yükseklik, landscape ve %200 ölçek kanıtı eksikti.
- Gerçek iOS Safari/Android Chrome ve sanal klavye testi yoktu.

**Uygulanan çözümler:**
- [`tests/e2e/responsive.spec.ts:7-21`] 320, 360, 375, 390, 412, 480, 768, 820, 1024, 1280, 1440, 1920 ve landscape/kısa ekran matrisi.
- [`src/app/globals.css:1166-1306`] Mobil shell, safe-area, panel ve tablo kırılımları.

**Neden bu çözüm seçildi:**
- Sabit cihaz adına değil gerçek viewport ve overflow invariantına göre regresyon yakalar.

**Otomatik kanıt:**
- `expectNoHorizontalOverflow`; 320×480 yorum paneli; %200 root font testi.
- Ağır responsive matris Chromium ile sınırlı; final koşu yeniden çalıştırılıyor.

**Manuel kanıt:**
- Kaydedilmiş 320 ve 1920 post-detail çıktıları.
- Gerçek cihaz, split-screen ve sanal klavye kanıtı eksik.

**Ölçüm:**
- Hedef viewport sayısı: 12+; otomatik tanımlı: 14.
- İstenmeyen yatay scroll hedefi: 0.

**Açık risk:** R-F003.

## 3. Performans ve algılanan hız

**Kategori:** Performans & Algılanan Hız  
**Başlangıç puanı:** 7,2  
**Final puanı:** 6,5  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`docs/PERFORMANCE_BUDGET.md:9-16`] Landing ve map Lighthouse/CWV hedef dışı.
- Feed kartı başına görünür MapLibre instance maliyeti bulunuyor.

**Uygulanan çözümler:**
- [`src/components/TerritoryInteractiveMap.tsx:151-166`] IntersectionObserver ile viewport dışı mini haritaları unmount/preload sınırı.
- MapLibre worker asset'i ayrı ve map route dinamik yükleniyor.

**Neden bu çözüm seçildi:**
- Ürün davranışını değiştirmeden görünür olmayan WebGL yükünü azaltır.

**Otomatik kanıt:**
- Build manifest/gzip ve baseline Lighthouse JSON mevcut.
- Lighthouse veya bundle bütçesi CI'da zorlanmıyor.

**Manuel kanıt:**
- Harita route'u Chromium'da açıldı; profiler/frame trace yok.

**Ölçüm:**
- Landing Performance 82, LCP 3,98 sn, TBT 279 ms.
- Map Performance 65, LCP 5,05 sn, TBT 651 ms.
- Hedef: ≥95/≥90, LCP ≤2,5 sn, TBT ≤200 ms.

**Açık risk:** R-F002, R-F012, R-F015.

## 4. Güvenlik ve veri gizliliği

**Kategori:** Güvenlik & Veri Gizliliği  
**Başlangıç puanı:** 9,1  
**Final puanı:** 8,8  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Production e-posta doğrulama, adapter/RLS kabulü ve UGC operasyonu eksik.
- [`next.config.ts:12`] CSP `script-src 'unsafe-inline'` içeriyor.

**Uygulanan çözümler:**
- [`src/proxy.ts:18-29`] Origin/Sec-Fetch CSRF kontrolü.
- [`src/server/http/media-validation.ts`] MIME/signature/dimension/decode ve metadata redaksiyonu.
- [`src/server/game/authoritative-store.ts`] Nonce/lease/idempotency/anti-cheat/transactional score.
- [`src/lib/account-deletion-store.ts`] Transactional kalıcı hesap silme.

**Neden bu çözüm seçildi:**
- Ownership, score, GPS ve medya kararlarını güvenilmeyen clienttan ayırır.

**Otomatik kanıt:**
- `npm audit --omit=dev`: 0 açık.
- API hardening, request boundary, media, auth, account deletion ve authoritative security testleri.

**Manuel kanıt:**
- Auth ve hesap silme browser akışı yazılı; final 3-engine sonuç yeniden çalıştırılıyor.

**Ölçüm:**
- Bilinen production dependency açığı: 0.
- Kaynak secret/bitmemiş iş taraması: baseline artifact'te 0; final kaynak taraması yeniden alınmalı.

**Açık risk:** R-F001, R-F007, R-F010, R-F014.

## 5. Mimari ve kod kalitesi

**Kategori:** Mimari & Kod Kalitesi  
**Başlangıç puanı:** 8,8  
**Final puanı:** 8,6  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`src/server/game/authoritative-store.ts:248`] Persistence doğrudan `DatabaseSync`.
- `GameMap` ve authoritative store sorumlulukları çok büyük.

**Uygulanan çözümler:**
- LocationProvider, RouteTracker, LoopDetector, TerritoryEngine, region reconciler ve game state machine ayrımları.
- Server authoritative API akışı UI geometri kararından ayrıldı.

**Neden bu çözüm seçildi:**
- Domain invariantlarını test edilebilir pure/adapter sınırlara taşır; rewrite yapmaz.

**Otomatik kanıt:**
- Madge: 0 circular dependency.
- Domain, geometry, state machine ve store testleri.

**Manuel kanıt:**
- Mimari akış `docs/ARCHITECTURE.md` ile kaynak karşılaştırıldı.

**Ölçüm:**
- Büyük üretim dosyası: en az 3.
- Provider swap integration testi: 0.

**Açık risk:** R-F001, R-F013.

## 6. Kod tekrarı ve DRY

**Kategori:** Kod Tekrarı & DRY  
**Başlangıç puanı:** 8,5  
**Final puanı:** 9,2  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- API request/response validation ve sosyal kart state kalıpları tekrarlıydı.

**Uygulanan çözümler:**
- `MediaLightbox`, cursor helper'ları, desired-state request, post mutation provider ve bounded JSON yardımcıları ortaklaştırıldı.

**Neden bu çözüm seçildi:**
- Yalnız gerçek tekrarları birleştirir; aşırı generic framework oluşturmaz.

**Otomatik kanıt:**
- `artifacts/audit/static-final/jscpd-production/jscpd-report.json`: üretimde yaklaşık %1,54 tekrar.

**Manuel kanıt:**
- Duplicate kümeleri incelendi; çoğu küçük API doğrulama kalıbı.

**Ölçüm:**
- Önce yaklaşık %1,56; kaydedilmiş final statik ölçüm %1,54.
- Hedef yüksek riskli domain tekrarında 0.

**Açık risk:** küçük API kalıpları; release blocker değil.

## 7. Hardcode ve konfigürasyon

**Kategori:** Hardcode & Konfigürasyon  
**Başlangıç puanı:** 8,7  
**Final puanı:** 8,2  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`docs/ENVIRONMENT.md:114`] Merkezi typed production validation eksik.
- Oyun client preview eşikleri ve server authoritative eşikleri ayrı env kümelerinde.

**Uygulanan çözümler:**
- [`src/server/game/authoritative-config.ts`] Session/GPS/geometry/realtime/limit değerleri bounded config'e taşındı.
- [`src/lib/app-config.ts`] 36 izinli renk, ülke/şehir ve ürün adı tek merkezde.

**Neden bu çözüm seçildi:**
- Güvenlik sınırlarını UI sabitlerinden ayırıp güvenli fallback sağlar.

**Otomatik kanıt:**
- Authoritative config boundary testleri ve palette allowlist testleri.

**Manuel kanıt:**
- `.env.example` ile source env referansları karşılaştırıldı.

**Ölçüm:**
- Statik raporda 42 env referansı; baseline statik kayıtta 19'u belgelenmemişti.

**Açık risk:** R-F008.

## 8. Durum yönetimi

**Kategori:** Durum Yönetimi  
**Başlangıç puanı:** 9,0  
**Final puanı:** 9,1  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Aynı post/yazarın farklı kart kopyalarında like/save/follow/comment state'i ayrışabiliyordu.
- Oyun UI state'i büyük `GameMap` bileşeninde yoğun.

**Uygulanan çözümler:**
- [`src/lib/post-mutation-state.ts`] Post ve user bazlı shared mutation projection.
- [`src/lib/game/authoritative-state-machine.ts`] Açık authoritative state ve geçiş tablosu.

**Neden bu çözüm seçildi:**
- Domain kararı ile React projection'ını ayırır ve aynı entity'nin tek durumunu korur.

**Otomatik kanıt:**
- Post mutation state 14 hedef testi; state machine testleri.

**Manuel kanıt:**
- Keşfette takip sonrası kart kaldırma ve kaydedilenlerden çıkarma davranışı kaynak/test üzerinden doğrulandı.

**Ölçüm:**
- Shared state hedef testleri: 14/14 kayıtlı geçiş.

**Açık risk:** R-F013.

## 9. Ağ katmanı, API ve realtime

**Kategori:** Ağ Katmanı, API & Realtime  
**Başlangıç puanı:** 9,2  
**Final puanı:** 8,0  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Per-client 750 ms SQLite polling; hosted/multi-instance transport yok.
- Kritik two-browser realtime/reconnect E2E eksik.

**Uygulanan çözümler:**
- Sürümlü region snapshot/patch, cursor, duplicate/out-of-order/gap reconcile ve `requiresRefetch`.
- Bounded API payload, nonce, correlation id ve idempotency.

**Neden bu çözüm seçildi:**
- Local MVP'de deterministik davranış sağlarken gelecekte transport değişimine domain contract bırakır.

**Otomatik kanıt:**
- 55 senaryoluk matrisin büyük bölümü store/reconciler testlerinde; `simulate:multiplayer` eşzamanlı claim testi CI'a bağlı.

**Manuel kanıt:**
- Gerçek iki browser/multi-instance yayın kanıtı yok.

**Ölçüm:**
- Poll interval: 750 ms.
- Realtime p95 ve backpressure: ölçülmedi.

**Açık risk:** R-F001, R-F003, R-F005.

## 10. Erişilebilirlik

**Kategori:** Erişilebilirlik  
**Başlangıç puanı:** 9,2  
**Final puanı:** 9,2  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Başlangıç yorum panelinde focus trap/Escape/restore yoktu.
- Tam klavye, ekran okuyucu ve çoklu browser matrisi eksik.

**Uygulanan çözümler:**
- [`src/components/MediaLightbox.tsx:22-63`] Odak, Escape, Tab döngüsü ve focus restore.
- Semantic buttons, `aria-modal`, live status/error ve görünür focus stilleri.

**Neden bu çözüm seçildi:**
- Modal davranışını tek, test edilebilir primitive'de tutar.

**Otomatik kanıt:**
- `tests/e2e/accessibility.spec.ts`: WCAG 2.2 A/AA, kritik/serious Axe kapısı.
- Axe matrisi Chromium ile sınırlı; final koşu yeniden çalıştırılıyor.

**Manuel kanıt:**
- Yorum paneli Escape ve focus-return smoke testi var; gerçek ekran okuyucu oturumu yok.

**Ölçüm:**
- Baseline Lighthouse accessibility: 100.
- Hedef Axe critical/serious: 0.

**Açık risk:** R-F003, R-F015.

## 11. Ölçeklenebilirlik ve altyapı

**Kategori:** Ölçeklenebilirlik & Altyapı  
**Başlangıç puanı:** 6,8  
**Final puanı:** 4,5  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`src/lib/database.ts:9-19`] Vercel SQLite'ı ve bağlanmamış provider'ı fail-closed reddediyor.
- [`src/server/game/authoritative-store.ts:248`] Node SQLite concrete dependency.

**Uygulanan çözümler:**
- Supabase/PostGIS migration ve hedef Cloudflare→Vercel→Supabase mimarisi belgelendi.
- Sessiz, veri ayrıştıran SQLite fallback'i engellendi.

**Neden bu çözüm seçildi:**
- Sahte production readiness yerine güvenli NO-GO verir.

**Otomatik kanıt:**
- Vercel+SQLite ve unsupported provider fail-fast kaynak kontrolü.
- Gerçek provider integration testi yok.

**Manuel kanıt:**
- Preview/staging deployment yapılmadı.

**Ölçüm:**
- Çalışan production data adapter: 0.
- Multi-instance load testi: 0.

**Açık risk:** R-F001, R-F005.

## 12. Hata yönetimi ve dayanıklılık

**Kategori:** Hata Yönetimi & Dayanıklılık  
**Başlangıç puanı:** 8,5  
**Final puanı:** 9,0  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Ağ cevabı belirsizliği, duplicate mutation ve yarım session recovery dalları eksikti.

**Uygulanan çözümler:**
- App/global error boundary, correlation id, limited JSON errors, desired-state mutation, idempotency key, session takeover ve retry.
- Offline GPS kişisel draft ile online ACK-belirsiz queue ayrıldı.

**Neden bu çözüm seçildi:**
- Retry'ın çift etki üretmesini engeller ve terminal/geçici hatayı ayırır.

**Otomatik kanıt:**
- API branch, idempotency, offline draft/queue, recovery ve account rollback testleri.

**Manuel kanıt:**
- Tam network shaping/uzun kesinti browser matrisi yok.

**Ölçüm:**
- Duplicate claim/point/finish senaryolarında beklenen no-op kayıtlı.
- Recovery p95: ölçülmedi.

**Açık risk:** R-F003, R-F004.

## 13. Test kapsamaması ve kalitesi

**Kategori:** Test Kapsaması  
**Başlangıç puanı:** 7,8  
**Final puanı:** 8,0  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Kritik browser E2E eksik; çekirdek domain dal oranları %95 altında.

**Uygulanan çözümler:**
- Auth, sosyal, medya, geometry, concurrency, realtime, offline ve boundary testleri genişletildi.
- CI global %85 satır/%80 dal eşiğini zorluyor.

**Neden bu çözüm seçildi:**
- Yüksek riskli state/geometry sınırlarını UI'dan bağımsız hızlı test eder.

**Otomatik kanıt:**
- `artifacts/audit/coverage-final/coverage-summary.json`: satır %86,36; dal %81,72; fonksiyon %88,70.
- Final kaynak ağacı için coverage yeniden çalıştırılmalı; E2E yeniden çalıştırılıyor.

**Manuel kanıt:**
- Test raporları ve ekran görüntüleri incelendi; gerçek cihaz testi yok.

**Ölçüm:**
- Baseline satır %82,01/dal %69,90.
- Kaydedilmiş final satır %86,36/dal %81,72.
- Hedef kritik domain dal ≥%95.

**Açık risk:** R-F003, R-F004.

## 14. Türkçe dil ve yerelleştirme altyapısı

**Kategori:** Türkçe Dil & Yerelleştirme Altyapısı  
**Başlangıç puanı:** 8,8  
**Final puanı:** 6,0  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- 73 TSX dosyasından yalnız 3'ü merkezi sözlüğe bağlı.
- `GameMap.tsx:1101-1103,1663-1674` içinde `online`, `ACK`, `Ownership`; terms/privacy metninde `production/development`.

**Uygulanan çözümler:**
- `src/i18n/tr.ts`, dictionary type ve shell/navigation anahtarları.
- Unicode/Türkçe username normalization ve `tr-TR` sayı formatları.

**Neden bu çözüm seçildi:**
- Yeni dil eklemek için başlangıç contract'ı oluşturur; ancak tüm UI henüz taşınmamıştır.

**Otomatik kanıt:**
- Unicode validation testleri.
- Önceki statik dil artifact'i yeni GameMap metinlerinden önce üretildiği için final kanıt sayılamaz.

**Manuel kanıt:**
- Kaynak görünür metin taraması İngilizce teknik terimleri buldu.

**Ölçüm:**
- Sözlüğe bağlı TSX: 3/73.
- Hedef: bütün kullanıcı metinleri katalogda ve final aday sayısı 0.

**Açık risk:** R-F009.

## 15. Çevrimdışı mod ve kalıcılık

**Kategori:** Çevrimdışı Mod & Kalıcılık  
**Başlangıç puanı:** 8,0  
**Final puanı:** 8,5  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Offline GPS noktalarının competitive queue'ya replay edilmesi güvenlik/semantik riskiydi.
- Tam offline→reconnect browser acceptance yok.

**Uygulanan çözümler:**
- [`src/lib/game/offline-route-draft.ts`] 5 dk/512 nokta/256 KB kişisel draft.
- [`src/lib/game/offline-route-policy.ts`] Offline/online disposition.
- [`src/lib/game/route-point-queue.ts`] Yalnız online gözlenmiş ACK-belirsiz nokta kuyruğu.
- Reconnect yeni server/local segment sınırı açıyor; logout draft ve queue'yu temizliyor.

**Neden bu çözüm seçildi:**
- Çevrimdışı yürüyüşü kullanıcıya kişisel taslak olarak korurken sunucu doğrulaması olmayan GPS'i territory hesabından çıkarır.

**Otomatik kanıt:**
- `offline-route-draft.test.ts`, `offline-route-policy.test.ts`, `route-point-queue.test.ts`, `private-client-state.test.ts`.
- Offline agent final gate sonucu henüz teslim edilmedi.

**Manuel kanıt:**
- Browser offline/reconnect/TTL/claim akışı yeniden çalıştırılmalı.

**Ölçüm:**
- Draft limit: 512 nokta, 5 dk, 256 KB.
- Offline noktaların authoritative `/points` çağrısına girdiğini gösteren final network trace: henüz yok.

**Açık risk:** R-F003, R-F004.

## 16. Bildirimler ve deep link

**Kategori:** Bildirimler & Deep Link  
**Başlangıç puanı:** 8,5  
**Final puanı:** 9,1  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Bildirim metninden güvenilir hedef çıkarma ve doğrudan post privacy kontrolü eksikti.

**Uygulanan çözümler:**
- `notification-identity-store.ts` ve `notification-presentation.ts` ile kimlikli kaynak/hedef.
- Doğrudan post endpoint'inde owner/public/follower erişim kontrolü.

**Neden bu çözüm seçildi:**
- Kullanıcı metnini router komutu olarak yorumlamaz; yetkisiz deep-link sızıntısını önler.

**Otomatik kanıt:**
- Notification identity/presentation/store ve post resource testleri.

**Manuel kanıt:**
- Üst bar bildirim bağlantısı responsive kaynakta sabit; tam bildirim izin/deep-link browser matrisi yok.

**Ölçüm:**
- Bildirim route'unda no-store/auth kontrolü var.
- Push delivery p95: N/A; Web Push mevcut MVP kapsamı değil.

**Açık risk:** tam browser deep-link matrisi.

## 17. Analitik ve izleme

**Kategori:** Analitik & İzleme  
**Başlangıç puanı:** 6,5  
**Final puanı:** 5,0  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- [`src/lib/analytics.ts:604,771-774`] Varsayılan runtime sink noop.
- Auth, sosyal, claim ve realtime akışları event emit etmiyor.

**Uygulanan çözümler:**
- Exact-key tipli event şeması, PII/location redaksiyonu ve Web Vitals adapter'ı.

**Neden bu çözüm seçildi:**
- Ham GPS veya kullanıcı metni taşımayan güvenli contract oluşturur.

**Otomatik kanıt:**
- `src/lib/analytics.test.ts`: şema ve redaksiyon testleri.

**Manuel kanıt:**
- Production dashboard/alert/sink yok.

**Ölçüm:**
- Runtime ürün event çağrı noktası: 0; Web Vitals reporter: 1.
- API/claim/realtime p95: ölçülmedi.

**Açık risk:** R-F011.

## 18. CI/CD ve geliştirme akışı

**Kategori:** CI/CD & Geliştirme Akışı  
**Başlangıç puanı:** 7,0  
**Final puanı:** 8,7  
**Durum:** FAIL

**Tespit edilen sorunlar:**
- Baseline workflow coverage/browser/security/product acceptance zorlamıyordu.
- Performance, visual ve staging migration hâlâ gate değil.

**Uygulanan çözümler:**
- [`.github/workflows/quality.yml`] Locked install, hygiene, typecheck, lint, coverage, audit, build, product smoke, multiplayer ve Chromium/Firefox/WebKit E2E.

**Neden bu çözüm seçildi:**
- Tek reproducible PR kapısında yerel authoritative MVP'nin ana sözleşmelerini kontrol eder.

**Otomatik kanıt:**
- Workflow kaynak adımları mevcut; final yerel E2E koşusu yeniden çalıştırılıyor.

**Manuel kanıt:**
- GitHub Actions hosted run URL'si/green commit kanıtı yok.

**Ölçüm:**
- Zorlanan temel kapılar: 9.
- Lighthouse/visual/staging kapısı: 0.

**Açık risk:** R-F015.
