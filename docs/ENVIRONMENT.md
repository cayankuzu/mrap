# mrap ortam ve yapılandırma rehberi

Canonical anahtar listesi [`.env.example`](../.env.example) dosyasındadır. Gerçek secret hiçbir zaman repository'ye yazılmamalıdır.

## Desteklenen ortamlar

| Ortam | Data provider | Amaç | Durum |
| --- | --- | --- | --- |
| Yerel development | SQLite | UI, API, authoritative sandbox ve simülasyon | Çalışıyor |
| Yerel production build | SQLite, Vercel flag olmadan | Build/Lighthouse smoke | Çalışıyor; ortak dünya değildir |
| Supabase bağlı test/preview | Supabase/Auth/PostGIS | Harici entegrasyon, migration kabulü ve E2E | `001`–`015`, lint, contract ve ürün smoke geçti; production activation kapalı |
| Vercel Preview | Supabase gerektirir | Harici entegrasyon ve E2E | Kod hazır; proje/env/domain bağlantısı doğrulanmadı |
| Vercel Production | Supabase/PostGIS gerektirir | Ortak authoritative dünya | Dış altyapı ve production kabul kapıları tamamlanmadan NO-GO |

`MRAP_DATA_PROVIDER=sqlite` Vercel'de bilinçli olarak hata verir. `MRAP_DATA_PROVIDER=supabase` sosyal/veri repository'sini, Supabase Auth akışını ve sunucu otoriteli oyun store'unu Supabase implementasyonlarına yönlendirir. Eksik veya geçersiz Supabase yapılandırması fail-closed davranır; sessiz SQLite fallback yoktur. `src/lib/database.ts` yalnız SQLite modülüdür ve Supabase akışında doğrudan yüklenmemelidir.

Bu projede Docker kullanılmaz. Bağlı kabul projesinin uzak migration durumu, SQL lint ve iki geçici kullanıcılı smoke testi 27 Ağustos 2026'da doğrulandı. Bu kanıt yalnız bağlı kabul projesine aittir; farklı bir production projesi seçilirse aynı kapılar yeniden çalıştırılmalıdır.

## Runtime sürümleri

- CI workflow Node 22 kullanır.
- `package.json`, Node `>=22 <27` ve npm `>=10` aralığını tanımlar.
- Kilitli paket yöneticisi sürümü `npm@11.19.0` değeridir.

## Yapılandırma grupları

### Yerel provider ve origin

- `MRAP_DATA_PROVIDER`
- `MRAP_SQLITE_FILENAME`
- `MRAP_CANONICAL_ORIGIN`
- `MRAP_TRUST_PROXY_HEADERS`

`MRAP_SQLITE_FILENAME` yalnız dosya adı olabilir ve `data/` dışına çıkamaz. Proxy başlıklarına production origin lockdown doğrulanmadan güvenilmemelidir.

### Dünya ve grid

- `MRAP_PRODUCTION_WORLD_ID`, `MRAP_DEVELOPMENT_WORLD_ID`
- `MRAP_CELL_ZOOM`, `MRAP_REGION_ZOOM`
- candidate cell ve viewport region limitleri

Production ve sandbox dünya kimlikleri farklı olmalıdır.

### Session, GPS ve geometri

- lease/candidate TTL, point/batch sınırları
- accuracy, spacing, hız, acceleration ve clock-skew limitleri
- proximity, minimum alan/rota/index gap ve cooldown
- maksimum claim area, bbox, aspect ratio, vertex ve cell limitleri

Server değişkenleri authoritative karardır. `NEXT_PUBLIC_MRAP_*` değerleri yalnız istemci UX önizlemesidir ve güvenlik sınırı değildir.
`NEXT_PUBLIC_MRAP_MAP_LOAD_TIMEOUT_MS` (varsayılan `12000`) yalnız harita yükleme UX zaman aşımını belirler; `5000–60000` ms dışındaki değerler reddedilip varsayılana döner.

`NEXT_PUBLIC_MRAP_POST_PUBLISH_TIMEOUT_MS` (varsayılan `20000`) gönderi yayınlama isteğinin istemci zaman aşımıdır; geçerli aralık `5000–60000` ms'dir. Timeout taslağı veya seçili medyayı silmez.

### Realtime, rate limit ve retention

