# mrap teknik due diligence özeti

Tarih: 2026-08-27

## Yönetici özeti

mrap; gerçek dünya hareketini server-authoritative territory ownership, görsel paint ve sosyal paylaşım ile birleştiren responsive web MVP'sidir. Yerel ürün akışı, harita simülasyonu, hesaplar, feed, profil, sıralama ve authoritative claim modeli çalışmaktadır. En güçlü teknik alanlar domain invariantları, idempotency/concurrency yaklaşımı, canlı konum gizliliği ve Supabase/PostGIS için hazırlanmış migration tasarımıdır.

Proje henüz ortak production dünyası değildir. Vercel için Supabase data adapter, hosted Auth/Storage/private Realtime, Cloudflare kuralları, üç-engine E2E, yük testi ve production observability tamamlanmamıştır. Bu ayrım yatırım ve yayın değerlendirmesinde korunmalıdır.

Bu kalite turunda Docker kullanılmadı; PostGIS/RLS migration kabulü bu turda yeniden doğrulanmadı.

## Ürün ve teknik varlıklar

- Next.js/React/TypeScript responsive web uygulaması
- MapLibre/OpenFreeMap harita ve Turf geometri ekosistemi
- Gerçek GPS ve geliştirme simülasyonu için provider sınırı
- Server-issued session/candidate ve idempotent claim API'si
- Canonical tek-owner cell modeli; ownership/paint ayrımı
- Deterministik concurrency, region version, snapshot ve event dedupe modeli
- Raw GPS/aktif rota gizliliği ve bounded retention tasarımı
- 11 sıralı Supabase/PostGIS migrationı
- Threat model, ADR, recovery, realtime ve test matrisi belgeleri
- Yerel SQLite MVP ve gerçek HTTP üzerinden çok oyunculu simülatör

## Doğrulanmış kalite snapshot'ı

| Ölçüm | Sonuç |
| --- | --- |
| Typecheck | Geçti |
| ESLint | Geçti |
| Vitest | 21 dosya, 208/208 test |
| Dependency audit | 0 bilinen açık |
| Test line/branch coverage | %82,01 / %69,90 |
| Landing Lighthouse | Performance 82, LCP 3,98 sn |
| Demo map Lighthouse | Performance 65, LCP 5,05 sn, TBT 651 ms |
| Lighthouse Accessibility | 100 |
| Duplicate code | 10 clone, 146 satır, %1,56 |
| Düzenli screenshot matrisi | 280, 768, 1440 px |
| Client secret pattern | 0 eşleşme |

Bu sonuç 35 kategoride minimum 9.8 release kapısını karşılamaz. Özellikle performance, coverage, E2E/browser matrisi, deployment ve ölçülebilir ölçek kanıtı eksiktir.

## Mimari değer

Authoritative kararın istemciden ayrılması, GPS tabanlı rekabetçi ürünün en önemli teknik riskini doğru yerde ele alır. Client polygon, owner, score veya timestamp göndererek sonuç belirleyemez. Canonical cell primary key çift ownership'i veri modelinde önler. Append-only event ve region version yaklaşımı audit/reconnect için sağlam bir temel oluşturur.

Migrationların varlığı canlı entegrasyon anlamına gelmez. Bugünkü runtime yalnız SQLite adapter kullanır ve Vercel'de fail-fast olur. Bu, sessiz veri kaybını engelleyen doğru davranıştır; aynı zamanda production blockerıdır.

## Başlıca riskler

| Öncelik | Risk | Etki | Azaltma/kapı |
| --- | --- | --- | --- |
| P0 | Hosted authoritative adapter yok | Ortak dünya deploy edilemez | Supabase adapter/Auth/RPC/Realtime E2E |
| P0 | Production RLS/grant kabulü bu turda yok | Yetkisiz veri/mutasyon riski | Staging saldırı matrisi ve migration lint |
| P1 | Harita Performance 65 | Mobil terk ve cihaz ısınması | Bundle/import, main-thread ve map stres optimizasyonu |
| P1 | Branch coverage %69,9 | Edge/race regression | Kritik domain/API branch testleri |
| P1 | Firefox/WebKit E2E yok | Safari/iOS kırılması | Playwright üç-engine ve gerçek cihaz smoke |
| P1 | Load/latency/capacity ölçülmedi | Hot-region darboğazı | Kademeli load test ve SLO dashboardları |
| P1 | Production monitoring yok | Incident geç fark edilir | Metrics, logs, alarms, RUM ve runbook tatbikatı |
| P2 | Büyük modüller ve CSS literal yoğunluğu | Bakım/refactor riski | Ölçülü sınır ayrıştırma ve tokenlaştırma |
| P2 | Lisans metadata anomalileri ve allow/deny/provenance kapısı eksik | Due diligence belirsizliği | Hukuk onaylı lisans politikası; CI CycloneDX SBOM artifaktını release ile sakla |
| Kalıcı | Browser GPS spoofing | Haksız claim | Çoklu risk sinyali, moderasyon; mutlak önleme iddiası yok |

## Ölçek varsayımları

Grid/region partition, viewport subscription, bounded patch, outbox ve snapshot modeli ölçeklenebilirlik yönü sağlar. Fakat kapasite, p95 claim süresi, realtime fan-out, hot-region throughput, memory ve maliyet ölçülmemiştir. Kullanıcı veya claim/saniye kapasitesi hakkında sayısal production iddiası için kanıt yoktur.

## Production yatırım kilometre taşları

1. Supabase adapter/Auth/Storage/private Realtime ve staging RLS kabulü.
2. Cloudflare/Vercel topology, durable rate limit, origin/cache kuralları.
3. Critical E2E: Chromium/Firefox/WebKit, iki-client concurrency ve privacy.
4. Performance budget: landing ≥95, map ≥90, LCP ≤2,5 sn.
5. Coverage: genel line ≥%85, branch ≥%80, core game branch ≥%95.
6. Hot-region load, p95 claim/realtime, memory ve cost model.
7. Production monitoring, backup/restore, incident ve rollback tatbikatı.

## Belge haritası

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [GAME_CORE.md](./GAME_CORE.md)
- [SECURITY.md](./SECURITY.md)
- [PERFORMANCE_BUDGET.md](./PERFORMANCE_BUDGET.md)
- [DEPENDENCY_LICENSES.md](./DEPENDENCY_LICENSES.md)
- [ENVIRONMENT.md](./ENVIRONMENT.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [ERROR_HANDLING.md](./ERROR_HANDLING.md)
- [production-architecture.md](./production-architecture.md)
- [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md)
- [TEST_MATRIX.md](./TEST_MATRIX.md)

## Dürüst karar

Yerel MVP ve authoritative domain temeli teknik olarak anlamlı ve testlidir. Bununla birlikte production shared-world, scale ve 35 kategoride minimum 9.8 iddiası bugün kanıtlanmamıştır. Yatırım değerlendirmesi çalışan MVP ile production-ready platformu ayrı aşamalar olarak ele almalıdır.
