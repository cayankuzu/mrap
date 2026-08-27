# mrap Cloudflare baseline

Tarih: 27 Ağustos 2026

## Mevcut mimari

| Alan | Gözlenen durum |
| --- | --- |
| Web | Next.js 16.3.3 App Router, React 19.2, TypeScript, npm |
| Dağıtım | Vercel hedefleniyor; `vercel.json` yalnız ham konum saklama temizliği için zamanlanmış istek tanımlıyor |
| Alan adı | Repository'de doğrulanmış özel alan adı veya Vercel domain inspection sonucu yok |
| API | Same-origin Next.js Route Handler'ları |
| Kimlik | HttpOnly oturum çerezi ve yerel SQLite hesap deposu |
| Ortak veri | Yerel SQLite çalışıyor; Vercel için Supabase/PostGIS runtime adapterı henüz tamamlanmış değil |
| Realtime | Yerel authoritative store üzerinden bölge bazlı SSE/polling; hosted fan-out değil |
| Medya | Sunucuda MIME, magic-byte, boyut ve görsel boyutu doğrulanan veri; EXIF yeniden kodlama ile temizleniyor |
| Güvenlik | Origin/Sec-Fetch kontrolü, persistent rate limit, boyutlu JSON okuma, CSP ve temel security header'lar var |
| Bot koruması | Bu çalışma öncesinde CAPTCHA/Turnstile yoktu |
| PWA | Manifest var; service worker veya offline claim yok |
| Analitik | Gizlilik denetimli uygulama olay modeli var; production sağlayıcısı bağlı değil |
| Cloudflare | Zone, DNS kaydı, proxy, WAF veya Turnstile widget'ının hesapta varlığı doğrulanmadı |
| R2 | Kullanılmıyor ve bu turda eklenmedi |

## Cloudflare öncesi ağ durumu

Repository bir özel alan adını veya DNS hedefini kanıtlamıyor. Bu nedenle A/CNAME değeri tahmin edilmedi. Hedef topoloji:

```text
Tarayıcı → Cloudflare yetkili DNS → Vercel Edge → mrap Next.js BFF → Supabase/PostGIS
```

Vercel'e giden web kaydı için Cloudflare proxy varsayılan olarak **DNS Only** kalır. Turnstile, web trafiğinin Cloudflare proxy'sinden geçmesini gerektirmez.

## Bulunan riskler

1. Özel alan adı ve gerçek Vercel DNS hedefi bilinmediği için hesap tarafı entegrasyonu tamamlanmış sayılamaz.
2. Supabase/PostGIS runtime adapterı olmadan Vercel ortak oyun dünyası yayına açılamaz; Cloudflare bu veri katmanının yerine geçmez.
3. Turnstile anahtarları tanımlanmadan bot challenge devreye girmez. Kısmi anahtar seti ise fail-closed yapılandırma hatası verir.
4. CSP, Next.js statik üretimini korumak için halen `unsafe-inline` kullanıyor. Turnstile için wildcard veya `unsafe-eval` production izni eklenmedi; nonce/hash CSP ayrı bir sertleştirme işidir.
5. `MRAP_TRUST_PROXY_HEADERS=0` güvenli varsayılandır. DNS-only topolojide `CF-Connecting-IP` güvenilir uygulama sinyali değildir.
6. Cloudflare WAF/rate limit, DNS-only Vercel trafiğini korumaz. Uygulama rate limit'i bu nedenle korunmuştur.
7. Cloudflare API tokenı veya zone kimliği runtime uygulaması için gerekli değildir; bunlar istemci paketine girmemelidir.

## Bu turdaki kod değişiklikleri

- Kısmi ortam yapılandırmasını reddeden typed Turnstile config'i.
- Tokenı Cloudflare Siteverify ile trusted server'da doğrulayan adapter.
- Action, hostname, challenge yaşı, tek kullanım/hata ve ağ kesintisi kontrolleri.
- Kayıt ve ilk şifre yenileme isteğinde reusable responsive challenge.
- Tokenın storage, URL, analytics veya loglara yazılmaması.
- Turnstile'a dar CSP izinleri; API için `private, no-store`; CORP ve production HTTPS yükseltmesi.
- Unit/integration ve statik istemci-secret sınır testleri.

Hesap ve DNS tarafındaki adımlar [MANUAL_SETUP.md](./MANUAL_SETUP.md) içinde `MANUAL REQUIRED` olarak ayrı tutulur.

