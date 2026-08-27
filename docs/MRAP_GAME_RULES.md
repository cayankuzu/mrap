# mrap oyun kuralları

Bu belge oyuncuya görünen MVP kurallarının kanonik özetidir. Geometri ve sunucu akışının teknik sözleşmesi [GAME_CORE.md](./GAME_CORE.md), çakışma ayrıntıları [CONCURRENCY_RULES.md](./CONCURRENCY_RULES.md) içindedir.

## 1. Hareket oturumu

- Oyuncu `Harekete Geç` dediğinde yeni bir rota oturumu başlar.
- Konum, gerçek GPS'ten veya yalnız demo/geliştirme sandbox'ında simülatörden gelir.
- Oyuncu kendi canlı konumunu ve aktif rotasını görür; diğer oyuncular bunları göremez.
- Takip bitirildiğinde kapanmamış rota territory oluşturmaz. Kabul edilmiş hareket mesafesi ayrı aktivite metriği olarak saklanabilir.
- Competitive dünyada aynı hesap için birden fazla eşzamanlı aktif oturum kabul edilmez.

## 2. Loop ve alan kapatma

Başlangıç noktasına geri dönmek zorunlu değildir. Aktif rota:

1. kendi yeterince eski ve geçerli bir segmentine yeniden temas ettiğinde veya
2. oyuncunun mevcut territory sınırına ulaştığında

bir kapatma adayı oluşabilir. Yakınlık toleransı gerçek GPS ile simülatörde farklıdır; minimum nokta farkı, rota uzunluğu, alan ve geometri kuralları yapılandırmadan gelir.

Geçerli aday rotayı otomatik kapatmaz:

- `Alanı Kapat`, yalnız aday segmentini authoritative claim işlemine gönderir.
- `Devam Et`, takibi kesmeden adayı tüketir.

Aynı hareket oturumunda birden fazla aday ve başarılı claim oluşabilir. Aynı temas cooldown süresinde tekrar tekrar panel açmaz. Çok küçük, sıfır alanlı, aşırı büyük, geçersiz veya GPS jitter kaynaklı adaylar territory üretmez.

## 3. Ownership

- Aynı canonical yüzeyin aynı anda yalnız bir sahibi vardır.
- Yeni claim, oyuncunun mevcut alanıyla üst üste binen kısmı ikinci kez saymaz.
- Territory skoru benzersiz sahip olunan metrekaredir.
- Claim geçmişi çok sayıda event içerebilir; harita güncel sahipliği tek durum olarak render eder.
- Ayrık alanlar desteklenir; araları yapay biçimde doldurulmaz.

Rakibin alanına yapılan başarılı claim ortak yüzeyi yeni oyuncuya geçirir. Eski oyuncunun skoru azalırken yeni oyuncunun skoru aynı authoritative işlemde artar. Eşzamanlı claimlerde cihaz saati veya rotaya ilk başlama zamanı öncelik sağlamaz; aynı yüzeyde son başarılı authoritative commit güncel sonucu belirler.

## 4. Paint ve renk

Ownership “kimin?”, paint ise “hangi renkte?” sorusunun cevabıdır.

- Oyuncu rota sırasında izin verilen renklerden birini seçebilir; son kullandığı renk sonraki oturum için varsayılan olabilir.
- Kendi alanını başka renkle boyamak territory skorunu artırmaz.
- Aynı alanı aynı renkle yeniden boyamak gerçek no-op'tur.
- Son geçerli paint görünür; üst üste seviye veya koyulaşan sahiplik katmanı oluşmaz.
- Rakip capture sonrasında ele geçirilen yüzeyin owner ve paint sonucu yeni claim'e göre birlikte güncellenir.

Tam sözleşme ve örnekler [OWNERSHIP_AND_PAINT.md](./OWNERSHIP_AND_PAINT.md) içindedir.

## 5. Birbirinden ayrı metrikler

| Metrik | Anlamı |
| --- | --- |
| Territory alanı | Güncel benzersiz sahiplik alanı |
| Mesafe | Kabul edilmiş rota boyunca gidilen toplam yol |
| Claim sayısı | Başarıyla commit edilmiş alan kapatma sayısı |
| Painted area | Görsel renklendirme etkinliği; territory skoru değildir |

Aynı yüzeyde tekrar yürümek veya boyamak territory alanını tekrar artırmaz. Günlük seri, MVP territory kuralı değildir.

## 6. Paylaşım ve harita görünürlüğü

- Sosyal paylaşım bir territory kaydıyla ilişkilidir; paylaşım sahipliği değiştirmez.
- Başlık, açıklama, fotoğraflar ve kaydedilmiş harita kadrajı claim geçmişini anlatabilir.
- Paylaşılan harita current/izinli territory görünümüdür; raw GPS noktaları veya canlı rota değildir.
- Hesap görünürlüğü gönderiyi kimin görebileceğini etkiler, canlı konum gizliliğini gevşetmez.

## 7. Güvenli oyun

Araç kullanırken oynanmamalı; trafik, özel mülk, yasak veya tehlikeli alanlara girilmemelidir. Browser GPS sahteciliğini tamamen engelleme iddiası yoktur; sunucu doğruluk, hız, sequence, replay ve teleport sinyalleriyle riski azaltır.

Canlı konum sınırı [LOCATION_PRIVACY.md](./LOCATION_PRIVACY.md) içinde tanımlıdır.

## 8. Bugünkü kapsam

Kurallar yerel Next.js/SQLite authoritative sandbox ve demo akışında test edilebilir. Supabase/PostGIS ortak dünya adapter'ı ile Cloudflare/Vercel production ağı henüz tamamlanmış değildir; bu belge onların çalışır durumda olduğunu iddia etmez. Yerel iki oyunculu doğrulama için [LOCAL_MULTIPLAYER_TESTING.md](./LOCAL_MULTIPLAYER_TESTING.md) kullanılmalıdır.
