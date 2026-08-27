# mrap üretim mimarisi

Bu belge, yerel SQLite MVP ile hedeflenen üretim altyapısı arasındaki sınırı tanımlar. Depoda Supabase anahtarı bulunmaz ve mevcut uygulama henüz Supabase'e canlı bağlı değildir. Migration dosyalarının bulunması, production bağlantısının tamamlandığı anlamına gelmez.

## Mevcut durum

- Yerel geliştirme `MRAP_DATA_PROVIDER=sqlite` ile çalışır.
- SQLite verisi yalnızca geliştiricinin bilgisayarındaki `data/` klasöründe kalır.
- Vercel ortamında SQLite kullanımı `src/lib/database.ts` tarafından bilinçli olarak durdurulur.
- `MRAP_DATA_PROVIDER=supabase` seçildiğinde Supabase Auth, sosyal repository ve authoritative oyun store'u kullanılır; eksik/yanlış uzak yapılandırmada SQLite'a sessiz fallback yapılmaz.
- `supabase/migrations/` hedef şemayı sürümlü ve incelenebilir biçimde hazırlar.
- Harici Supabase projesi, Cloudflare zone'u, DNS kaydı veya secret oluşturulmamıştır.

## Hedef ağ yapısı

```text
Tarayıcı / kurulabilir web uygulaması
                |
                v
Cloudflare DNS + Proxy
TLS, WAF, rate limit, bot/abuse kuralları, statik CDN
                |
                v
Vercel / Next.js
RSC, aynı-origin BFF API, validation, authorization
                |
                v
Supabase
Auth + PostgreSQL + PostGIS + RLS + Storage
                |
                +---- private Realtime Broadcast ----> istemci
```

Cloudflare ortak oyun dünyasının veri tabanı değildir. Tek ve otoriter dünya PostgreSQL/PostGIS'tir. Cloudflare edge güvenliği ve dağıtım sağlar; Vercel uygulama/BFF katmanıdır.

## Sorumluluk sınırları

### Cloudflare

- Uygulama alan adını Vercel origin'ine yönlendirir.
- TLS zorunluluğu, Managed WAF ve bot/abuse kuralları uygular.
- `/api/auth/login`, `/api/auth/register`, şifre kurtarma ve `/api/territories` için ayrı rate-limit kuralları uygular.
- `/_next/static/*` gibi immutable statik varlıkları cache'leyebilir.
- `/api/*`, authenticated HTML/RSC cevapları ve cookie içeren cevapları cache'lemez.
- WebSocket'in yalnızca ilk upgrade isteğinin WAF tarafından denetlendiği kabul edilir; mesaj yetkisi Supabase Realtime RLS tarafından uygulanır.

### Vercel / Next.js

- Kullanıcı girdisini şema ile doğrular ve kullanıcıyı her mutasyonda yeniden yetkilendirir.
- Secret key'i yalnızca server-only data access katmanında kullanır.
- Claim isteğine idempotency key ekler ve production'da simulation claim'ini reddeder.
- PostGIS transaction/RPC sonucunu authoritative sonuç olarak kabul eder.
- Private Storage nesneleri için yalnızca gönderiyi görmeye yetkili kullanıcıya kısa ömürlü signed URL üretir.
- Tam GPS veya aktif rotayı Realtime kanalına göndermez.

### Supabase

- `auth.users` kimliğin kaynağıdır; e-posta ve parola profile tablosuna kopyalanmaz.
- `profiles` yalnızca paylaşılabilir profil alanlarını tutar.
- Doğum tarihi ve konum görünürlük tercihi `profile_private` içinde sahibine özeldir.
- Canonical grid güncel sahipliği ve boya sonucunu tek-owner hücrelerde, claim
  geçmişini ayrı immutable eventlerde saklar.
- Private Broadcast yalnız tamamlanmış transactionın region patch/invalidation
  ve kullanıcıya özel sonuç mesajlarını taşır.
- Storage binary medyayı tutar; PostgreSQL yalnızca object key ve metadata tutar.

## Veri modeli ilkeleri

### Sahiplik

`territory_cells`, `(world_id, cell_id)` primary key'iyle güncel gerçeği temsil
eder. Her canonical hücrenin en fazla bir ownerı ve bir güncel paint değeri
vardır. Serbest polygonlar authoritative değildir; trusted grid adapter server
polygonunu deterministic cell listesine dönüştürür. H3 extensionı varsayılmaz;
scheme/resolution/version world kaydında konfigüre edilir.

`claim_events` ve `claim_cell_changes` append-only olay kaydıdır. Bir retry aynı
`(user_id, operation_type, idempotency_key)` ile ikinci olay oluşturamaz. Claim
geçmişi haritada üst üste sahiplik katmanı olarak çizilmez.

`territory_current`, `paint_current` ve `claim_history` phase-2 uyumluluk
tablolarıdır; yeni multiplayer dünyasında source of truth değildir. Production
adapterı yalnız canonical grid/event API'sini kullanmalıdır.

