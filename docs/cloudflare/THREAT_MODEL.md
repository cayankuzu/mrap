# mrap Cloudflare tehdit modeli

## Varlıklar ve güven sınırları

- Hesap/oturum, sosyal graph, gönderi ve medya.
- GPS rotası, claim adayı, territory ownership ve paint.
- Vercel deployment, Cloudflare DNS/Turnstile ve gelecekte Supabase/PostGIS.
- Server-only Turnstile secret, Supabase secret, database URL ve altyapı API tokenları.

Cloudflare DNS ve Turnstile ownership kaynağı değildir. Vercel BFF istemci mutation'ını doğrular; production veri kaynağı tamamlandığında Supabase/PostGIS tek authoritative dünya olur.

## Tehditler ve kontroller

| Tehdit | Etki | Mevcut/planlanan kontrol | Kalan risk |
| --- | --- | --- | --- |
| DNS takeover | Trafik/oturum ele geçirme | Minimum yetkili DNS tokenı, zone kayıt envanteri, hesap MFA, stale CNAME denetimi | Hesap tarafı henüz doğrulanmadı |
| Yanlış proxy | Çift cache, latency, IP sinyali kaybı | Vercel web kaydı DNS Only | Dashboard manuel doğrulama gerekli |
| Turnstile bypass | Bot hesap/şifre reset spam'i | Server Siteverify, action, hostname, zaman, token uzunluğu, fail-closed | Widget/secret henüz hesapta kurulmadı |
| Turnstile secret hırsızlığı | Sahte doğrulama | Server-only env, istemci kaynak testi, loglamama, rotation | Vercel secret scope manuel |
| Token replay | Tek tokenla çok mutation | Cloudflare tek kullanım, Siteverify her mutation'da, duplicate reddi | Ağ belirsizliğinde kullanıcı yeni challenge alır |
| Siteverify kesintisi | Auth abuse veya kullanılabilirlik | Enforced durumda mutation 503 ile fail-closed | Cloudflare'a operasyon bağımlılık |
| Bot hesap oluşturma | Spam/sybill | Turnstile + IP endpoint rate limit + benzersiz email/kullanıcı adı | E-posta doğrulama ayrı risk olarak açık |
| Brute-force login | Hesap ele geçirme | Server rate limit, genel hata, risk-temelli Turnstile sonraki aşama | Dağıtık saldırı için durable/edge limiter gerekli |
| Rate-limit bypass | Kaynak tüketimi | Persistent app limiter, proxy header'a varsayılan güvensizlik | Serverless shared limiter production adapterı gerekli |
| XSS | Oturum/veri sızması | React escaping, CSP, object/frame/base/form sınırları | `unsafe-inline` CSP sertleştirme riski açık |
| CSRF | Yetkisiz mutation | Same-origin `Origin` + `Sec-Fetch-Site`, SameSite HttpOnly cookie | Eski istemci uyumluluğu E2E ile izlenmeli |
| Session theft | Hesap ele geçirme | HttpOnly/SameSite/secure production cookie, expiry, logout cleanup | CSP ve cihaz/session yönetimi geliştirilebilir |
| Replay claim | Haksız ownership | Idempotency, server session/state machine, authoritative geometri | Production transaction adapterı doğrulanmadı |
| Cache poisoning | Başkasının verisini görme | DNS Only tek CDN, API private no-store, origin kontrolü | Dashboard'da Cache Everything yasaklanmalı |
| Hassas cevap cache'i | PII/oturum sızması | Auth/mutation/realtime no-store | Header smoke production'da tekrarlanmalı |
| CORS hatası | Cross-origin veri erişimi | Same-origin API; wildcard CORS yok | Gelecekte media/upload hostu ayrı inceleme ister |
| Origin bypass | Edge kontrolünü atlama | DNS-only modelde WAF iddiası yok; Vercel origin kaynak | Proxy istisnasında origin lockdown zorunlu |
| Cloudflare API token sızması | DNS/zone ele geçirme | Runtime'dan ayrı, minimum permission token, secret scan | Hesap tokenı oluşturulmadı/doğrulanmadı |
| R2 public bucket | Özel medya sızması | R2 kullanılmıyor | Eklenirse private/public sınıf, signed URL ve dar CORS zorunlu |
| Presigned URL hırsızlığı | Yetkisiz upload/read | R2 kullanılmıyor | Gelecekte kısa TTL, method/key/content-type sınırı |
| Zararlı upload | XSS/bomb/kaynak tüketimi | MIME + magic bytes + boyut + dimension kontrolü, yeniden kodlama | Production object storage adapterı kabul testi gerekli |
| EXIF GPS sızması | Fiziksel konum ifşası | Yeniden kodlama/metadata temizleme; kesin GPS başkalarına gösterilmez | Harici storage pipeline yeniden test edilmeli |
| Production'da developer kontrolü | Sahte GPS/claim | Production build kontrolü kapalı, server simulated GPS reddi | Bundle smoke kapısı korunmalı |

## R2 kararı

Bu turda R2 eklenmedi. Mevcut medya doğrulaması ve hedef Supabase Storage mimarisi varken ikinci storage vendor'ı eklemek MVP'ye gereksiz kimlik bilgisi, CORS ve veri taşıma riski katacaktı. R2 gelecekte ayrı performans/maliyet ve gizlilik kararıyla açılabilir.

