# mrap değişiklik envanteri

Tarih: 27 Ağustos 2026  
Kapsam: 35 kategori kalite turunda gözlenen kaynak, test, CI, migration ve doküman değişiklikleri.

> Çalışma alanında `.git` geçmişi bulunmadığı için bu belge bir commit diff'i değildir. Envanter; baseline sonrası dosya zamanları, mevcut kaynak incelemesi, test kanıtları ve yapılan görev kayıtlarından çıkarılmıştır. Bu nedenle binary ekran görüntüleri ve geçici runtime dosyaları uygulama değişikliği olarak sayılmamıştır.

## Uygulama kabuğu, erişilebilirlik ve responsive

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/components/AppShell.tsx` | Sabit üst bar, ana ekranlar dışındaki rotalarda geri butonu, yalnız bildirim aksiyonu, onaylı çıkış ve özel client-state temizliği | Mobil/masaüstü navigasyon, görünür bildirim ve güvenli çıkış |
| `src/components/ConfirmationDialog.tsx` | Odak tuzağı, Escape, focus restore ve pending/error durumlu onay paneli | Çıkış/silme gibi yıkıcı işlemlerin erişilebilir onayı |
| `src/components/MediaLightbox.tsx` | Portal, `aria-modal`, odak tuzağı, Escape, backdrop ve focus restore | Harita/fotoğraf/beğeni/yorum panelleri için ortak erişilebilir primitive |
| `src/app/globals.css` | 320–1920 responsive kurallar, safe-area, modal/bottom-sheet, adaptif masonry, harita paneli ve kart düzeltmeleri | Taşma, ölü alan, küçük ekran ve gesture sorunları |
| `src/app/(auth)/layout.tsx` | Auth ekranı geri navigasyonu ve mrap uyumlu görsel yapı | Auth akışını ürün kabuğuyla tutarlı yapmak |
| `src/app/(dashboard)/layout.tsx`, `src/app/demo/layout.tsx` | Ortak shell ve gerçek/demo sınırı | Tekrarlı navigasyon ve davranış ayrışmasını azaltmak |

## Auth, profil, hesap ve yasal onay

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/components/AuthForm.tsx` | Ülke/şehir, doğum tarihi, anlık kullanıcı/e-posta uygunluğu, yasal onay sürümü ve güvenli reset akışları | Kayıt gereksinimleri ve kimlik bütünlüğü |
| `src/components/SettingsClient.tsx` | Profil ve ayarlar ayrı tablar; tüm düzenlenebilir bilgiler, 36 renk, sabit konum gizliliği ve onaylı hesap silme | Ayar UX'i, gizlilik ve kalıcı silme |
| `src/components/DemoSettingsClient.tsx`, `src/components/DemoProfileProvider.tsx` | Gerçek hesapla eşdeğer demo profil/ayar davranışı | Demo ile gerçek ürün sözleşmesini yakınlaştırmak |
| `src/lib/validation.ts`, `src/lib/validation.test.ts` | NFKC, Türkçe locale lower-case, Unicode harf/rakam ve code-point sınırı | Türkçe kullanıcı adı ve benzersizlik tutarlılığı |
| `src/lib/age-policy.ts`, `src/lib/age-policy.test.ts` | 13–100 yaş ve ISO doğum tarihi sınırı | Client/server yaş doğrulamasını tekleştirmek |
| `src/lib/legal-consent.ts`, `src/lib/legal-consent.test.ts`, `src/config/legal-policy.json` | Sürümlü koşul/gizlilik onayı | Kayıt anındaki yasal onayı kanıtlamak |
| `src/lib/auth.ts`, `src/lib/auth-expiry-store.ts` | Hash'li token, kalıcı/geçici session ve expiry cleanup | Session güvenliği |
| `src/app/api/auth/register/route.ts` | Server-side kimlik, renk, konum, yaş ve consent doğrulaması | UI kontrolüne güvenmemek |
| `src/app/api/auth/login/route.ts` | Güvenli login ve normalize edilmiş kimlik | Auth tutarlılığı |
| `src/app/api/auth/reset/route.ts`, `src/server/email/password-reset-email.ts` | Generic reset cevabı, süreli tek kullanımlık token ve production e-posta adapter'ı | Account enumeration ve token kötüye kullanımını azaltmak |
| `src/app/api/auth/logout/route.ts` | Aktif rekabetçi oturumu/ham noktaları revoke edip session silme | Çıkış sonrası GPS/oturum kalıntısını önlemek |
| `src/app/api/account/route.ts`, `src/lib/account-deletion-store.ts` | Şifre+kullanıcı adı+ack onayı, tek transaction cascade ve realtime alan temizliği | Hesabın tüm ilişkili verilerini güvenli silmek |
| `src/app/api/profile/route.ts` | Server-side username, palette, yaş, konum ve profil medya doğrulaması | Profil güncellemesini authoritative yapmak |
| `src/proxy.ts`, `src/lib/safe-navigation.ts` | Origin/Sec-Fetch CSRF kontrolü ve güvenli `next` dönüş yolu | CSRF ve open redirect koruması |