### Boya

Ownership ve paint kavramsal olarak ayrıdır. Hücrede owner değişmeden yalnız
`paint_color_id/paint_version` değişebilir ve bu territory skorunu artırmaz. Son
authoritative paint kazanır; sonsuz layer birikmez.

### Dünya ve region versiyonu

`worlds.current_version` MVP authoritative commit sırasını;
`world_regions.version` viewport patch/snapshot sırasını taşır. Database triggerı
version gerilemesini engeller. Realtime veri kaynağı değildir. Client region
gap/reconnect sonrasında snapshot ister ve `lastAppliedVersion` ile uzlaşır.

### Ülke ve şehir

- Ülke ISO-3166 iki harfli kodla tutulur.
- Şehir serbest metin değil `cities.id` ile tutulur.
- `(city_id, country_code)` foreign key, ülke/şehir uyuşmazlığını veri tabanında engeller.
- Türkçe ad `name_tr`; gelecekteki diller `names` JSON alanında stable ID değişmeden eklenebilir.
- Kullanıcının dil tercihi `profile_private.preferred_locale` içinde BCP 47 biçiminde tutulur; ilk değer `tr-TR` olur.
- Notification tablosunda çevrilmiş cümle yerine sabit event kodu/payload tutulur; çeviri sunum katmanında yapılır.
- Şehir sıralaması istemcide global ilk 100'ü filtreleyerek değil, `city_id` ile sunucuda sorgulanır.

## Claim transaction sözleşmesi

`app_private.execute_claim_command` yalnız `service_role` tarafından çağrılır ve
polygon/cell/owner/score/client timestamp parametresi kabul etmez. JWT'den
çıkarılan user, server-issued session/candidate, accepted sequence, color ID,
idempotency key ve payload hash alır.

1. Session/candidate/user/world composite kimliği yeniden doğrulanır.
2. Lease, tek aktif session, risk, production simulation ve rate limit kontrolü
   yapılır.
3. Server-generated candidate geometry, sequence coverage ve materialized cell
   seti tekrar doğrulanır.
4. World, sorted regionlar ve sorted celller transaction içinde lock edilir.
5. Current owner/paint lock sonrasında yeniden okunur; stale snapshot kullanılmaz.
6. Hücre owner/paint, etkilenen skorlar, immutable event/change satırları,
   notification ve Realtime outbox atomik yazılır.
7. Aynı owner/same-color işlem gerçek no-op'tur; score/version/event spamı yoktur.
8. Outbox worker private region/user Broadcast mesajlarını güvenle yayınlar.

Client Turf sonucu yalnız previewdür. MVP world lock doğruluk lehine regionlar
arası işlemleri de sıraya koyar; ölçek geçişi sorted region/cell kilitleri ve
region version protokolünü korur. Ayrıntılar ADR-001..003 ve
`CONCURRENCY_RULES.md` içindedir.

## Harita okuma sözleşmesi

Bütün dünya geometry'si tek cevapta dönmemelidir. Hedef endpoint sözleşmesi:

```text
GET /api/world?bbox=minLng,minLat,maxLng,maxLat&zoom=15&since=1234
```

- Yalnızca viewport ile kesişen geometry döner.
- Zoom seviyesine göre clip/simplify uygulanır.
- Büyük ölçekte `ST_AsMVT` vector tile endpoint'ine geçilir.
- Kullanıcı adı ve güncel sahiplik görünür olabilir; tam GPS ve aktif rota hiçbir zaman dönmez.

## Medya yükleme

Altı fotoğraf base64 JSON olarak Vercel Function'a gönderilmez.

1. İstemci BFF'den upload izni ister.
2. BFF kullanıcı, dosya sayısı, beklenen MIME ve byte limitini doğrular.
3. İstemci binary dosyayı doğrudan private `mrap-media` bucket'ına yükler.
4. Dosya yolu `{userId}/posts/{draftOrPostId}/{randomId}.webp` biçimindedir.
5. Finalize işlemi magic-byte, gerçek byte boyutu, owner path ve object varlığını doğrular.
6. Production image pipeline EXIF/GPS metadata'yı temizler ve güvenli formata yeniden encode eder.
7. `post_media` yalnızca object key, MIME, ölçü, byte ve sıralamayı saklar.

Bucket private'tır. Owner doğrudan kendi nesnesini yönetebilir; başka kullanıcılar görünürlük kontrolü yapılmadan nesne URL'si alamaz.

## RLS özeti

- Ülke ve aktif şehirler anonim okunabilir.
- Profilin paylaşılabilir kısmı authenticated kullanıcılar tarafından okunabilir.
- `profile_private`, saved posts ve notifications yalnızca sahibi tarafından okunabilir.
- Private profil postları yalnızca owner veya kabul edilmiş follower tarafından okunabilir.
- Güncel canonical territory cells ve scorelar authenticated dünya oyuncularına
  görünür; raw session/batch/candidate/claim event yalnız sahibine görünür.
