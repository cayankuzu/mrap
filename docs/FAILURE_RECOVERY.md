# mrap hata ve kurtarma runbooku

## Temel ilke

PostgreSQL commit'i authoritative sınırdır. Client preview, pending command,
Realtime mesajı veya HTTP success tek başına sahiplik kanıtı değildir.

## Hata matrisi

| Hata | Database | Client davranışı | Operasyon |
| --- | --- | --- | --- |
| Validation reddi | Command terminal reject; ownership değişmez | Türkçe hata, retry yalnız düzeltilebilir girişte | Risk/audit kodunu izle |
| Deadlock/serialization | Transaction tamamen rollback | Aynı key ile bounded retry; pending UI | Retry/lock wait metriği |
| Server mutation ortasında çöker | Transaction rollback | Timeout sonrası idempotency status | Crash/correlation log |
| Commit oldu, HTTP cevabı kayıp | State+event+outbox doğru | Aynı key sonucu döndürür; ikinci claim yok | Yoksa status endpoint alarmı |
| Commit oldu, Broadcast başarısız | Outbox pending/dead-letter | Version gap/snapshot ile doğru state | Publisher retry, dead-letter alarm |
| Duplicate Broadcast | Database etkilenmez | `eventId`/version yoksay | Duplicate metriği |
| Ters sıra/gap | Database etkilenmez | Region DESYNCED, snapshot refetch | Gap/lag alarmı |
| Client offline | ACK'i belirsiz online batch idempotent kalır; offline GPS competitive state'i ilerletmez | Bounded+TTL kişisel taslak, reconnect'te ACK replay → server online-segment boundary → snapshot | Connection/replay/segment metriği |
| Score drift | Cells doğru kabul edilir | Snapshot sonrası skor düzeltme | Reconciliation+audit+alarm |
| Corrupt/invalid geometry | Command reject | Preview kaldır, açık mesaj | Candidate producer inceleme |
| Storage/medya kaybı | Ownership etkilenmez | Güvenli boş görsel | Object lifecycle/backup |

## Claim retry algoritması

Trusted server yalnız SQLSTATE `40001` ve `40P01` için retry yapar:

```text
attempt 1..4
delay = random(0, min(500 ms, 40 ms * 2^(attempt-1)))
same user/session/candidate/idempotencyKey/payloadHash
```

Business rejection otomatik retry edilmez. Dördüncü transient hata sonrasında
kullanıcıya bölgenin yoğun olduğu söylenir; pending görünüm confirmed olmaz.

## Outbox kurtarma

- Publisher en fazla 500 satır batch alır ve `SKIP LOCKED` kullanır.
- Hata exponential backoff ile `pending` kalır.
- 10 deneme sonunda `dead_letter` alarm üretir.
- Dead-letter yeniden denenecekse operator önce hata sebebini giderir, satırı
  audit ile `pending`, `available_at=now()` yapar.
- Re-publish duplicate olabilir; client dedupe zorunludur.
- Outboxı silerek iyileştirme yapılmaz.

Kontrol sorgusu:

```sql
select status, count(*), min(created_at), max(attempts)
from public.realtime_outbox
group by status;
```

## Client resync

Region gap, reconnect veya map hash farkında:

1. region patch uygulaması durur,
2. UI küçük `Harita güncel durumla eşitleniyor` durumu gösterir,
3. private subscription açık/buffered tutulur,
4. authoritative snapshot alınır,
5. snapshot sonrası daha yeni ardışık buffer uygulanır,
6. iki başarısız denemede exponential network retry yapılır.

Pending claim local confirmed alana birleştirilmez. Komut committed ise snapshot
zaten son ownerı gösterecektir.

Aktif rotada reconnect sırası daha katıdır:

1. Yalnız bağlantı kopmadan önce online gözlenmiş fakat ACK'i belirsiz point batch'leri aynı sequence ile replay edilir.
2. Cihazdaki `offline_draft` noktaları point API'ye gönderilmez.
3. Taslak varsa nonce/owner doğrulamalı ve expected-index idempotent `resume_online` komutu sunucuda segment indeksini artırır.
4. Bundan sonraki ilk online GPS örneği yeni segment anchor'ıdır; offline hareketi bağlayan çizgi claim geometrisine giremez.
5. Region snapshot/realtime uzlaşması bundan sonra yapılır.

## Score reconciliation

Scheduled job world/partition bazında:

1. owner başına `SUM(territory_cells.area_m2)` ve count hesaplar,
2. `player_scores` ile karşılaştırır,
3. 0,01 m² üzeri farkı tek transactionda düzeltir,
4. `score.reconciled` audit event ve metric üretir,
5. hücre ownerlarını skora göre asla değiştirmez.

Negative score constraint nedeniyle yazılamaz. Drift sürekli aynı regionda
tekrarlanıyorsa claim pipeline durdurulup incident açılır.

## Hileli event için compensating rollback

Immutable claim hard-delete/update edilmez. Yeni compensation command/event:

- hedef eventin cell changes geçmişini okur,
- cell'in `last_claim_event_id` hâlâ hedef event ise düzeltir,
- daha sonraki legitimate owner/paint'i korur,
- aynı sorted region/cell lock sırasını kullanır,
- region/world version, scores, notifications ve outboxı atomik artırır,
- admin ID, sebep, before/after state audit eder.

Toplu SQL ile owner alanı sessizce değiştirmek yasaktır.

## Backup ve felaket kurtarma

- Supabase PITR/backup production kapısından önce etkinleştirilir.
- Migration ve restore staging'de düzenli denenir.
- RPO/RTO ürün kararıyla belgelenir; varsayılan kabul yapılmaz.
- Restore sonrası cell uniqueness, region monotonicity, score reconciliation ve
  outbox watermark doğrulanır.
- Service-role ve database secret incidentte rotate edilir; client deployunda
  secret bulunmadığı bundle scan ile tekrar kanıtlanır.

## Incident öncelikleri

- P0: çift owner görüntüsü, service secret sızıntısı, başka kullanıcı GPS erişimi.
- P1: score drift, claim transaction hatası, private topic bypass.
- P2: outbox gecikmesi/version gap artışı, dead-letter.
- P3: tek candidate geometry/risk false positive.

P0/P1'de production claims kapatılır (`competitive_claims_enabled=false`), map
read-only kalır; veri sebebi anlaşılmadan manuel mutation yapılmaz.
