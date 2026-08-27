# ADR-004: Canlı konum ve rota gizliliği

- Durum: Kabul edildi
- Tarih: 2026-08-27

## Bağlam

mrap gerçek dünyada hareketle oynanır. Başka bir oyuncunun kesin konumu veya
tamamlanmamış rotası fiziksel takip ve güvenlik riski doğurur. Sosyal hesap
gizliliği bu kuralı gevşetmez.

## Karar

- Oyuncu yalnız kendi canlı konumunu ve aktif rotasını görür.
- Başka oyuncular yalnız committed territory/paint sonucunu görür.
- `route_point_batches` doğrudan client write'a kapalıdır; yalnız sahibi select
  edebilir ve trusted backend işleyebilir.
- Raw point retention `app_private.game_rules.raw_point_retention_days` ile
  sınırlıdır; düzenli purge gerekir.
- Raw GPS veya aktif rota Realtime outbox/payload/log/notification içine girmez.
- Açık rota varsayılan `private`tır. Public/follower route için ayrı
  `public_geometry`, başlangıç/bitiş kırpması ve `privacy_processed_at` zorunludur.
- Production world, `development_simulation` oturumunu kesin reddeder. Simulator
  yalnız ayrı sandbox worldde çalışır.
- `profile_private.location_visibility` database constraintiyle kalıcı olarak
  `private`tır.

Konum servisinin amacı claim doğrulama ve oyuncunun kendi UX'idir; presence
gerekiyorsa en fazla coarse region sayacı (`Bu bölgede 12 aktif oyuncu var`)
kullanılır.

## Veri yaşam döngüsü

1. Nokta küçük batch olarak TLS üzerinden trusted endpoint'e gelir.
2. JWT user/session eşleşmesi ve sequence doğrulanır.
3. Kabul/ignore/risk sınıflaması yapılır.
4. Candidate server tarafında üretilir.
5. Claim yalnız accepted sequence aralığından oluşturulur.
6. Retention dolunca raw batch silinir; immutable claim event polygonu hassas
   erişimde kalır ve public feed'e doğrudan verilmez.

## Sonuçlar ve kalan risk

Browser GPS sahteciliği tamamen çözülemez. Server hız, ivme, accuracy, gap,
teleport, replay ve eşzamanlı cihaz sinyalleriyle riski düşürür. Kullanıcı
cihazındaki işletim sistemi, kötü amaçlı extension veya ele geçirilmiş hesap
kalan risklerdir. Bu ADR yüzde yüz anti-spoofing iddiası yapmaz.

## Reddedilen seçenekler

- Rakibin canlı marker/rotası: fiziksel güvenlik ihlali.
- Gizli hesapta paylaş, açık hesapta göster: canlı GPS için kabul edilemez.
- Sonsuz raw GPS saklama: veri minimizasyonuna aykırı.
- Offline geçmiş rotayı competitive claim'e dönüştürme: replay/backdating riski.
