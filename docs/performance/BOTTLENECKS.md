# mrap performans darboğazları

Önceliklendirme, [başlangıç ölçümündeki](./BASELINE.md) doğrulanmış verilere dayanır. “Olası neden” ifadeleri hipotezdir; trace olmadan kesin kök neden olarak kabul edilmemelidir.

## Öncelikli bulgular

| Öncelik | Bulgular | Kanıt | Olası neden / doğrulama ihtiyacı |
| --- | --- | --- | --- |
| P0 | Ana sayfanın soğuk açılışı yavaş | FCP 4.036 ms, LCP 4.676 ms, TTFB 2.287 ms | TTFB katkısı belirgin; sunucu, önbellek ve ilk belge zinciri ayrı ayrı ölçülmeli |
| P0 | Ana sayfada ana iş parçacığını uzun süre meşgul eden işler var | 686, 417, 300, 260 ve 194 ms uzun görevler | Trace çağrı yığını olmadan hangi modülün süreyi tükettiği bilinmiyor |
| P0 | Ana sayfa harita geometri yığınını statik taşıyor | Analyzer: `TerritoryInteractiveMap`, MapLibre ve Turf ana sayfa paketinde | Rota bazlı dinamik yüklemenin gerçek byte ve ana iş parçacığı kazancı yeni paket analiziyle ölçülmeli |
| P1 | Rota JavaScript yükleri yüksek | Home 478.289 B, Explore 495.487 B, Play 553.568 B | Chunk içerikleri ve ortak bağımlılık tekrarları byte bazında incelenmeli |
| P1 | Keşfet ağ isteği sayısı en yüksek rota | Explore 44, Play 40, Home 37 istek | İstek türleri ve kritik zincir trace/ağ dökümüyle sınıflandırılmalı |
| P1 | Bazı sıcak ekran geçişleri 1 saniyeyi aşıyor | Keşfet 1.673 ms, Sıralama 1.626 ms, Harita 1.291 ms | Kod indirme, veri bekleme ve render süreleri ayrı işaretlerle ölçülmeli |
| P2 | Etkileşim alan verisi eksik | INP ve RUM yok | Gerçek kullanıcı p75 ölçümü kurulmadan dokunma performansı hakkında sonuç verilemez |

## Kanıtla desteklenen yorumlar

- Ana sayfa TTFB'si, Keşfet ve Harita rotalarının TTFB'sinden sırasıyla 2.113 ms ve 2.112 ms daha yüksektir. Bu fark gerçektir; fakat sebebi mevcut veriyle belirlenemez.
- `/demo/play`, ölçülen üç rota içinde en yüksek JavaScript yüküne sahiptir: 553.568 B.
- Keşfet ve Sıralama sıcak geçişleri birbirine yakın ve en yavaş iki geçiştir.
- CLS değeri ölçülen Home ve Explore rotalarında 0'dır; bu iki rota için düzen kayması mevcut bir darboğaz değildir.
- `pointerdown active=false` gözlemi tek başına akıcı kaydırma veya iyi INP kanıtı değildir.

## Uygulama sırası

1. Ana sayfadaki harita, MapLibre ve Turf kodunu ilk render yolundan ayır; ardından paket çıktısındaki byte farkını ölç.
2. `/demo/home` ilk belge TTFB'sini CDN cache durumu, sunucu zamanı ve yönlendirme zinciriyle parçala.
3. 686 ms'lik görev başta olmak üzere uzun görevleri resmî Chrome trace ile kaynak/çağrı yığınına bağla; yalnızca doğrulanan işi böl.
4. Keşfet ve Sıralama geçişlerinde navigasyon başlangıcı, veri hazır olma ve görünür içerik zamanlarını ayrı ölç.
5. Aynı mobil profil ile en az beş temiz koşu al; medyan ve p75 raporla.
6. Üretimde RUM kurarak LCP, INP ve CLS p75 değerlerini rota ve cihaz sınıfına göre izle.

Mevcut analyzer çıktısında modül başına byte dağılımı, ağ trace'i ve görev çağrı yığını olmadığı için tasarruf tahmini yazılmamıştır. Bu değerler ölçülmeden “X ms kazanım” iddiası güvenilir değildir.
