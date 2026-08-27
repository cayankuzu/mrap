# mrap sistem mimarisi

Bu belge, çalışan yerel MVP'nin sınırlarını ve hedeflenen ortak dünya mimarisini tek yerde özetler. Ayrıntılı üretim tasarımı için [production-architecture.md](./production-architecture.md), karar gerekçeleri için [ADR-001](./ADR-001-authoritative-ownership-grid.md), [ADR-002](./ADR-002-concurrency-resolution.md), [ADR-003](./ADR-003-realtime-versioning.md) ve [ADR-004](./ADR-004-location-privacy.md) esas alınır.

## Bugünkü doğrulanmış durum

- Uygulama Next.js App Router, React ve TypeScript ile çalışan responsive bir web uygulamasıdır.
- Harita MapLibre GL JS, OpenFreeMap stili ve OpenStreetMap verisi kullanır. Geometri önizlemelerinde Turf kullanılır.
- Yerel kimlik, sosyal içerik ve oyun verisi `MRAP_DATA_PROVIDER=sqlite` üzerinden `data/mrap.sqlite` içinde tutulur.
- Sunucu-otoriteli oyun akışı session, sıralı konum batch'i, sunucu tarafından üretilen loop candidate, idempotent claim ve sürümlü region snapshot/patch modelini kullanır.
- Supabase/PostGIS migrationları `supabase/migrations/202608260001`–`202608260011` altında hazırdır; ancak çalışan Next.js Supabase data adapter'ı yoktur.
- SQLite Vercel üzerinde bilinçli olarak reddedilir. Bu nedenle mevcut kod, secret ve harici servis kurulumu yapılmadan ortak production dünyası olarak yayımlanamaz.

Bu kalite turunda Docker kullanılmadı. Postgres/PostGIS migration entegrasyonu bu turda yeniden çalıştırılmış bir kabul kanıtı değildir.

## Katmanlar

```text
Tarayıcı
  ├─ App Router ekranları ve erişilebilir uygulama kabuğu
  ├─ MapLibre renderer
  ├─ RealLocationProvider | SimulatedLocationProvider
  ├─ GameMap UI + authoritative istemci state machine
  └─ Region reconciler: snapshot, patch, dedupe, gap/refetch
          │ aynı-origin HTTP/SSE
          ▼
Next.js BFF/API
  ├─ session cookie ve route authorization
  ├─ origin, body-size, schema ve rate-limit kontrolleri
  ├─ authoritative game service
  └─ safe audit/risk/metric kayıtları
          │
          ▼
Data provider
  ├─ Bugün: yerel SQLite
  └─ Hedef: Supabase Auth + PostgreSQL/PostGIS + RLS + private Realtime
```

Hedef ağ sınırı `Tarayıcı → Cloudflare → Vercel → Supabase` şeklindedir. Cloudflare TLS/WAF/CDN ve edge abuse kontrolü sağlar; ownership kaynağı değildir. Vercel doğrulama ve BFF katmanıdır. PostgreSQL/PostGIS tek authoritative ortak dünya olmalıdır.

## Temel domain sınırları

- `LocationProvider`: gerçek GPS ile simülasyonu aynı arayüz arkasında tutar.
- `LoopDetector`: UI'dan bağımsız proximity, minimum rota ve minimum alan kurallarını uygular.
- `AuthoritativeGameStateMachine`: istemci ekran durumlarını açık geçişlerle sınırlar.
- `AuthoritativeGameStore`: kimlik, session lease/nonce, sequence, candidate, claim, ownership, paint, score, event ve region version kararlarını verir.
- `RegionReconciler`: duplicate ve eski eventleri yok sayar; version gap durumunda authoritative snapshot ister.
- Repository/data katmanı: yerel MVP sosyal verisini SQLite'tan sunar. Production adapter ile değiştirilecek sınır burasıdır.

UI polygon, owner, score veya claim sonucunun son kararını vermez. İstemci geometriyi yalnız kullanıcı önizlemesi için hesaplayabilir.

## Değiştirilemez invariantlar

```text
Bir world/cell aynı anda en fazla bir owner taşır.
Score = benzersiz sahip olunan canonical hücre alanlarının toplamı.
Paint-only işlem territory score'u değiştirmez.
Açık rota ownership oluşturmaz.
Aynı idempotency key aynı payload ile ikinci event/score üretmez.
Realtime event authoritative veri değil, commit edilmiş state bildirimi taşır.
Başka oyuncunun raw GPS'i veya aktif rotası yayımlanmaz.
```

Detaylı oyun kuralları [GAME_CORE.md](./GAME_CORE.md), realtime uzlaşması [REALTIME_PROTOCOL.md](./REALTIME_PROTOCOL.md), concurrency kilit sırası [CONCURRENCY_RULES.md](./CONCURRENCY_RULES.md) içinde bulunur.

## Veri ve lifecycle

1. Kullanıcı açıkça tracking başlatır.
2. Location provider noktaları üretir; istemci küçük, sıralı batch'ler gönderir.
3. Sunucu session/user/nonce/sequence ve hareket riskini doğrular.
4. Sunucu kabul edilen rota segmentinden candidate üretir.
5. Kullanıcı `Alanı Kapat` veya `Devam Et` seçer.
6. Claim transaction current ownership'i kilit altında yeniden okur.
7. Owner, paint, skor, immutable event ve region version birlikte güncellenir.
8. İstemciler patch'i sürüm sırasıyla uygular; kayıp sürümde snapshot alır.
9. Raw konum retention süresi dolduğunda bakım işiyle temizlenir.

## Bilinen mimari borç ve engeller

- Supabase data adapter, Supabase Auth bağlama ve private Realtime publisher tamamlanmamıştır.
- Production media akışında private bucket, signed URL ve EXIF temizleme henüz çalışan adapter ile doğrulanmamıştır.
- Yerel SQLite şeması, geriye uyumlu sosyal/territory tabloları ile yeni authoritative grid modelini birlikte taşır; production adapter yalnız canonical model kullanmalıdır.
- `GameMap.tsx`, `authoritative-store.ts`, `repository.ts` ve global CSS büyüktür; işlevsel sınırlar mevcut olsa da bakım maliyetini azaltacak ölçülü ayrıştırma gerekir.
- Üç tarayıcı motoru E2E, yük testi ve gerçek production observability kanıtı yoktur.

Production geçişi yalnız [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) tamamlandıktan sonra yapılmalıdır.
