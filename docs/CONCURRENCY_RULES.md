# mrap concurrency kuralları

Bu belge claim/paint işlemlerinin yarış durumlarında tek bir sonuca nasıl
ulaştığını tanımlar. Uygulama kodu, SQL migration ve testler bu sözleşmeye uyar.

## Değiştirilemez kurallar

1. Aktif rota hiçbir hücreyi rezerve etmez.
2. Başlangıç veya client submit zamanı öncelik vermez.
3. Kazananı yalnız authoritative database transaction sırası belirler.
4. Aynı `(world_id, cell_id)` kaydında yalnız bir owner olabilir.
5. Claim lock alındıktan sonraki current state üzerinde uygulanır.
6. Aynı command ikinci ownership/score/event üretemez.
7. Owner, paint, scores, event, notifications ve outbox atomiktir.
8. Paint yalnız o anda owner olan kullanıcıya uygulanır.
9. Açık rota ownership transactionına giremez.
10. Realtime sırası database commit sırasının yerine geçmez.

## Kilit hiyerarşisi

Her kod yolu aşağıdaki sıraya uyar:

```text
claim_commands idempotency row
-> worlds (world_id)
-> route_sessions (session_id)
-> loop_candidates (candidate_id)
-> world_regions (UUID artan)
-> territory_cells (region_id, cell_id artan)
```

Birden çok world aynı işlemde değiştirilemez. Birden çok region tek transaction
içinde artan ID sırasıyla kilitlenir. Başka bir servis ters sırada lock alamaz.

MVP global world lock kullanır. Bu, farklı region claimlerini de sıraya koyar;
doğruluğu basitleştirir. Region partition/load metrikleri doğrulandıktan sonra
global lock kaldırılabilir. O geçişte sorted region/cell lock ve region version
kuralı değişmez.

## Çakışma matrisi

| Önce commit | Sonra commit | Ortak hücre son durumu |
| --- | --- | --- |
| X claim | Y claim | owner Y, Y'nin claim rengi |
| Y claim | X claim | owner X, X'in claim rengi |
| X repaint | Y capture | owner Y, Y'nin rengi |
| Y capture | X repaint | X artık owner değilse repaint uygulanmaz |
| X claim | X aynı claim retry | tek event, aynı sonuç |
| X aynı hücre/same color | X no-op repaint | version/event/score/outbox yok |

Üç veya daha fazla claim aynı kuralla seri uygulanır; en son başarılı commit
ortak hücrenin ownerıdır.

## Transaction ön koşulları

Trusted server yalnız şu command alanlarını iletir:

```text
authoritative JWT user ID
server-issued session ID
server-generated candidate ID
last accepted point sequence
allow-listed color ID
idempotency key
canonical payload hash
correlation ID
```

Polygon, cell listesi, owner, score, area, region version veya client timestamp
RPC parametresi değildir. Candidate'ın server-generated geometry ve cell seti
transaction içinde yeniden doğrulanır.

## Idempotency

Unique anahtar:

```text
(user_id, operation_type, idempotency_key)
```

- Aynı hash: mevcut `result_payload` döner.
- İlk işlem sürüyorsa: mevcut status döner; ikinci mutation oluşmaz.
- Farklı hash/session/candidate/color: request reddedilir, audit+risk yazılır.
- Timeout retry: aynı key zorunludur.
- Candidate aynı anda iki ayrı committed command olamaz.

## Versionlar

- `worlds.current_version`: MVP global commit sırası.
- `world_regions.version`: region patch/snapshot uzlaşma sırası.
- `ownership_version`: hücrenin son owner değişim region versionı.
- `paint_version`: hücrenin son paint değişim region versionı.
- `player_scores.score_version`: skorun uzlaştırıldığı world version.

Region version yalnız anlamlı cell mutationında artar. Tam self-owned/same-color
no-op version artırmaz.

## Retry politikası

Deadlock/serialization failure için trusted service:

```text
max 4 deneme
base 40 ms exponential backoff
tam jitter
aynı idempotency key ve payload hash
```

Validation, stale session, restricted region, rate limit veya risk reddi otomatik
transaction retry değildir. Network timeout status/idempotency sorgusuyla
uzlaştırılır.

## İnvariant sorguları

```sql
-- Composite PK nedeniyle sonuç her zaman sıfır olmalıdır.
select world_id, cell_id, count(*)
from public.territory_cells
group by world_id, cell_id
having count(*) > 1;

-- Score drift denetimi.
select s.world_id, s.user_id, s.current_territory_area_m2,
       coalesce(sum(c.area_m2), 0) as authoritative_area_m2
from public.player_scores s
left join public.territory_cells c
  on c.world_id = s.world_id and c.owner_id = s.user_id
group by s.world_id, s.user_id, s.current_territory_area_m2
having abs(s.current_territory_area_m2 - coalesce(sum(c.area_m2), 0)) > 0.01;
```

