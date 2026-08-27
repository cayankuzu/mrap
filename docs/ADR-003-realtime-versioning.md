# ADR-003: Region versioning ve transactional Realtime outbox

- Durum: Kabul edildi
- Tarih: 2026-08-27

## Bağlam

WebSocket mesajları kaybolabilir, iki kez gelebilir, ters sıraya düşebilir veya
API cevabından önce ulaşabilir. Broadcast, ownership kanıtı olamaz.

## Karar

Database source of truth'tur. Her `world_region.version` yalnız claim
transactionında monoton artar. Aynı transaction bir immutable claim event,
cell changes ve `realtime_outbox` satırlarını üretir.

Private topicler:

```text
world:{worldId}:region:{regionId}
user:{userId}:private
```

Authenticated client yalnız var olan aktif region topiclerini ve kendi user
topicini okuyabilir. Client send policy'si yoktur. `service_role` dışındaki
roller outbox'a yazamaz. Outbox publisher `FOR UPDATE SKIP LOCKED` ile batch alır,
`realtime.send(..., private := true)` çağırır ve başarılı satırı published yapar.
Başarısız satır exponential backoff ile kalır; onuncu hatada dead-letter olur.

Patch:

```text
eventId, claimEventId, worldId, regionId,
previousVersion, version, changedCells | requiresRefetch,
committedAtServer
```

Patch hücre sınırını geçerse payload'a binlerce hücre konmaz;
`requiresRefetch=true` gönderilir. Payload raw GPS, rota, email, IP, token,
device fingerprint veya risk detayı içermez.

## Client uzlaşma protokolü

1. Private region channelına subscribe ol ve eventleri bufferla.
2. Region snapshot+version fetch et.
3. Snapshotı uygula.
4. `version > snapshot.version` buffer eventlerini sırala.
5. Tam ardışık eventleri uygula.
6. Duplicate/eski eventi yoksay.
7. Gap görülürse regionı desynced yap ve snapshot refetch et.

API cevabı ile Broadcast `claimEventId`/`eventId` üzerinden dedupe edilir.
Realtime mesajı tek başına confirmed state yaratmaz.

## Sonuçlar

- Database commit olup yayın başarısız olsa da veri kaybolmaz.
- Reconnect ve out-of-order olayları snapshot ile iyileşir.
- Viewport yalnız ilgili regionlara subscribe olur; global topic yoktur.
- Client `lastAppliedVersion` saklamak ve gap durumunda tahmin etmemek zorundadır.

## Reddedilen seçenekler

- Transaction içinden fire-and-forget WebSocket: commit/broadcast ayrışır.
- Global dünya channelı: gizlilik ve ölçek sorunu.
- Postgres Changes ile raw tablo yayını: payload kontrolü ve gizlilik zayıf.
- Version olmadan patch uygulamak: sıra kaybı state'i sessizce bozar.

