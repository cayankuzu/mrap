# mrap kötüye kullanım önleme

## Çok katmanlı limit

Tek IP limiti veya yalnız UI debounce yeterli değildir. Limitler birlikte
uygulanır:

- Cloudflare: IP/ASN/bot sinyali ve body-size/WAF.
- BFF: authenticated user, endpoint, session ve request schema.
- Database: idempotency, aktif session unique constraint, claim window limiti,
  cell/geometry/batch sınırları.
- Risk engine: hareket ve tekrar davranışını olaylar arasında birleştirir.

Database eşikleri `app_private.game_rules` içindedir; kod içine dağınık magic
number yazılmaz. Edge limitleri environment config olarak aynı runbookta
sürümlenir.

## Session ve route koruması

- Bir user/world için tek aktif competitive session.
- Server nonce ve kısa lease.
- Monoton `last_accepted_sequence`.
- Batch başına ardışık sequence, range unique ve SHA-256 payload hash.
- Aynı range farklı içerik: suspicious/risk.
- Production worldde simulation: hard reject.
- Offline grace sonrası noktalar yalnız saved activity olabilir, claim olamaz.

## Hareket risk sinyalleri

- maksimum hız/ivme,
- teleport ve straight-line jump,
- accuracy limiti ve jitter,
- sequence gap/geri gidiş,
- client/server zaman sapması yalnız risk sinyali olarak,
- iki cihaz/iki coğrafya,
- yürüyüş çevresi ile claim alanı anomalisi,
- çok kısa sürede büyük cell count.

Tek kötü nokta otomatik ban değildir. Noktalar accepted/ignored/suspicious/
rejected sınıflanır. LOW kabul, MEDIUM review işareti, HIGH competitive reject,
CRITICAL session revoke üretir. `risk_events.evidence` clienta veya Realtime'a
çıkmaz.

## Geometry ve kaynak tüketimi

Ucuz kontroller pahalı PostGIS işlemlerinden önce yapılır:

1. HTTP body ve JSON depth/array boyutu,
2. finite koordinat, lat/lng sınırı, supported world,
3. batch/vertex/bbox/aspect/route length,
4. sequence coverage ve accuracy,
5. valid polygon/type/area,
6. canonical cell count,
7. restricted center-point kontrolü,
8. lock+mutation.

Client polygon/cell listesi claim RPC'ye alınmadığı için geometry bomb yüzeyi
daralır. Trusted candidate üreticisi yine maximum points, snap precision,
operation timeout ve antimeridian/polar rejection uygular.

## Spam davranışları

| Davranış | Sonuç |
| --- | --- |
| Claim butonuna seri basma | UI processing lock + idempotency + DB/user rate limit |
| Aynı candidate tekrar | tek committed command; candidate claimed |
| Aynı hücre/same color repaint | gerçek no-op; version/event/score/outbox yok |
| Çok küçük loop | minimum area/route/cell count reddi |
| Dev loop | maximum area/points/cells/body reddi |
| Topic tahmini/churn | private RLS + viewport cap + debounce |
| Bildirim fırtınası | source event unique; aggregation worker/push dedupe |

## Restricted ve fiziksel güvenlik

`restricted_regions` block/ignore/review modlarını taşır. Competitive claim,
aktif `block` geometrisinin merkezini kapsadığı hücrelerden birini içerirse atomik
olarak reddedilir. Tehlikeli alanlar, özel mülk, moderasyon ve etkinlik bölgeleri
aynı altyapıyla yönetilir; admin değişiklikleri audit edilmelidir.

## Moderasyon

Paint uygunsuz şekil oluşturabilir. Report; `claim_event_id`, region ve snapshot
referansı taşır, raw GPS taşımaz. Moderasyon hard-delete yerine mask/compensating
event kullanır. Rollback yalnız kötü eventin hâlâ son etkisi olduğu hücreleri
değiştirir; sonraki legitimate claimi geri alamaz.

## Operasyon metrikleri

Accepted/rejected oranı, risk kodu dağılımı, rate block, claim cell sayısı,
PostGIS süresi, lock wait, retry/deadlock, outbox lag/dead-letter, version gap,
snapshot refetch ve score drift alarm olarak izlenir. Loglar tam rota, secret,
token veya risk evidence içermez; correlation ID taşır.
