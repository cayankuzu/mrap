# mrap tehdit modeli

## Kapsam

Bu model browser/PWA, Cloudflare edge, Vercel BFF, Supabase Auth/Postgres/PostGIS,
Storage ve private Realtime akışını kapsar. Mobil/web istemci tamamen untrusted,
PostgreSQL authoritative kabul edilir.

## Korunan varlıklar

- Güncel territory owner/paint ve region versionları.
- Player score/leaderboard bütünlüğü.
- Raw GPS ve aktif rota gizliliği.
- Auth session, service-role secret ve kullanıcı hesabı.
- Claim/audit/risk geçmişinin bütünlüğü.
- Realtime topic yetkisi ve event sırası.
- Uygulamanın claim geometry yükü altında kullanılabilirliği.

## Güven sınırları

```text
Untrusted browser
  -> Cloudflare TLS/WAF/rate limit
  -> Vercel same-origin BFF + JWT/schema validation
  -> service-role/direct pooled SQL boundary
  -> Postgres RLS + constraints + claim transaction
  -> private outbox publisher
  -> untrusted browser reducer
```

Anon/publishable key secret değildir. Service-role key, direct database secret
ve Realtime publisher yetkisi client bundle/source map/public env/log içine
giremez.

## Tehditler ve kontroller

| Tehdit | Saldırı | Birincil kontroller | Kalan risk |
| --- | --- | --- | --- |
| Kimlik sahteciliği | Başkasının session/candidate ID'si | JWT user BFF'de çıkarılır; composite FK; RPC yeniden eşler; RLS; risk event | Ele geçirilmiş hesap |
| GPS sahteciliği | Teleport, fake provider, replay | Lease, nonce, sequence, payload hash, hız/accuracy/gap/risk; production simulation reddi | Web GPS yüzde yüz kanıtlanamaz |
| Ownership tampering | owner/score/cell listesi gönderme | Bu alanlar RPC parametresi değildir; client core write grantı yok; PK/FK/check | Service-role ele geçirilmesi |
| Replay | Aynı claim/batch tekrar | User+operation+idempotency unique; batch range/hash unique; önceki result | Çok uzun key retention maliyeti |
| Yarış | Eşzamanlı overlap | World/region/cell locks; current-state reload; atomic score/event/outbox | Global lock yoğunluk darboğazı |
| Realtime spoof | Client map patch gönderir | Private channel RLS; authenticated INSERT policy yok; outbox service-only | Publisher secret ihlali |
| Event reorder/loss | Eski patch state'i geri alır | Region version, event ID dedupe, gap=>snapshot | Snapshot endpoint aşırı yükü |
| GPS disclosure | Topic/log/feed üzerinden rota | Self-only raw table; payload allow-list; retention; public route kırpma | Kullanıcının kendi paylaşımı |
| Geometry DoS | Dev polygon/vertex/bbox | Server reconstruction, npoints/area/cell/payload limit, materialized cells, rate/WAF | PostGIS worst-case işlem maliyeti |
| SQL/XSS injection | Color/string/payload | Parametreli SQL, allow-list color/enum/regex, fixed search_path, no dynamic SQL | Sunum katmanı escaping hatası |
| Yetki yükseltme | RPC/public tablo çağrısı | `app_private`, EXECUTE yalnız service_role; direct mutation revoke+RLS | Yanlış dashboard grantı |
| Veri silme/inkâr | Event history update/delete | Client grant yok; audit/compensating event; backup/PITR | Yetkili admin kötüye kullanımı |
| Storage sızıntısı | Foto URL tahmini/EXIF | Private bucket, owner path, signed URL BFF, EXIF strip kapısı | Signed URL paylaşımı |
| Subscription abuse | Binlerce region topic | Viewport limit, debounce, edge/user/session limiter, RLS | Dağıtık hesap botneti |

## Security-definer denetimi

Yeni fonksiyonlar:

- `set search_path=''` kullanır,
- nesneleri schema-qualified çağırır,
- dynamic SQL içermez,
- `public`, `anon`, `authenticated` EXECUTE yetkisini açıkça revoke eder,
- yalnız `service_role` grantı alır,
- polygon/cell/owner/score/client timestamp kabul etmez.

`app_private` API schema listesine eklenmez. Trusted server mümkünse pooled direct
SQL ile çağırır. PostgREST üzerinden açılması gerekirse yalnız server secret ile
ve schema allow-listi ayrı security review sonrası yapılır.

## Gizlilik sınıflandırması

| Veri | Sınıf | Erişim | Retention |
| --- | --- | --- | --- |
| Raw point batch | Çok hassas | sahibi + trusted backend | config, varsayılan 30 gün |
| Aktif rota/session | Hassas | sahibi + trusted backend | lease/session yaşamı |
| Claim polygon/history | Hassas | sahibi + trusted backend | audit/policy |
| Current territory cell | Oyun public'i | authenticated dünya oyuncusu | current state |
| Risk evidence | Güvenlik gizli | service/admin | güvenlik policy'si |
| Notification | Özel | recipient | ürün retentionı |

## Kabul edilmeyen iddialar

- GPS spoofing tamamen engellendi denmez.
- Cloudflare source of truth değildir.
- Realtime mesajı ownership kanıtı değildir.
- UI butonu disable etmek güvenlik kontrolü değildir.
- RLS service-role hatasını telafi etmez; secret yönetimi ayrıca zorunludur.

## Doğrulama kapıları

RLS saldırı testleri, service-role bundle taraması, migration lint/reset,
concurrency/fuzz testleri, dead-letter alarmı, score reconciliation ve dependency
security scan production öncesi zorunludur. Ayrıntılar `TEST_MATRIX.md` ve
`PRODUCTION_CHECKLIST.md` içindedir.

