# mrap performans denetimi

## Yönetici özeti

P0 mobil geçiş ve akış paketi sorunları giderildi. Optimizasyon adayı, `next start` production çıktısında 390 × 844 dokunmatik görünüm, 6× CPU ve Slow 4G altında beş soğuk koşuyla ölçüldü. Home ve Explore ilk görünüm JavaScript’i sırasıyla 263.756 B seviyesine indi; tüm sıcak sekme geçişleri 605 ms veya altında tamamlandı ve görsel dokunma geri bildirimi 7,6–57,2 ms aralığında oluştu.

Bu “sonra” ölçümü yerel production adayıdır; başlangıç çizgisi Vercel production dağıtımından alınmıştır. Bu nedenle özellikle TTFB ve ortamdan etkilenen süreler doğrudan production kazanımı olarak sunulmaz. INP/RUM ve resmî Chrome trace bulunmadığından denetim alan verisi açısından açık kalır.

## Önce → sonra ölçüm tablosu

“Sonra” değerleri beş koşunun p75 değeridir. TTFB satırları yerel origin nedeniyle yalnız ölçüm altyapısının kaydıdır ve production karşılaştırması sayılmaz.

| Rota | Metrik | Önce | Sonra — yerel production p75 | Hedef | Durum |
| --- | --- | ---: | ---: | ---: | --- |
| Home | FCP | 4.036 ms | 1.328 ms | ≤ 1.800 ms | Aday geçti; production teyidi gerekli |
| Home | LCP | 4.676 ms | 1.980 ms | ≤ 2.500 ms | Aday geçti; production teyidi gerekli |
| Home | TTFB | 2.287 ms | 4,3 ms | ≤ 800 ms | Ortamlar farklı; karşılaştırılamaz |
| Home | CLS | 0 | 0 | ≤ 0,10 | Geçti |
| Home | JavaScript | 478.289 B | 263.756 B | ≤ 350.000 B | Geçti · %44,9 azalma |
| Home | İstek | 37 | 40 | ≤ 35 | Bütçe dışı |
| Home | En uzun görev | 686 ms | 259 ms | ≤ 200 ms | İyileşti; bütçe dışı |
| Explore | FCP | 2.096 ms | 1.304 ms | ≤ 1.800 ms | Aday geçti; production teyidi gerekli |
| Explore | LCP | 2.552 ms | 1.876 ms | ≤ 2.500 ms | Aday geçti; production teyidi gerekli |
| Explore | TTFB | 174 ms | 3,5 ms | ≤ 800 ms | Ortamlar farklı; karşılaştırılamaz |
| Explore | CLS | 0 | 0 | ≤ 0,10 | Geçti |
| Explore | JavaScript | 495.487 B | 263.756 B | ≤ 400.000 B | Geçti · %46,8 azalma |
| Explore | İstek | 44 | 38 | ≤ 40 | Geçti |
| Explore | En uzun görev | Ölçülmedi | 248 ms | ≤ 200 ms | Bütçe dışı |
| Play | FCP | 1.656 ms | 1.320 ms | ≤ 1.800 ms | Aday geçti; production teyidi gerekli |
| Play | LCP | 1.656 ms | 1.320 ms | ≤ 2.500 ms | Aday geçti; production teyidi gerekli |
| Play | TTFB | 175 ms | 3,2 ms | ≤ 800 ms | Ortamlar farklı; karşılaştırılamaz |
| Play | CLS | Ölçülmedi | 0 | ≤ 0,10 | Aday geçti |
| Play | JavaScript | 553.568 B | 575.652 B | ≤ 450.000 B | Bütçe dışı |
| Play | İstek | 40 | 41 | ≤ 40 | Bütçe dışı |
| Play | En uzun görev | Ölçülmedi | 676 ms | ≤ 200 ms | MapLibre kurulumu; bütçe dışı |

## Sıcak geçiş ve anlık geri bildirim

Bu tablo tek, sıralı sıcak geçiş turudur; p75 alan verisi değildir.

| Hedef ekran | Önce geçiş | Sonra geçiş | Dokunma geri bildirimi | Hedef | Aday durum |
| --- | ---: | ---: | ---: | ---: | --- |
| Keşfet | 1.673 ms | 605 ms | 57,2 ms | ≤ 1.000 / ≤ 100 ms | Geçti |
| Harita | 1.291 ms | 458 ms | 23,3 ms | ≤ 1.000 / ≤ 100 ms | Geçti |
| Sıralama | 1.626 ms | 420 ms | 21,9 ms | ≤ 1.000 / ≤ 100 ms | Geçti |
| Profil | 598 ms | 582 ms | 20,4 ms | ≤ 1.000 / ≤ 100 ms | Geçti |
| Ana sayfa | 818 ms | 297 ms | 7,6 ms | ≤ 1.000 / ≤ 100 ms | Geçti |

Ayrı E2E gecikme senaryosunda 650 ms yapay RSC gecikmesi altında sekme geri bildirimi beş örnekte 5,3–13,9 ms, medyan 6 ms ölçüldü.

## Uygulanan P0 düzeltmeler

- Ana sayfa ve keşfet akışlarından MapLibre/Turf statik bağı kaldırıldı; gerçek haritalar ayrı parçada, boş zamanda veya kullanıcı dokunuşuyla yükleniyor.
- MapLibre CSS’i kök layout’tan çıkarılıp yalnız harita bileşenlerine taşındı.
- Harita ekranı konum ön iznini ağır harita motorundan bağımsız başlatıyor.
- Mobil sekme dokunuşunda iyimser aktif durum, kontrollü prefetch ve route-level loading kabuğu eklendi.
- Global non-passive `touchmove` kaldırıldı; yalnız geçerli pull-to-refresh oturumu boyunca bağlanıyor.
- Mobil sabit katmanlarda pahalı backdrop blur azaltıldı ve ekran dışı tek sütun gönderiler `content-visibility` ile ertelendi.
- Request-local kullanıcı sorgusu dedupe edildi; feed kapsamı ve post hidratasyonu paralelleştirildi. 12 post örneğinde etkileşim sorguları 72’den 28’e indirildi.

## Kanıt ve açık kalite kapıları

| Alan | Durum | Açıklama |
| --- | --- | --- |
| Başlangıç production ölçümü | Var | Vercel URL, üç soğuk rota ve beş sıcak geçiş |
| Optimizasyon adayı ölçümü | Var | Yerel `next start`, beş soğuk koşu + bir sıcak tur |
| Ham sonuç | Var | `artifacts/performance/low-end-mobile-after.json` |
| Tekrarlanabilir ölçüm | Var | `npm run perf:mobile` |
| TypeScript / lint / unit | Geçti | 109 dosya, 741 test |
| Resmî Chrome trace | Yok | Chrome DevTools MCP kullanılamadı |
| INP / RUM p75 | Yok | Production alan örneklemi gerekli |
| Play MapLibre uzun görevi | Açık | İlk boya engellenmiyor; motor kurulumu ayrı parçada olsa da 6× CPU’da uzun görev üretiyor |
| Production sonrası yeniden ölçüm | Bekliyor | Bu turda dağıtım yapılmadı |

Sonuç: P0 algısal gezinme ve feed başlangıç paketi hedefleri yerel production adayında doğrulandı. Tüm kategoriler için “9,8/10” veya “tam geçti” denemez; Play harita motoru uzun görevi ile production INP/RUM doğrulaması açık kalite kapılarıdır.
