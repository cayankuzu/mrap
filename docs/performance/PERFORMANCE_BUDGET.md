# mrap performans bütçesi

Bu bütçe üretim ortamında 390 × 844 px dokunmatik görünüm, 6× CPU yavaşlatma ve Slow 4G profili için hedef kapıdır. Byte bütçeleri, başlangıç ölçümünde kullanılan aynı toplayıcının JavaScript byte tanımıyla karşılaştırılmalıdır.

## Soğuk yükleme bütçeleri

| Metrik | Home | Explore | Play | Değerlendirme |
| --- | ---: | ---: | ---: | --- |
| TTFB | ≤ 800 ms | ≤ 800 ms | ≤ 800 ms | Her rotada |
| FCP | ≤ 1.800 ms | ≤ 1.800 ms | ≤ 1.800 ms | Her rotada |
| LCP | ≤ 2.500 ms | ≤ 2.500 ms | ≤ 2.500 ms | Her rotada |
| CLS | ≤ 0,10 | ≤ 0,10 | ≤ 0,10 | Ölçüm varsa |
| JavaScript | ≤ 350.000 B | ≤ 400.000 B | ≤ 450.000 B | Aynı byte ölçüm yöntemi |
| İstek sayısı | ≤ 35 | ≤ 40 | ≤ 40 | İlk kararlı görünüm |
| En uzun görev | ≤ 200 ms | ≤ 200 ms | ≤ 200 ms | Resmî trace ile |

## Navigasyon ve alan verisi bütçeleri

| Metrik | Hedef | Kaynak |
| --- | ---: | --- |
| Sıcak ekran geçişi | ≤ 1.000 ms | Laboratuvar, aynı mobil profil |
| LCP p75 | ≤ 2.500 ms | RUM |
| INP p75 | ≤ 200 ms | RUM |
| CLS p75 | ≤ 0,10 | RUM |

RUM hedefleri yayın kapısı yapılmadan önce yeterli örneklem, rota ayrımı ve cihaz sınıflandırması tanımlanmalıdır. Mevcut durumda INP/RUM verisi olmadığı için bu satırlar geçemedi veya kaldı şeklinde işaretlenemez.

## Doğrulama protokolü

1. Aynı üretim URL'sini, viewport'u, dokunmatik modu, CPU ve ağ profilini kullan.
2. Soğuk rota ölçümlerini yeni gizli bağlam veya temiz cache ile yap.
3. Her rota için en az beş koşu kaydet; tek iyi koşuyu seçme. Ham sonuçları koru, medyanı ve p75'i raporla.
4. Sıcak geçişlerde kaynak ve hedef ekranı her koşuda aynı başlangıç durumuna getir.
5. JavaScript byte ve istek sayılarını aynı araç ve aynı bitiş koşuluyla karşılaştır.
6. Uzun görevler için Chrome performans trace'ini sakla; görev süresiyle birlikte kaynak ve çağrı yığınını raporla.
7. Değişiklik sonrası sonuçları [denetim tablosundaki](./PERFORMANCE_AUDIT.md) “sonra” sütunlarına ekle.

## Yayın kararı

- Bir metrik bütçe dışındaysa durum **başarısız** olarak görünür; ortalama başka bir metriğin başarısıyla maskelenmez.
- Ölçülmeyen metrik **bekliyor** olarak kalır; başarılı sayılmaz.
- Resmî trace veya RUM yoksa INP/TBT/kök neden puanı üretilmez.
- Bütçeler hedef değerlerdir; mevcut uygulamanın bu değerlere ulaştığı anlamına gelmez.
