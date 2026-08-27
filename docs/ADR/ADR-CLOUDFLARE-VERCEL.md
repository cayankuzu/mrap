# ADR: Cloudflare DNS ile Vercel origin ayrımı

- Durum: Kabul edildi
- Tarih: 27 Ağustos 2026
- Kapsam: mrap production web trafiği

## Bağlam

mrap Next.js uygulaması Vercel'de çalışacak. Cloudflare yetkili DNS ve Turnstile sağlayacak. Doğrulanmış bir özel alan adı, Vercel DNS hedefi veya ayrı Cloudflare origin'i henüz repository kanıtlarında yok.

Vercel'in önüne genel amaçlı Cloudflare reverse proxy eklemek ikinci CDN, iki ayrı cache kararı, ilave ağ adımı ve gerçek trafik sinyallerinin bozulması riskini doğurur. Turnstile ise Cloudflare proxy gerektirmeden çalışır.

## Karar

```text
Kullanıcı
   │ HTTPS
   ▼
Vercel Edge / mrap
   │
   ▼
Supabase/PostGIS (production adapter tamamlandığında)

Cloudflare = yetkili DNS + Turnstile
```

1. Apex ve `www` web kayıtları, Vercel Dashboard'un o anda verdiği hedeflere gider.
2. Bu kayıtların Cloudflare Proxy Status değeri varsayılan olarak **DNS Only** olur.
3. Vercel cache ve TLS ana web teslimatının tek sahibi olarak kalır.
4. `/api/*`, auth, mutation, realtime ve kişiye özel HTML public edge cache'e açılmaz.
5. `CF-Connecting-IP`, DNS-only topolojide uygulama tarafından güvenilmez. Proxy header güveni origin zinciri ayrıca doğrulanmadan açılmaz.
6. Turnstile yalnız kayıt ve ilk şifre yenileme isteğine uygulanır; harita/GPS/claim/feed etkileşimlerine uygulanmaz.

## Orange-cloud istisnası

Gelecekte gerçek bir Cloudflare Worker, R2 medya hostu veya ayrı API origin'i kurulursa proxy ayrı ADR ile değerlendirilir. Kabul için en az şunlar gerekir:

- Full (strict) TLS ve origin kimlik doğrulaması,
- dinamik/auth/realtime cache bypass,
- CORS ve WebSocket/SSE iki istemcili test,
- origin bypass engeli,
- gerçek istemci IP zinciri testi,
- önce/sonra TTFB ve LCP kanıtı,
- proxy kaldırıldığında Vercel fallback'i.

Bu kanıtlar olmadan orange-cloud açılmaz.

## Sonuçlar

- Çift proxy ve çift cache riski azaltılır.
- Cloudflare WAF'in DNS-only kayıtları korumadığı açıkça kabul edilir; uygulama rate limit'i zorunlu kalır.
- Cloudflare hesap kesintisi DNS yönetimini etkileyebilir fakat uygulama runtime'ı Cloudflare API tokenına bağımlı olmaz.
- Domain ve DNS hedefleri tahmin edilmez; Vercel inspection sonucu manuel kurulumda kaynak kabul edilir.

