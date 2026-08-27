# mrap başlangıç kalite denetimi

Tarih: 27 Ağustos 2026  
Durum: Başlangıç ölçümü; kaynak kodu değiştirilmeden önce kaydedildi.  
Ürün adı: **mrap**. Önceki çalışma adı ürün adı olarak kabul edilmez.  
Çalıştırma kısıtı: Docker kullanılmadı ve bu denetimde kullanılmayacak.

## Kapsam ve yöntem

Denetim; kaynak kodu, Next.js App Router yapısı, yerel SQLite veri katmanı, oyun alanı geometrisi, sosyal akışlar, erişilebilirlik, güvenlik, testler, bağımlılıklar, üretim derlemesi ve gerçek Chromium ölçümlerini kapsar. Bulgular yalnızca çalıştırılmış komutlara, incelenmiş kaynaklara ve kaydedilmiş raporlara dayanır.

## Ölçülebilen başlangıç kanıtları

| Kontrol | Sonuç | Kanıt |
|---|---:|---|
| TypeScript strict kontrolü | Geçti | `npm run check` |
| ESLint | Geçti | `npm run check` |
| Birim/entegrasyon testleri | 208/208 geçti | Vitest çıktısı |
| Satır kapsamı | %82,01 | `artifacts/audit/coverage-baseline/coverage-summary.json` |
| Dal kapsamı | %69,90 | aynı rapor |
| Fonksiyon kapsamı | %86,99 | aynı rapor |
| Dairesel bağımlılık | 0 | Madge, 171 dosya |
| Kod tekrar oranı | %1,56 satır | `artifacts/audit/jscpd-baseline/jscpd-report.json` |
| Üretim bağımlılık açığı | 0 | `npm audit --omit=dev` |
| Landing Lighthouse | 82 / 100 / 100 / 100 | `artifacts/audit/lighthouse-baseline-prod-landing.json` |
| Demo harita Lighthouse | 65 / 100 / 96 / 100 | `artifacts/audit/lighthouse-baseline-prod-map.json` |
| Landing LCP | 3.984 ms | üretim Lighthouse raporu |
| Demo harita LCP | 5.053 ms | üretim Lighthouse raporu |
| Demo harita transferi | 1.461.256 bayt | üretim Lighthouse raporu |

Lighthouse değerleri sırasıyla performans, erişilebilirlik, en iyi uygulamalar ve SEO skorlarıdır. Windows Chrome geçici klasör temizleme adımı `EPERM` ile kapanmış olsa da rapor JSON dosyaları eksiksiz üretilmiştir; bu durum uygulama hatası olarak sayılmamıştır.

## Mimari başlangıç görünümü

- Next.js 16.3.3 App Router, React 19.2.8 ve strict TypeScript kullanılıyor.
- Gerçek hesap ekranları repository/SQLite üzerinden çalışıyor; demo verileri demo ve tanıtım bileşenleriyle sınırlı.
- Harita MapLibre, geometri Turf ve sunucu otoriteli oyun servisleriyle ayrıştırılmış.
- Oyun API’leri, authoritative store, sürümleme ve yerel çok oyunculu test altyapısı mevcut.
- Kaynak taramasında `dangerouslySetInnerHTML` ve dairesel bağımlılık bulunmadı.
- Bazı çekirdek dosyalar aşırı büyük: `GameMap.tsx`, `authoritative-store.ts`, `repository.ts` ve global CSS bakım maliyeti yaratıyor.

## Başlangıçta doğrulanan güçlü yönler

- Mevcut 208 testin tamamı geçiyor.
- Üretim bağımlılıklarında bilinen güvenlik açığı raporlanmıyor.
- Gerçek ve demo veri yolları genel olarak ayrılmış.
- Sahiplik/realtime/gizlilik kararları için ADR ve protokol dokümanları mevcut.
- Chromium Lighthouse erişilebilirliği her iki ölçümde 100.
- Kaynak bağımlılık grafiğinde döngü yok.

## Başlangıç kusurları ve eşik ihlalleri

### P0

- Vercel üzerinde ortak dünya için çalışır bir production veri adaptörü yok. SQLite production’da bilinçli olarak reddediliyor; SQLite dışındaki provider’lar da runtime’da desteklenmiyor. Supabase/PostGIS migration hazırlığı bulunsa da gerçek adapter bulunmadığından mevcut kaynak Vercel’de ortak veri alanıyla başlatılamaz.
- İstenen yorum görüntüleme sistemi mevcut değil: yorumlar yalnız inline form olarak açılıyor, mevcut yorum listesi okunamıyor ve gerçek/demo davranışları ayrışıyor.

### P1

- Yorumlar gönderinin altında inline açılıyor; bağımsız, klavye ve odak yönetimli panel yok.
- Gerçek yorum API’sinde listeleme/pagination yok; gönderim cevabı yorum nesnesi ve güvenilir toplam sayı sağlamıyor.
- Yorum endpoint’inde diğer yazma uçlarıyla aynı sınırlı JSON ve oran sınırlama standardı uygulanmıyor.
- Test kapsamı istenen %85 satır / %80 dal eşiğinin altında.
- Üretim harita performansı 65 ve LCP 5,05 saniye; hedefleri karşılamıyor.
- Tam viewport matrisi, 200% yakınlaştırma ve Firefox/WebKit kanıtı henüz yok.

### P2

- API rotaları ve sosyal kartlarda tekrarlı kod bulunuyor.
- Analitik/ölçümleme için tipli ve gizlilik duyarlı bir adaptör kanıtı yok.
- CI yalnızca temel check/build adımlarını içeriyor; kapsam, bağımlılık, bundle ve tarayıcı eşikleri zorlanmıyor.
- PWA/manifest/offline yetenekleri ve üretim operasyon dokümanları eksik.
- `@turf/jsts`/`jsts` lisansları araç çıktısında `UNKNOWN`; gerçek paket lisansları ayrıca doğrulanmalı.

## İlk düzeltme sırası

1. Yorum listeleme/gönderme sözleşmesini güvenli API ve repository katmanında tamamlamak.
2. Yorumları odak tuzağı, Escape, arka plan tıklaması ve mobil bottom-sheet davranışı olan ayrı panelde açmak.
3. Eksik çekirdek dal testlerini ekleyip kapsam eşiklerini zorlamak.
4. Harita kodunu rotaya göre gecikmeli yüklemek ve ana iş parçacığı/bundle maliyetini düşürmek.
5. CI, tarayıcı matrisi, güvenlik/performance budget ve kalan zorunlu dokümantasyonu tamamlamak.

## Başlangıç kararı

Proje yerel MVP olarak çalışır ve sağlam bir temele sahiptir; ancak production ortak veri adaptörü, ölçülebilir performans, kapsam, yorum akışı ve çapraz tarayıcı kanıtları nedeniyle **9,8/10 hazır değildir**. Başlangıç genel skoru 8,20/10 ve karar **FAIL / düzeltme gerekli** olarak kaydedildi.
