# mrap private Realtime protokolü

## Amaç ve kaynak

Realtime düşük gecikmeli taşıma katmanıdır; source of truth PostgreSQL'deki
`territory_cells` ve `world_regions.version`dır. Broadcast alındı diye preview
confirmed yapılmaz; event yalnız committed transactiondan çıkan outbox kaydıdır.

## Private topicler

```text
world:{worldId}:region:{regionId}
user:{auth.uid}:private
```

- Region topic: authenticated kullanıcı, yalnız database'de var olan aktif
  world/region için receive edebilir.
- User topic: yalnız JWT `auth.uid()` eşleşirse receive edilir.
- Anon receive yoktur.
- Authenticated send policy yoktur.
- Outbox ve publisher yalnız `service_role` erişimindedir.

## Region patch sözleşmesi

```json
{
  "eventId": "uuid",
  "type": "region_patch",
  "worldId": "uuid",
  "regionId": "uuid",
  "previousVersion": 12,
  "version": 13,
  "claimEventId": "uuid",
  "changedCells": [
    { "cellId": "grid:18:...", "ownerId": "uuid", "paintColorId": "#0D8BFF" }
  ],
  "requiresRefetch": false,
  "committedAtServer": "2026-08-27T12:00:00Z"
}
```

`changedCells` ile `requiresRefetch=true` birlikte kullanılmaz. Cell sayısı
config limitini aşarsa liste payloada konmaz. Geometri snapshot endpointinden
alınır; patch raw GPS veya route vertex taşımaz.

## Private user eventleri

- `claim_result`: committed alan özetleri ve final score.
- `territory_lost`: kaybedilen toplam m²; rakibin konumu/rotası yoktur.
- `session_warning`: düşük doğruluk, lease veya risk için genel kod.
- `notification`: in-app bildirim ID/event kodu.

Client mesaj kodunu Türkçe i18n kataloğuna map eder. Database yerelleştirilmiş
cümle saklamaz.

## İlk bağlantı: subscribe-before-snapshot

1. Viewport+buffer için region IDleri hesaplanır.
2. Private channel subscription `SUBSCRIBED` olana kadar beklenir.
3. Eventler region başına bellekte sınırlı buffer'a alınır.
4. Snapshot `{regionId, version, cells}` alınır.
5. Snapshot atomik uygulanır ve `lastAppliedVersion=version` yapılır.
6. Buffer `version,eventId` sırasıyla işlenir.
7. Buffer bırakılır ve live moda geçilir.

Snapshot fetch'i subscriptiondan önce yapmak event kaçırma penceresi oluşturur
ve yasaktır.

## Event uygulama algoritması

```text
event.version <= lastAppliedVersion
  => duplicate/eski; yoksay

event.previousVersion == lastAppliedVersion
ve event.version == lastAppliedVersion + 1
  => patchi tek reducer transactionında uygula

aksi
  => region DESYNCED; patch tahmin etme; snapshot refetch
```

`eventId` ve `claimEventId` LRU dedupe setinde tutulur. API cevabı Broadcastten
önce/sonra gelebilir; aynı claim ikinci kez score/map state'e uygulanmaz.

## Reconnect

1. Token refresh edilir.
2. Eski channel nesneleri kapatılır.
3. Görünür regionlara yeniden subscribe olunur.
4. Her region snapshot version ile doğrulanır.
5. Pending commandlar idempotency/status üzerinden sorgulanır.
6. Preview/pending sadece authoritative sonuçla confirmed olur.

Offline sürede kaç event olduğu tahmin edilmez. Snapshot final state'i getirir.

## Viewport yönetimi

- Yalnız viewport+buffer regionları dinlenir.
- Yeni region subscription ve snapshot tamamlanmadan eskisi hemen bırakılmaz.
- Hızlı pan/zoom churn debounce edilir.
- Maksimum eşzamanlı region sayısı server/client config ile sınırlıdır.
- Uzak zoom hücre patchi yerine generalized snapshot/vector tile kullanır.

## Outbox işletimi

`app_private.publish_realtime_outbox_batch(limit)`:

- `FOR UPDATE SKIP LOCKED` ile aynı satırın iki worker tarafından alınmasını
  önler,
- private `realtime.send` yapar,
- başarıda `published`, hatada backoff uygular,
- 10 başarısızlıktan sonra `dead_letter` bırakır,
- bütün claim outboxları published olunca commandı `BROADCASTED` yapar.

Worker en az bir kez teslim eder; client dedupe zorunludur. Dead-letter alarmı,
region version gap ve snapshot refetch ile veri doğruluğu korunur.

## Payload yasakları

Raw GPS, kesin canlı konum, aktif rota, email, telefon, IP, token, device
fingerprint ve risk evidence asla Realtime payloadına girmez. Schema top-level
yasak anahtarları da reddeder; publisher yalnız allow-list serializer kullanır.

