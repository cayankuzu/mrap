# mrap performans başlangıç ölçümü

## Ölçüm kapsamı

Bu belge, optimizasyon öncesi üretim başlangıç çizgisini kaydeder. Sonuçlar tek başına alan verisi (RUM) veya resmî bir Chrome performans trace'i değildir.

| Alan | Değer |
| --- | --- |
| Hedef | `https://mrap-eta.vercel.app` |
| Görünüm | 390 × 844 px, dokunmatik |
| CPU | 6× yavaşlatma |
| Ağ | Slow 4G |
| Bağlam | Üretim dağıtımı, soğuk rota yüklemeleri ve sıcak uygulama içi geçişler |

## Soğuk rota yüklemeleri

| Rota | FCP | LCP | TTFB | CLS | JavaScript | İstek |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/demo/home` | 4.036 ms | 4.676 ms | 2.287 ms | 0 | 478.289 B | 37 |
| `/demo/explore` | 2.096 ms | 2.552 ms | 174 ms | 0 | 495.487 B | 44 |
| `/demo/play` | 1.656 ms | 1.656 ms | 175 ms | Ölçülmedi | 553.568 B | 40 |

`/demo/home` yüklemesinde gözlenen uzun görev süreleri: **686, 417, 300, 260 ve 194 ms**. Bunlar TBT değildir; resmî trace bulunmadığı için görevlerin kaynak dosya ve çağrı yığını eşlemesi yapılamamıştır.

## Sıcak uygulama içi geçişler

| Hedef ekran | Süre |
| --- | ---: |
| Keşfet | 1.673 ms |
| Harita | 1.291 ms |
| Sıralama | 1.626 ms |
| Profil | 598 ms |
| Ana sayfa | 818 ms |

Bu geçişler mevcut başlangıç gözlemidir; çoklu koşu medyanı veya p75 alan verisi olarak yorumlanmamalıdır.

## Ek teknik gözlemler

- Gözlem kaydında `pointerdown active=false` raporlandı. Bu yalnızca ham dinleyici durumudur; dokunma gecikmesi veya INP sonucu değildir.
- Paket analizinde ana sayfanın `TerritoryInteractiveMap`, MapLibre ve Turf bağımlılıklarını statik olarak taşıdığı görüldü.
- Bağımlılıkların tekil byte maliyeti çıkarılmadığından olası kazanç için sayı verilmemiştir.

## Bilinen ölçüm boşlukları

- Chrome DevTools MCP kullanılamadığı için resmî performans trace'i, LCP faz dağılımı, ağ bağımlılık zinciri ve uzun görev çağrı yığınları yoktur.
- INP, güvenilir biçimde gerçek kullanıcı etkileşimi ve p75 alan verisi gerektirir; mevcut INP değeri **yoktur**.
- RUM kurulumu ve alan Core Web Vitals değerleri **yoktur**.
- `/demo/play` için CLS ölçümü sağlanmamıştır.
- Optimizasyon sonrası değerler henüz ölçülmemiştir.

Sonuç: Bu dosya yalnızca doğrulanmış “önce” değerlerini içerir; bir Lighthouse puanı, 9,8/10 kalite puanı veya optimizasyon başarısı iddia etmez.