- Claim cell changes, outbox, risk ve audit clienta doğrudan görünmez; core
  mutasyonların hiçbirinde anon/authenticated write grantı yoktur.
- Realtime `world:{worldId}:region:{regionId}` ve `user:{auth.uid}:private`
  topicleri private'tır. Client authoritative Broadcast gönderemez.

## Ortam ve secret kuralları

`.env.example` yalnızca anahtar adlarını içerir. Gerçek değerler:

- Yerelde `.env.local`
- Vercel'de Development / Preview / Production ayrı scope'ları
- Supabase ve Cloudflare dashboard secret store

üzerinden sağlanır.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` tarayıcı için tasarlanmıştır. `SUPABASE_SECRET_KEY`, database URL ve Cloudflare API token hiçbir zaman `NEXT_PUBLIC_` prefix'i almaz veya client bundle'a import edilmez.

Vercel serverless doğrudan Postgres bağlantısı kullanacaksa Supavisor transaction pooler URL'si seçilir ve prepared statements kapatılır. Migration/backup işlemleri direct connection kullanır.

## Cloudflare cache ve güvenlik kuralları

Production zone oluşturulduğunda en az şu kurallar tanımlanmalıdır:

- Always HTTPS ve HSTS
- Managed WAF
- Auth endpoint'lerinde IP tabanlı brute-force limiti
- Claim/post/comment mutasyonlarında edge abuse limiti
- `/api/*` ve authenticated route'larda cache bypass
- `/_next/static/*` için immutable cache
- Origin'e yalnızca beklenen host ile erişim
- Kurallar önce log/challenge modunda gözlenip doğrulandıktan sonra block moduna alınır

Edge rate limit tek savunma değildir. Kullanıcı bazlı idempotency ve iş limiti Postgres transaction katmanında da bulunur.

Uygulama katmanındaki istemci-IP başlıkları varsayılan olarak güvenilmez. `MRAP_TRUST_PROXY_HEADERS=1` yalnızca doğrudan Vercel origin erişimi kapatıldıktan, Cloudflare/Vercel başlık normalizasyonu doğrulandıktan ve edge rate-limit kuralları etkinleştirildikten sonra açılır. `MRAP_CANONICAL_ORIGIN` production HTTPS origin'ine sabitlenir; mutasyon API'leri eksik veya farklı `Origin` başlığını reddeder. Process-local limiter production savunması sayılmaz; paylaşımlı kullanıcı/IP limiti edge veya durable veri katmanında uygulanır.

## Yerel doğrulama

Supabase CLI ve Docker hazır olduğunda:

```bash
supabase start
supabase db reset
supabase db lint
```

Uzak proje oluşturulduktan sonra `supabase/config.toml` içindeki Postgres major version, `SHOW server_version` sonucuyla eşleştirilmelidir.

Zorunlu contract/integration senaryoları:

- Ülke/şehir composite FK reddi
- Private profile post erişim matrisi
- Storage owner path politikası
- Tekrarlanan idempotency key
- Overlap/union/difference ve MultiPolygon
- İki eşzamanlı rakip claim sonunda sıfır çift sahiplik
- Paint'in sahiplikten bağımsız kalması
- Realtime mesajında GPS/rota bulunmaması
- Reconnect sonrası world version uzlaşması

## Production geçiş kapıları

Canlı bağlantı ancak şu maddelerin tamamı gerçekleşince açılmalıdır:

1. Supabase project ve uygun region seçildi.
2. Migration'lar boş local stack ve staging üzerinde hatasız uygulandı.
3. Claim transaction/RPC staging concurrency, RLS, geometry ve idempotency
   testlerinden geçti; trusted route/grid candidate üreticisi bağlandı.
4. Next.js async Supabase data adapter'ı tamamlandı; SQLite bağımlılığı production bundle yolundan çıkarıldı.
5. Supabase Auth recovery/e-posta doğrulama akışı tamamlandı.
6. Signed media upload ve metadata temizliği tamamlandı.
7. Private Broadcast client'ı reconnect/version mantığıyla tamamlandı.
8. Cloudflare DNS/WAF/cache/rate-limit kuralları staging üzerinde doğrulandı.
9. Güvenlik, çoklu kullanıcı E2E ve yük testleri geçti.
10. Vercel production env'de `MRAP_DATA_PROVIDER=supabase` ancak gerçek adapter hazırlandıktan sonra etkinleştirildi.

Bu kapılar tamamlanmadan uygulama ortak production dünyasına bağlıymış gibi sunulmamalıdır.

## Resmî kaynaklar

- [Supabase PostGIS](https://supabase.com/docs/guides/database/extensions/postgis)
- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase serverless connection pooling](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Cloudflare rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)
- [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)
