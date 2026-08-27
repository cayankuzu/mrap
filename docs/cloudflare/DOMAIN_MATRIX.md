# mrap alan adı matrisi

Gerçek özel alan adı ve Vercel'in istediği DNS hedefleri henüz doğrulanmadı. Aşağıdaki satırlar durum ve amaç belirtir; DNS kaydı oluşturulduğu anlamına gelmez.

| Host | Amaç | Origin/provider | CF Proxy | TLS | Cache | Durum |
| --- | --- | --- | --- | --- | --- | --- |
| Doğrulanacak apex production hostu | Production web | Vercel | DNS Only | Vercel HTTPS | Vercel | Planlandı; host ve hedef bilinmiyor |
| Doğrulanacak `www` hostu | Canonical yönlendirme veya web | Vercel | DNS Only | Vercel HTTPS | Vercel | Planlandı; Vercel kararı gerekli |
| Vercel preview hostu | Preview test | Vercel | Uygulanamaz | Vercel HTTPS | Vercel | Platform tarafından üretilir |
| Ayrı API hostu | Gelecekte gerekirse BFF/API | Belirlenmedi | Ayrı ADR | Full (strict) | Public cache yok | Oluşturulmadı |
| Ayrı medya hostu | Gelecekte immutable public medya | Supabase Storage veya ileride değerlendirilecek R2 | Belirlenmedi | HTTPS | Sürümlü varlıkta uzun | Oluşturulmadı |
| Ayrı upload hostu | Gelecekte gerekirse signed upload | Belirlenmedi | Ayrı ADR | Full (strict) | Yok | Oluşturulmadı |

## DNS değişikliği kuralları

- Apex A/ALIAS/CNAME ve `www` CNAME hedefi yalnız Vercel domain inspection ekranından kopyalanır.
- TXT/CNAME domain verification kayıtları DNS Only kalır.
- MX, SPF, DKIM ve DMARC kayıtları değiştirilmez veya silinmez.
- Bilinmeyen kayıt üzerine yazılmaz; önce conflict analizi yapılır.
- Production Turnstile widget'ı yalnız doğrulanmış production hostlarını kabul eder.

