# mrap değişiklik günlüğü

Bu dosya kullanıcıya veya geliştiriciye etkisi olan doğrulanmış değişiklikleri kaydeder. Bir maddenin burada bulunması, production ortak dünyanın açıldığı anlamına gelmez; yayın kapıları [production checklistinde](./docs/PRODUCTION_CHECKLIST.md) izlenir.

Biçim [Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) yaklaşımını izler. Proje henüz kararlı sürüm garantisi vermediği için değişiklikler `0.x` altında tutulur.

## [Yayımlanmamış]

### Eklenen

- Oyuncuya görünen kurallar, ownership/paint ayrımı, konum gizliliği ve güvenlik sınırları için kanonik ürün belgeleri.
- Yorum listeleme için erişim kontrollü keyset sayfalama; yorum oluşturma için sınırlı JSON gövdesi, karakter sınırı ve kullanıcı bazlı hız limiti.
- Yerel iki oyunculu doğrulama için Node.js, Next.js, SQLite ve geliştirme simülatörü tabanlı tekrar edilebilir çalışma akışı.

### Değiştirilen

- İstemci harita kodundaki Turf barrel importları doğrudan alt paketlere ayrıldı.
- Canlı oyun haritasında gereksiz kalıcı framebuffer kullanımı kaldırıldı; paylaşım kadrajı ekran görüntüsü akışında korundu.
- Gönderi mini haritalarının görünür alan öncesi yükleme mesafesi düşürüldü ve harita/listener cleanup akışı belirginleştirildi.

### Güvenlik

- Yorum API'si gönderi görünürlük kuralını repository katmanında uygular; erişilemeyen gönderinin varlığını ayırt eden bilgi sızdırmaz.
- Yorum metni hem HTTP hem repository hem de SQLite trigger sınırında doğrulanır.

## [0.1.0] - 2026-08-27

### Eklenen

- Responsive landing, kayıt, giriş, parola sıfırlama, ana akış, keşfet, harita, sıralama, profil, bildirim ve ayar ekranlarından oluşan yerel MVP.
- Yerel SQLite üzerinde hesap, oturum, takip/istek, gizli-açık hesap, gönderi, beğeni, kaydetme ve bildirim akışları.
- MapLibre ve OpenFreeMap tabanlı gerçek etkileşimli haritalar; gerçek GPS ile geliştirme simülatörünü ortak `LocationProvider` sınırında kullanan rota deneyimi.
- Başlangıç noktasına dönmeyi gerektirmeyen loop candidate, `Alanı Kapat`/`Devam Et`, aynı oturumda çoklu loop ve idempotent claim akışı.
- Benzersiz ownership skoru ile skoru değiştirmeyen paint durumunun ayrılması; rakip capture ve sürümlü bölge snapshot/patch uzlaşması.
- En fazla altı fotoğraf, territory ilişkisi ve kaydedilmiş harita kadrajı taşıyan sosyal paylaşım modeli.
- Geliştirme sandbox'ında iki geçici oyuncuyla duplicate batch, eşzamanlı çakışan claim, canonical sonuç ve idempotent bitirme doğrulaması.
- Supabase/PostgreSQL/PostGIS hedef mimarisi için migration ve karar belgeleri.

### Güvenlik

- `scrypt` parola hashleme, hashlenmiş session tokenı, HttpOnly cookie, origin kontrolü, sunucu tarafı authorization ve güvenli hata cevapları.
- Session lease/nonce, monoton point sequence, payload hash, idempotency, geometri sınırları ve production simülasyon reddi içeren authoritative oyun kontrolleri.
- Raw GPS ve aktif rotayı public feed, bildirim ve realtime payloadlarından dışlayan gizlilik sözleşmesi.

### Bilinen sınırlar

- Çalışan uygulama henüz Supabase data/Auth adapter'ına bağlı değildir.
- SQLite Vercel ortak dünya depolaması değildir ve Vercel ortamında bilinçli olarak reddedilir.
- Cloudflare zone/WAF/origin lockdown, private media storage, production Realtime publisher ve hosted RLS kabulü kurulmuş veya doğrulanmış değildir.
- Üretim açılışı için [güvenlik](./docs/SECURITY.md), [tehdit modeli](./docs/SECURITY_THREAT_MODEL.md) ve [test matrisi](./docs/TEST_MATRIX.md) kapıları tamamlanmalıdır.
