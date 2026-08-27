# mrap performans bütçesi

Bu bütçe 2026-08-27 tarihli yerel production build ve Lighthouse baseline'ına dayanır. Ölçüm dosyaları `artifacts/audit/` altındadır. Bu değerler gerçek kullanıcı field data'sı değildir; production RUM ayrıca kurulmalıdır.

## Baseline özeti

| Alan | Mevcut | Hedef | Durum |
| --- | ---: | ---: | --- |
| Landing Lighthouse Performance | 82 | ≥95 | Başarısız |
| Landing LCP | 3,98 sn | ≤2,5 sn | Başarısız |
| Landing TBT | 279 ms | ≤200 ms lab hedefi | Başarısız |
| Landing CLS | 0 | ≤0,1 | Başarılı |
| Demo harita Performance | 65 | ≥90 | Başarısız |
| Demo harita LCP | 5,05 sn | ≤2,5 sn | Başarısız |
| Demo harita TBT | 651 ms | ≤200 ms lab hedefi | Başarısız |
| Demo harita Best Practices | 96 | ≥98 | Başarısız |
| Accessibility | 100 | ≥98 | Baseline başarılı |

Lighthouse JSON: [landing](../artifacts/audit/lighthouse-baseline-prod-landing.json), [harita](../artifacts/audit/lighthouse-baseline-prod-map.json).

## Asset ve route bütçeleri

Rakamlar production `.next` manifestlerindeki referansların level-9 gzip tahminidir. Browser cache paylaşımı gerçek navigasyon transferini azaltabilir. Harici tile cevapları ve MapLibre'ın sonradan istediği runtime medya bu route toplamlarına dahil değildir.

| Bütçe | Baseline | Hedef | Test yöntemi | CI durumu |
| --- | ---: | ---: | --- | --- |
| Landing ilk JS+CSS | 490 KB gzip | ≤300 KB | Build manifest + gzip | Otomatik değil |
| Auth ilk JS+CSS | 248 KB gzip | ≤300 KB | Build manifest + gzip | Otomatik değil |
| Feed ilk JS+CSS | 506–508 KB gzip | ≤350 KB | Route manifest + gzip | Otomatik değil |
| Harita shell + dinamik GameMap | yaklaşık 537 KB gzip | ≤500 KB | Entry ve loadable manifest | Otomatik değil |
| Tüm build JS/MJS/CSS | 1.506 KB gzip | Trend gerilemesi ≤%5 | Static asset taraması | Otomatik değil |
| CSS toplamı | 45,6 KB gzip | ≤100 KB | Static CSS gzip | Otomatik değil |
| Build içi PNG/ICO | 914 KB raw | Above-fold transfer ≤500 KB | Browser network trace | Ölçülmedi |

Map route ile landing aynı bütçeyi kullanmaz; ancak MapLibre ve geometri kodu landing/auth giriş yoluna taşınmamalıdır.

## Runtime ve ağ bütçeleri

| Metrik | Hedef | Mevcut kanıt | Doğrulama yöntemi |
| --- | ---: | --- | --- |
| LCP p75 | ≤2,5 sn | Lab hedef dışı | Lighthouse CI + production Web Vitals |
| INP p75 | ≤200 ms | Ölçülmedi | RUM + scripted interaction |
| CLS p75 | ≤0,1 | Lab 0 | Lighthouse CI + RUM |
| Normal API p95 | ≤400 ms | Ölçülmedi | Server histogram/load test |
| Claim processing p95 | ≤750 ms | Ölçülmedi | Correlation ID ile transaction metric |
| Commit→region görünümü p95 | ≤500 ms | Ölçülmedi | İki-client timestamp ölçümü |
| Reconnect→snapshot p95 | ≤2 sn | Ölçülmedi | Network fault E2E |
| Uzun task | Tek task ≤200 ms, p95 ≤50 ms | Ölçülmedi | Performance trace |
| 30 dk session heap artışı | ≤25 MB ve monoton leak yok | Ölçülmedi | Heap snapshot/GC kontrollü test |
| Harita stres | 10.000 görünür hücrede p95 ≥50 FPS | Ölçülmedi | Sabit cihaz profili + frame trace |
| Feed stres | 300 kartta görünür frame drop yok | Ölçülmedi | Scroll benchmark/virtualization trace |

## Mobil test profili

Lighthouse mobil kabul koşulu sabitlenmelidir:

- production build;
- yeni Chrome profili ve cold cache;
- 4× CPU slowdown;
- yaklaşık 1,6 Mbps down / 750 Kbps up / 150 ms RTT;
- landing, login, home ve play rotaları ayrı;
- en az üç tekrar, median raporu;
- tile servisi hatası uygulama bundle metriğinden ayrıca raporlanır.

## Optimizasyon önceliği

1. Landing/feed'e giren ağır Turf veya harita bağımlılığının import grafiğini çıkar.
2. Harita route dynamic chunk ve MapLibre worker/media yükünü network trace ile ayır.
3. Büyük logo/OG assetlerinin render edilen gerçek ölçülerini ve formatını düzelt.
4. Feed kartlarının uzun listede virtualization gerektirip gerektirmediğini ölç.
5. GPS/realtime update sıklığında React render, MapLibre source update ve geometry CPU süresini profile et.

## Quality gate

CI; build sonrası route/asset bütçelerini, production Lighthouse'ı ve belirlenen thresholdları otomatik kontrol etmeden bu kategori 9.8 kabul edilmez. Current workflow bu kapıları henüz çalıştırmıyor.
