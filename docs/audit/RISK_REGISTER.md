# mrap risk kaydı

Tarih: 27 Ağustos 2026. Bu kayıt ilk denetim anındaki riskleri gösterir; düzeltmeler ilerledikçe durum ve kanıt bağlantıları güncellenecektir.

| ID | Seviye | Risk | Etki | İlk azaltma eylemi | Durum |
|---|---|---|---|---|---|
| R-000 | P0 | Vercel için ortak ve kalıcı production veri adaptörü bulunmaması | Her ziyaretçinin aynı dünyayı görememesi; deploy blocker | Mevcut repository/domain sözleşmesinin arkasına production Postgres/PostGIS adapterı ve environment doğrulaması | Açık |
| R-001 | P1 | Yorumların inline ve yalnızca kısmi istemci durumu ile çalışması | Tutarsız UX, kalıcı yorumları okuyamama | GET/POST sözleşmesi, repository sorgusu ve ayrı erişilebilir panel | Açık |
| R-002 | P1 | Yorum yazma endpoint’inde ortak rate-limit/sınırlı JSON standardının olmaması | Spam ve kaynak tüketimi | Kullanıcı/IP oran sınırı, boyut limiti, doğrulama ve güvenli hata | Açık |
| R-003 | P1 | Satır/dal kapsamının hedef altında olması | Regresyonların kaçması | Düşük kapsamlı authoritative/geometri/güvenlik modüllerine dal testleri | Açık |
| R-004 | P1 | Harita Lighthouse 65, LCP 5,05 sn ve 1,46 MB transfer | Düşük seviye cihazlarda terk oranı | Dinamik yükleme, render sınırı ve bundle/perf bütçesi | Açık |
| R-005 | P1 | Tam responsive/200% zoom/Firefox/WebKit kanıtının olmaması | Küçük ekran ve farklı motorlarda kırılma | Otomatik viewport matrisi ve manuel kritik akış doğrulaması | Açık |
| R-006 | P2 | Büyük `GameMap`, authoritative store, repository ve global CSS | Bakım ve değişiklik riski | Davranış değiştirmeden sorumluluk bazlı bölme | Açık |
| R-007 | P2 | CI’da coverage, browser, audit ve performance kapılarının olmaması | Kalite gerilemesinin birleşmesi | Deterministik npm tabanlı kalite workflow’u | Açık |
| R-008 | P2 | Analitik/telemetri adaptörü ve gizlilik sözleşmesi kanıtsız | Sorunları görememe veya hassas veri riski | PII içermeyen tipli event katmanı ve redaksiyon testi | Açık |
| R-009 | P2 | `jsts` paket lisanslarının araçta UNKNOWN görünmesi | Lisans due-diligence belirsizliği | Paket içi LICENSE/package metadata’yı doğrulayıp belgelemek | Açık |
| R-010 | P2 | PWA/offline ve zayıf ağ kullanıcı davranışının eksik kanıtı | Hareket oturumunda güven kaybı | Bağlantı durumu, retry/recovery ve manifest kontrolleri | Açık |
| R-011 | P2 | Gerçek çok-instance/yük testi yapılmamış olması | Yarış koşulu ve gecikme riski | Yerel çok oyunculu yarış senaryoları ve dış ortam planı | Açık |
| R-012 | P3 | Windows Lighthouse geçici profil temizliğinde `EPERM` | Otomasyon komutunun hatalı başarısız görünmesi | JSON geçerlilik kontrolü ve güvenli cleanup wrapper’ı | Kabul/araç riski |

## Değişmez güvenlik ve ürün kuralları

- Ürünün görünen adı yalnızca **mrap** olacaktır.
- Docker kullanılmayacaktır.
- Diğer oyuncuların kesin veya canlı GPS konumu yayınlanmayacaktır.
- Sahiplik kararı UI tarafından değil otoriteli domain/sunucu katmanı tarafından verilecektir.
- Aynı fiziksel alan tek owner’a ait olacak; skor benzersiz sahip olunan alandan hesaplanacaktır.
- Deneysel/demo veri gerçek hesap akışına sızmayacaktır.
- Kanıtlanmayan kategoriye 9,8 verilmeyecektir.