- inline patch ve replay limitleri
- stream poll/heartbeat
- raw location retention
- session, batch, candidate, claim, snapshot ve subscription limitleri
- bounded transaction retry ayarları

Hesap silme gövde ve deneme sınırları `MRAP_ACCOUNT_DELETE_*`; eski açık rota saklama sınırları `MRAP_ROUTE_SESSION_*` anahtarlarıyla ayrıca yapılandırılır.

### E-posta

- SQLite sağlayıcısında `RESEND_API_KEY` ve `MRAP_EMAIL_FROM` şifre yenileme e-postası için kullanılır; yerel geliştirmede boş bırakılabilir.
- Supabase sağlayıcısında kayıt doğrulama ve parola yenileme Supabase Auth üzerinden yürür. Doğrulama e-postasının gerçekten gönderildiği ve callback hostunun izinli olduğu hedef proje üzerinde ayrıca test edilmelidir.
- Tek kullanımlık yerel geliştirme tokenı production yanıtında gösterilmez.

### Yerel test otomasyonu

- `MRAP_SIMULATOR_BASE_URL`, `MRAP_SIMULATOR_LATENCY_MS`, `MRAP_SIMULATOR_PACKET_LOSS`
- `MRAP_SMOKE_BASE_URL`
- `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_PORT`

Bu anahtarlar yalnız yerel/CI kalite komutlarını yönlendirir; uygulamanın production runtime sözleşmesinin parçası değildir. `NODE_ENV`, `CI` ve `VERCEL` ilgili çalışma zamanı tarafından sağlanır ve elle sabitlenmez.

### Supabase

- Tarayıcıya açık: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Yalnız sunucu: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`
- Medya: `SUPABASE_MEDIA_BUCKET`

Secret ve database URL hiçbir zaman `NEXT_PUBLIC_` prefix'i almamalıdır.

- `SUPABASE_MEDIA_BUCKET` özel medya nesnelerinin bucket adıdır; public bucket yapılmamalıdır.
- Supabase publishable key tarayıcıda kullanılabilir. Secret key ve doğrudan veritabanı bağlantısı yalnız sunucuda kalır.
- Auth, sosyal veri ve oyun store adaptörleri kodda vardır. Uzak migration/lint/temel ürün smoke geçti; private media, Realtime yük/backpressure, e-posta teslimatı ve production ağ kabulü tamamlanmadan bu durum production hazır olarak yorumlanmamalıdır.

### Vercel ve Cloudflare

- `CRON_SECRET`: en az 16 karakterlik rastgele server secret
- `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`: yalnız altyapı otomasyonu
- `NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS=false`: production build için zorunlu
- `MRAP_ENFORCE_PRODUCTION_CONFIG=1`: Vercel dışındaki production/staging doğrulamasında merkezi fail-fast kapısını zorlar

## Scope ve secret yönetimi

- Yerel değerler `.env.local` içinde ve git dışında tutulur.
- Vercel Development, Preview ve Production scope'ları ayrı değerler kullanır.
- Supabase secret, DB bağlantısı ve Cloudflare token ilgili platform secret store'unda tutulur.
- Secret hiçbir log, analytics, browser bundle, source map veya hata cevabına eklenmez.
- Secret değişimi sonrası preview smoke, bundle secret scan ve rollback yolu yeniden doğrulanır.

## Production validation kapısı

`src/instrumentation.ts`, Node runtime başlarken `src/server/production-environment.ts` doğrulamasını çalıştırır. Kapı Vercel production'da veya `MRAP_ENFORCE_PRODUCTION_CONFIG=1` ile etkinleşir ve şu koşullarda fail-fast davranır:

- canonical origin HTTPS değil;
- provider `sqlite`;
- Supabase URL, publishable key veya server secret bilgisi eksik ya da biçimsiz;
- production ile sandbox world aynı;
- developer controls açık;
- cron secret yetersiz;
- Turnstile eksik, kısmi veya canonical production hostunu kapsamıyor;
- doğrulanmış proxy başlıkları kapalı.

Bu başlangıç doğrulaması dış platform bağlantısının yapıldığını kanıtlamaz. Vercel project link, secret scope, custom domain, DNS, Cloudflare widget/hostname ve uzak Supabase kabulü ayrıca doğrulanmalıdır.