## Sosyal akış, yorum, takip ve medya

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/components/RealFeed.tsx` | Ortak post mutation state, cursor pagination, başlık/açıklama, zorunlu territory, 6 medya, yorum/beğeni/kayıt/takip ve paylaşım | Gerçek veri sosyal MVP'sini tamamlamak |
| `src/components/PostCard.tsx` | Demo kartını gerçek kart davranışına yaklaştıran yorum, beğeni listesi, kayıt ve medya etkileşimleri | Demo eşdeğerliği |
| `src/components/PostCommentsDialog.tsx` | Ayrı erişilebilir yorum paneli, cursor, optimistic gönderim, retry ve karakter sayacı | Inline yorum sorununu kapatmak |
| `src/components/PostLikesDialog.tsx` | Uzun basmada açılan erişilebilir beğenenler paneli | İstenen etkileşim ve odak davranışı |
| `src/components/PostMediaCarousel.tsx` | Thumbnail şeridi, lightbox, pointer swipe ve ileri/geri kontrolleri | Mobilde altı fotoğraf gezintisi |
| `src/components/PhotoSelectionGrid.tsx` | Tek tıkla seç/swap, 0,5 sn basılı tutma ile büyütme | Composer medya sırası UX'i |
| `src/components/TerritoryFrameEditor.tsx` | Gerçek haritada pan/zoom/kadraj kaydetme | Paylaşılacak mini haritanın varsayılan görünümünü seçmek |
| `src/components/TerritoryInteractiveMap.tsx` | Kısıtlı gezilebilir gerçek mini harita, büyütme ve owner sınır yazısı | Karttaki statik görsel yerine etkileşimli harita |
| `src/components/SocialConnections.tsx` | Takip/takipçi cursor listesi, gizli hesap erişimi ve modal focus yönetimi | Mobilde çalışmayan bağlantı listelerini düzeltmek |
| `src/components/PlayerSearch.tsx`, `src/components/DemoPlayerSearch.tsx` | Debounced gerçek arama ve demo eşdeğeri | Keşfet kullanıcı araması |
| `src/components/ProfilePostTabs.tsx`, `src/components/DemoProfileTabs.tsx` | Gönderiler/kaydedilenler ortak kart projection'ı | Profil akış tutarlılığı |
| `src/lib/post-mutation-state.ts` | Aynı gönderi/yazarın tüm kart kopyalarında ortak like/save/follow/comment state'i | Keşfet, ana sayfa ve profil yakınsaması |
| `src/lib/post-feed-store.ts`, `src/lib/post-cursor.ts` | Mod bazlı cursor feed ve duplicate engelleme | Following/explore/saved/user akışlarını ayırmak |
| `src/lib/post-comment-store.ts`, `src/lib/comment-cursor.ts` | Kalıcı yorum, idempotency ve cursor pagination | Yorum paneli veri sözleşmesi |
| `src/lib/post-like-store.ts`, `src/lib/mutation-idempotency-store.ts` | Desired-state ve tekrar güvenli sosyal mutation | Retry ile çift etkiyi önlemek |
| `src/lib/social-discovery-store.ts`, `src/lib/connection-cursor.ts` | Arama, leaderboard ve takip listesi projection'ları | Bounded sorgu ve gizlilik |
| `src/lib/user-media-reference.ts`, `src/server/http/image-response.ts` | Compact URL projection ve private/no-store medya cevapları | Feed payload boyutu ve medya gizliliği |
| `src/server/http/media-validation.ts` | MIME/signature/dimension/decode/EXIF doğrulama | Görsel bombası ve metadata sızıntısını engellemek |
| `src/app/api/posts/route.ts` ve `src/app/api/posts/[id]/**` | Post, yorum, like/save, liker ve image endpoint sözleşmeleri | Gerçek sosyal sistemi kalıcı ve yetkili yapmak |
| `src/app/api/follows/[id]/route.ts`, `src/app/api/follow-requests/[id]/route.ts` | Açık/gizli takip state machine'i | Takip ve istek onayı |
| `src/app/api/users/route.ts`, `src/app/api/users/[id]/**` | Arama, bağlantı, avatar ve cover erişim kontrolleri | Profil keşfi ve privacy |

## Harita, rota, ownership, paint ve offline

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/components/GameMap.tsx` | Gerçek/simulated provider, rota FSM, loop candidate, claim/continue, region SSE, session recovery, offline taslak, renk ve responsive paneller | MVP oyun orchestration'ı |
| `src/lib/game/game-session.ts`, `route-tracker.ts`, `loop-detector.ts` | Segmentli rota, self-contact/boundary loop ve jitter/minimum kuralları | Başlangıca dönmeden stratejik loop |
| `src/lib/game/location-provider.ts` | Real ve simulated location provider ortak arayüzü | GPS'den bağımsız test edilebilir domain |
| `src/lib/game/authoritative-state-machine.ts`, `authoritative-types.ts` | Açık authoritative UI/session state'leri | UI'ın geometri/ownership kararı vermemesi |
| `src/lib/game/session-recovery.ts` | Per-user sessionStorage lease/nonce recovery | Sekme kapanması ve takeover dayanıklılığı |
| `src/lib/game/offline-route-draft.ts`, `offline-route-policy.ts` | TTL/bounded kişisel offline GPS taslağı ve rekabetçi kanaldan ayrım | Offline GPS'in sonradan claim'e girmesini engellemek |
| `src/lib/game/route-point-queue.ts` | Yalnız online gözlenmiş, ACK-belirsiz noktalar için idempotent geçici kuyruk | Ağ cevabı belirsizliğinde kayıp/çift gönderim önleme |
| `src/lib/private-client-state.ts` | Logout/delete sırasında session, queue, draft, composer ve renk temizliği | Hassas cihaz verisi kalıntısını önlemek |
| `src/lib/spatial/ownership-grid.ts` | Canonical hücre ve region eşleme | Tek fiziksel alan/tek owner invariantı |
| `src/lib/territory/territory-engine.ts` | Union/difference/overlap, unique area ve paint ayrımı | Çift skor/katman engeli |
| `src/lib/realtime/region-reconciler.ts` | Duplicate, gap ve out-of-order event reconciliation | Client state'in geriye gitmesini önlemek |
| `src/server/game/authoritative-config.ts` | Session/GPS/geometry/limit/realtime eşikleri | Business limitleri koddan ayırmak |
| `src/server/game/schema.ts` | Session, point, candidate, claim, cell, score, outbox, route ve audit tabloları | Yerel authoritative source of truth |
| `src/server/game/authoritative-store.ts` | Nonce/lease, anti-cheat, transaction, idempotency, unique score, paint/ownership ve recovery | Client claim/score yazmasını engellemek |
| `src/app/api/game/**` | Bounded authenticated session→points→candidate→claim ve versioned region API'leri | Güvenli multiplayer contract |
| `src/app/api/territories/**` | Legacy client polygon yazımını kapatma; mine/read projection | Ownership'in yalnız authoritative akıştan değişmesi |

## Veri, rate limit ve migration

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/lib/database.ts`, `src/lib/sqlite-migrations.ts` | SQLite şema yükseltmeleri, FK/index ve Vercel fail-closed provider kontrolü | Yerel test bütünlüğü; sessiz production fallback'i önlemek |
| `src/lib/repository.ts` | Auth, sosyal, profile, territory, notification ve route projection'ları | UI ile SQLite arasında tek veri erişim sınırı |
| `src/server/http/rate-limit.ts` | SQLite tabanlı bounded persistent limiter ve fail-closed hata | Process restart ve spam dayanıklılığı |
| `src/server/http/api-security.ts`, `limited-json.ts` | Gövde limitleri, no-store ve güvenli JSON hataları | Kaynak tüketimi ve cache sızıntısı koruması |
| `supabase/migrations/202608270012_social_idempotency_search_consent.sql` | Social idempotency, search key ve legal consent production şeması | Gelecekteki Postgres geçişiyle local contract paritesi |

## Bildirim, analitik ve ürün metadata

| Dosya | Değişiklik | Neden |
|---|---|---|
| `src/lib/notification-store.ts`, `notification-identity-store.ts`, `notification-presentation.ts` | Kimlikli/deep-link güvenli notification projection | Metinden link çıkarmayı ve duplicate bildirimi azaltmak |
| `src/components/NotificationsClient.tsx`, `src/app/api/notifications/route.ts` | Bildirim listesi ve read state | Sabit üst bardaki bildirimi gerçek veriye bağlamak |
| `src/lib/analytics.ts`, `src/components/AnalyticsReporter.tsx` | PII redaksiyonlu tipli event şeması ve Web Vitals hook'u | Gelecekte güvenli monitoring sınırı; production sink henüz açık risk |
| `src/app/manifest.ts`, `robots.ts`, `sitemap.ts`, `layout.tsx` | mrap adı, canonical metadata, manifest ve crawler sınırı | Ürün adı ve web deployment metadata'sı |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Konum, yerel veri, güvenli oyun ve release sınırları | Kullanıcıya açık gizlilik/koşul metni |

## Test ve kalite otomasyonu

| Dosya | Değişiklik | Neden |
|---|---|---|
| `tests/e2e/smoke.spec.ts` | Landing/auth/demo harita/profil/yorum/kayıt smoke senaryoları | Kritik görünür akış regresyonu |
| `tests/e2e/real-account.spec.ts` | Unicode kayıt, logout/login ve kalıcı silme | Gerçek hesap yaşam döngüsü |
| `tests/e2e/responsive.spec.ts` | 320–1920, kısa ekran, landscape ve %200 metin matrisi | Horizontal overflow ve küçük ekran kontrolü |
| `tests/e2e/accessibility.spec.ts` | WCAG 2.2 Axe kritik/serious kapısı ve yorum paneli | Erişilebilirlik regresyonu |
| `tests/e2e/routes.spec.ts`, `support.ts`, `fixtures.ts` | Route health, browser failure takibi ve izolasyon | Kararlı çoklu motor E2E altyapısı |
| `scripts/smoke-local-product.mjs` | Geçici iki gerçek hesapla claim→post→comment→like→save→follow→notification→delete | HTTP seviyesinde gerçek ürün kabulü |
| `scripts/simulate-multiplayer.mjs` | Eşzamanlı iki claim, duplicate batch, canonical winner, idempotent finish ve cleanup | Yerel authoritative concurrency kabulü |
| `scripts/verify-source-hygiene.mjs` | Secret/bitmemiş iş/eski marka ve kaynak hijyen taraması | Release kalıntılarını CI'da engellemek |
| `.github/workflows/quality.yml` | npm ci, hygiene, typecheck, lint, coverage, audit, build, product smoke, multiplayer ve 3 motor E2E | PR kalite kapısı |
| `src/**/*.test.ts` | Auth, sosyal, medya, cursor, geometry, ownership, realtime, offline, account deletion ve boundary testleri | Domain ve API regresyonlarını kapsamlaştırmak |

## Dokümantasyon

| Dosya | Değişiklik | Neden |
|---|---|---|
| `docs/ARCHITECTURE.md`, `docs/GAME_CORE.md`, `docs/MRAP_GAME_RULES.md` | Local mevcut durum ve mrap oyun invariantları | Mimari ve ürün sözleşmesi |
| `docs/OWNERSHIP_AND_PAINT.md`, `docs/LOCATION_PRIVACY.md` | Tek owner/unique score/paint ve kesin GPS gizliliği | Kritik domain/gizlilik kararları |
| `docs/SECURITY.md`, `docs/SECURITY_THREAT_MODEL.md` | Tehdit, kontrol ve açık kabul riskleri | Security due diligence |
| `docs/ERROR_HANDLING.md`, `docs/FAILURE_RECOVERY.md` | Timeout/retry/offline/recovery davranışı | Dayanıklılık operasyonu |
| `docs/PERFORMANCE_BUDGET.md` | Route, CWV, API, memory ve map bütçeleri | Ölçülebilir performans hedefi |
| `docs/DEPLOYMENT.md`, `docs/ENVIRONMENT.md` | Vercel/Supabase/Cloudflare hedefi ve fail-closed mevcut durum | Production sınırını dürüstçe belgelemek |
| `docs/LOCAL_MULTIPLAYER.md`, `docs/LOCAL_MULTIPLAYER_TESTING.md` | Docker'sız iki client ve concurrency prosedürü | Yerel kabul tekrar üretilebilirliği |
| `docs/DEPENDENCY_LICENSES.md`, `docs/INVESTOR_TECHNICAL_DUE_DILIGENCE.md` | Lisans/audit ve yatırımcı teknik riskleri | Tedarik zinciri ve due diligence |
| `docs/audit/FINAL_AUDIT.md`, `FINAL_SCORES.md`, `EVIDENCE_MATRIX.md`, `OPEN_RISKS.md`, `CHANGED_FILES.md` | Final kanıt, skor, risk ve envanter paketi | Master prompt zorunlu teslimatı |

## Bilinçli olarak değiştirilmemesi gerekenler

- Docker yapılandırması eklenmedi ve Docker çalıştırılmadı.
- Dark mode veya yeni görünür ürün sekmesi eklenmedi.
- Production adapter varmış gibi sahte bir Supabase implementasyonu yazılmadı.
- Yerel runtime artifaktları bu envanter görevi sırasında silinmedi.
