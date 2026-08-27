# ADR-001: Authoritative sahiplik için deterministik hücre grid'i

- Durum: Kabul edildi
- Tarih: 2026-08-27
- Karar sahipleri: mrap oyun/backend ekibi

## Bağlam

Serbest biçimli polygonları sürekli `UNION`/`DIFFERENCE` ile güncel sahiplik
kaynağı yapmak; sliver geometry, üst üste owner, pahalı kilitler ve kayan skor
üretir. İstemcinin hesapladığı polygon veya hücre listesine güvenmek de hileye
açıktır.

## Karar

mrap'te sahipliğin tek kaynağı `public.territory_cells` tablosudur.
`PRIMARY KEY (world_id, cell_id)` aynı canonical yüzeyin aynı dünyada yalnız bir
kaydının bulunmasını garanti eder. Bir hücrenin tek `owner_id` ve tek güncel
`paint_color_id` değeri vardır.

Grid sağlayıcısı değiştirilebilir. Database H3/S2 extension'ı varsaymaz. Her
`worlds` kaydı `grid_scheme`, `grid_resolution` ve
`grid_definition_version` taşır. Trusted grid adapter şu verileri önceden
materialize eder:

- deterministik `cell_id`,
- hücre polygonu,
- polygon içinde merkez noktası,
- metre kare alanı,
- tek bir `world_region` üyeliği.

Bir claim polygonuna dahil olma kuralı grid adapter sürümünde sabittir: hücre
merkezi normalize edilmiş server polygonu tarafından kapsanıyorsa hücre
hedeftir. İstemciden gelen cell listesi kabul edilmez. `loop_candidates` içindeki
liste yalnız trusted route/geometry pipeline tarafından yazılır ve claim
transactionı bu listeyi materialize edilmiş hücrelerle tekrar eşleştirir.

Ownership ile paint ayrıdır ancak aynı canonical satırda son durum olarak
tutulur:

- owner değişikliği territory skorunu etkiler,
- owner değişmeden paint değişikliği territory skorunu etkilemez,
- owner null olduğunda paint de null olmak zorundadır,
- event geçmişi `claim_events`/`claim_cell_changes` içindedir; harita güncel
  `territory_cells` durumunu render eder.

Ham claim polygonu denetim, sosyal paylaşım ve geometry incelemesi için eventte
saklanır; sahipliğin kanıtı değildir.

## Sonuçlar

Olumlu:

- İki owner invariantı composite primary key ile fiziksel olarak engellenir.
- Unique alan ve skor hücre alanlarının toplamından yeniden üretilebilir.
- Self-overlap ikinci kez puanlanmaz.
- Rakip capture tek satır owner değişimidir.
- Concurrency kilitleri cell/region kimlikleri üzerinde deterministiktir.

Bedeller:

- Grid çözünürlüğü maliyet ve görsel ayrıntı arasında dengelenmelidir.
- Grid sürümü değişimi offline backfill ve kontrollü dünya geçişi ister.
- Uzak zoom için hücreler dissolve/vector tile ile genelleştirilmelidir.
- Bootstrap region production trafiği açılmadan gerçek spatial partitionlara
  ayrılmalıdır.

## Reddedilen seçenekler

- Polygon başına kalıcı ownership layer: çift sahiplik ve geometry drift.
- İstemci Turf sonucunu doğrudan yazmak: authoritative değildir.
- H3 extension'ını zorunlu kılmak: deployment taşınabilirliğini azaltır.
- Raster görseli sahiplik kaynağı yapmak: sorgulanabilir/audit edilebilir değil.

## Korunan invariantlar

```text
COUNT(territory_cells WHERE world_id=W AND cell_id=C) <= 1
score.current_area = SUM(area_m2 WHERE owner_id=user)
owner_id IS NULL => paint_color_id IS NULL
paint-only commit => territory score delta = 0
```

