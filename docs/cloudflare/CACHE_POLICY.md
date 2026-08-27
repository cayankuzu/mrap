# mrap cache politikası

Ana web kayıtları DNS Only olduğu için Cloudflare ana uygulama için ikinci cache katmanı değildir. Aşağıdaki edge TTL, mevcut topolojide Vercel edge anlamına gelir.

| Kategori | Cache? | Browser TTL | Edge TTL | Stale | Invalidation / not |
| --- | --- | --- | --- | --- | --- |
| Hash'li `_next/static` JS/CSS | Evet | Next.js immutable varsayılanı | Vercel immutable | Gerekmez | Yeni build yeni hash üretir |
| Public statik ikon/logo | Kontrollü | Dosya sürümüne göre | Vercel | Kısa stale olabilir | İçerik değişirse sürümlü ad tercih edilir |
| App HTML | Kişiselleştirilmemiş route kararına göre | Next.js kararı | Yalnız Vercel | Next.js kararı | Auth/cookie içeren HTML public cache olmaz |
| Public medya | Gelecekte evet | Sürümlü UUID key'de uzun + immutable | Medya provider kararı | Uygun olabilir | Overwrite yok; yeni object key |
| Authenticated API | Hayır | `private, no-store` | 0 | Yok | Her zaman kaynaktan |
| Mutation API | Hayır | `private, no-store` | 0 | Yok | Her zaman authoritative server |
| Realtime snapshot/SSE | Hayır | `no-store` | 0 | Yok | Event/version uzlaşması |
| Harita tile/style | OpenFreeMap sağlayıcı politikası | Sağlayıcı header'ı | mrap edge cache'ine alınmaz | Sağlayıcı kararı | mrap proxy oluşturmaz |
| Turnstile script/frame | Cloudflare tarafından | Cloudflare header'ı | mrap edge cache'ine alınmaz | Cloudflare kararı | URL rewrite/proxy yok |

## Zorunlu sınırlar

- `/api/*` için genel `Cache-Control: private, no-store` header'ı vardır; route bazlı response da bunu korur.
- `Set-Cookie`, auth, profil gizliliği, bildirim, takip, GPS, claim ve ownership cevapları public cache'e giremez.
- Cloudflare Cache Everything kuralı app hostunda kullanılmaz.
- Query string veya sahte header ile authenticated cevap cache key'ine dönüştürülmez.
- R2 eklenmediği için R2 cache/CORS kuralı oluşturulmaz.

