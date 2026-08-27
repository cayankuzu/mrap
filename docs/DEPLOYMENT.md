# mrap deployment rehberi

## Release durumu

Mevcut uygulama yerelde çalışır. Bağlı Supabase kabul projesine `001`–`015` migrationları uygulandı; uzak lint, uygulama–SQL sözleşme kontrolü ve iki geçici kullanıcıyla claim + sosyal ürün smoke testi geçti. Test hesaplarının Auth, profil ve territory sahipliği temizliği de doğrulandı. Production dünyası güvenlik gereği hâlâ `draft` ve rekabetçi claim kapalıdır.

İnternet yayını tamamlanmadı: bu çalışma ortamında Vercel team/project yetkisi, production hostname'i, Cloudflare zone/token ve Turnstile anahtarları yoktur. SQLite serverless instance'lar arasında ortak veya kalıcı kaynak olarak kullanılamaz ve kod Vercel'de bunu bilinçli olarak reddeder. Bu turda Docker kullanılmadı.

Uzak veritabanı kabul kanıtı: [Supabase kabul kaydı](./audit/SUPABASE_ACCEPTANCE_2026-08-27.md).

## Hedef topology

```text
Kullanıcı
  → Cloudflare DNS/proxy, TLS, WAF, bot ve edge rate limit
  → Vercel Next.js uygulaması ve same-origin BFF
  → Supabase Auth, PostgreSQL/PostGIS, Storage, private Realtime
```

Cloudflare source of truth değildir. Cache yalnız immutable statik varlıklarda kullanılmalı; `/api/*`, authenticated RSC/HTML ve cookie içeren cevaplar bypass edilmelidir.

## Ön koşullar

1. Supabase project/region ve staging ayrımı oluşturulur. Bağlı kabul projesi hazırdır; ayrı production projesi/kararı ayrıca verilmelidir.
2. `001`–`015` migrationları sıralı uygulanır; bağlı kabul projesindeki push/lint tamamlandı, production hedefinde checksum yeniden doğrulanmalıdır.
3. Next.js async Supabase data adapter, Supabase Auth ve session recovery hedef ortamda doğrulanır.
4. Claim RPC concurrency, idempotency, geometry, score ve privacy testlerini staging'de geçer.
5. Private Storage bucket, signed URL ve EXIF/GPS temizleme akışı tamamlanır.
6. Private Realtime publisher ve client reconnect/version protokolü tamamlanır.
7. Cloudflare DNS/WAF/cache/rate-limit/origin lockdown kuralları staging'de gözlenir.
8. Vercel Preview env değerleri [ENVIRONMENT.md](./ENVIRONMENT.md) kapılarını geçer.
9. Üç-engine E2E, accessibility, Lighthouse, load ve güvenlik smoke geçer.

## Vercel yapılandırması

- Build: `npm run build`
- Runtime provider: yalnız tamamlanmış `MRAP_DATA_PROVIDER=supabase`
- Secretler: server-side Vercel env scope
- `CRON_SECRET`: location retention endpoint'ini korur
- `vercel.json`: günlük location retention çağrısını tanımlar
- Preview ve Production Supabase projeleri/secretleri ayrıdır

`SUPABASE_SECRET_KEY` yeni server secret modelinde yalnız server request `apikey` alanında kullanılmalı; browser'a veya public env'e taşınmamalıdır.

## Cloudflare kuralları

- Vercel, üst üste CDN/proxy kullanımının trafik görünürlüğü, gecikme ve çift cache riski taşıdığını belirtir. Cloudflare proxy ürün kararı olarak korunursa Vercel Verified Proxy durumunu ve Firewall'daki `Proxy Detected` uyarısını gözlemle.
- SSL/TLS modu `Full` veya `Full (strict)` olmalı; `Flexible` yönlendirme döngüsü oluşturabilir.
- `/.well-known/acme-challenge/*` için HTTP challenge ve `/.well-known/vercel/*` için cache bypass korunmalı; özel WAF kuralları bu yolları engellememeli.
- Always HTTPS ve HSTS
- Managed WAF
- Auth, claim, post ve comment mutasyonlarına ayrı abuse limitleri
- `/_next/static/*` immutable cache
- API/authenticated/cookie cevaplarına cache bypass
- Vercel'in doğrudan deployment adresine erişim gerekiyorsa onu production kullanıcı trafiği olarak ilan etme; daha sıkı origin kısıtı gerekiyorsa Vercel WAF/Trusted IPs plan uygunluğunu ayrıca doğrula
- Kurallar önce log/challenge, kanıt sonrasında block moduna alınır

Process-local limiter production dağıtık savunma sayılmaz. Edge ve durable kullanıcı limitleri birlikte gerekir.

## Deployment sırası

1. Migration checksum ve database backup doğrulanır.
2. Staging migration uygulanır.
3. Preview deployment oluşturulur.
4. Health, auth, feed, map snapshot, realtime reconnect ve iki-client claim smoke çalışır.
5. Bundle secret scan, security headers, dependency audit ve performance budget kontrol edilir.
6. Production database backup/PITR hazırken migration uygulanır.
7. Vercel production deploy edilir; Cloudflare cache temizliği yalnız gerekli statik kapsamda yapılır.
8. Claim önce kontrollü/read-only flag ile gözlenir; metrikler normalse competitive write açılır.

## Smoke kontrolü

- Landing ve auth route'ları 2xx, private route unauthenticated redirect verir.
- `/api/game/health` beklenen correlation ID ve no-store cevabı üretir.
- İki kullanıcı aynı region snapshot/version sonucuna ulaşır.
- Duplicate claim aynı resultı verir ve skor artmaz.
- Başka kullanıcının raw GPS/session verisi okunamaz.
- Production simulation session reddedilir.
- Notification/realtime payloadında GPS, rota, email veya token yoktur.
- Cron endpoint secret olmadan reddedilir.

## Rollback

- Uygulama rollback'i önceki doğrulanmış Vercel deployment'a yapılır.
- Geriye uyumlu additive migration tercih edilir; destructive schema rollback otomatik varsayılmaz.
- Veri invariantı riskindeyse `competitive_claims_enabled=false` ile map read-only tutulur.
- Owner/score elle toplu değiştirilmez; reconciliation veya auditable compensation kullanılır.
- Secret ihlalinde Vercel, Supabase ve Cloudflare secretleri rotate edilir; client bundle yeniden taranır.

## Kabul

[PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) içindeki bütün ilgili maddeler kanıtla tamamlanmadan production ortak dünya ilan edilmez. Veritabanı kabulinin geçmesi Vercel/Cloudflare dağıtımı, gerçek cihaz, yük, restore ve operasyon kapılarını otomatik olarak geçirmez. Ayrıntılı ağ ve data modeli [production-architecture.md](./production-architecture.md) içindedir.
