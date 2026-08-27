# mrap oyun çekirdeği

Bu belge MVP oyun kurallarını, sunucu-otoriteli claim akışını ve skor invariantlarını tanımlar. Uygulama davranışının ayrıntılı test kataloğu [TEST_MATRIX.md](./TEST_MATRIX.md), ownership kararı [ADR-001](./ADR-001-authoritative-ownership-grid.md), yarış çözümü [ADR-002](./ADR-002-concurrency-resolution.md) içindedir.

## Hareket oturumu

`Harekete Geç` yeni bir route session başlatır. Tek session içinde:

- Konum noktaları gerçek GPS veya yalnız geliştirme/demo amaçlı simülasyon sağlayıcısından gelir.
- Aktif rota yalnız rotayı yapan oyuncuya canlı gösterilir.
- Başka oyuncular marker veya tamamlanmamış rota alamaz.
- Aynı hesapta aynı anda birden fazla competitive session açılması reddedilir.
- Session lease, nonce, sıra numarası, batch boyutu, konum doğruluğu ve hareket hızı sunucuda doğrulanır.
- Oturum açık rota olarak sonlandırılabilir; bu sonuç mesafeye katkı verebilir fakat ownership veya territory skoru oluşturmaz.

## Loop algılama

Başlangıç noktasına geri dönmek zorunlu değildir. Aktif rota kendi geçerli geçmiş segmentine yeniden temas ettiğinde veya yapılandırılmış tolerans içine girdiğinde candidate oluşabilir.

Candidate için en az şu kurallar uygulanır:

- gerçek GPS ve simülasyon proximity eşikleri ayrıdır;
- temas eden segmentler arasında minimum index farkı bulunur;
- minimum rota uzunluğu ve minimum polygon alanı sağlanır;
- zero-area, çok küçük, aşırı büyük, aşırı ince veya geçersiz geometri reddedilir;
- GPS jitter, düşük doğruluk, sequence gap ve teleport risk olarak ele alınır;
- aynı kesişim cooldown süresinde tekrar candidate üretmez.

Geçerli candidate bulunduğunda tracking otomatik bitmez. Kullanıcı:

- `Alanı Kapat`: candidate'ı idempotent claim komutuna dönüştürür;
- `Devam Et`: candidate'ı tüketir, aynı session içinde ileride yeni loop oluşturabilir.

UI candidate polygonunu önizleyebilir; server yalnız kabul edilmiş route sequence'inden kendi geometry/cell sonucunu üretir.

## Ownership ve paint

Ownership ve paint ayrı kavramlardır:

| Kavram | Soru | Skora etkisi |
| --- | --- | --- |
| Ownership | Bu canonical yüzeyin sahibi kim? | Benzersiz alan kadar etkiler |
| Paint | Sahip olunan yüzey hangi renkte görünür? | Etkilemez |

Güncel harita claim geçmişini üst üste polygon katmanları olarak çizmez. Canonical hücre için tek owner ve tek aktif paint görünür. Claim eventleri geçmiş, paylaşım ve denetim için ayrıca saklanabilir.

Kullanıcı kendi hücresini tekrar aynı renge boyarsa gerçek no-op olmalıdır: skor, event, notification ve region version spamı üretmez. Rakip bir hücreyi ele geçirirse owner ve geçerli paint yeni claim sonucuna göre birlikte güncellenir.

## Claim ve çakışma

Claim komutu client owner, score, cell listesi, polygon veya kazanan timestamp kabul etmez. Sunucu-issued session/candidate, renk, idempotency key ve payload hash üzerinden çalışır.

Eşzamanlı çakışmada rota başlangıç zamanı rezervasyon değildir. Aynı hücrede son başarılı authoritative transaction güncel owner olur. Transaction:

1. world/region/cell kilitlerini deterministik sırada alır;
2. mevcut owner ve paint'i lock sonrasında yeniden okur;
3. owner transferlerini ve her oyuncunun skor farkını hesaplar;
4. owner, paint, score, immutable event, notification ve realtime outbox sonucunu atomik yazar;
5. hata olursa hiçbir partial mutation bırakmaz.

Aynı idempotency key ve aynı payload önceki sonucu döndürür. Aynı key farklı payload ile yeniden kullanılırsa güvenli biçimde reddedilir.

## Skor ve ölçüler

- `uniqueOwnedAreaM2`: ana territory skoru; aynı yüzey tekrar sayılmaz.
- `distance`: oyuncunun kabul edilmiş toplam hareket yolu; alanla aynı metrik değildir.
- `claim count`: başarılı claim event sayısıdır; benzersiz alan skorunun yerine geçmez.
- `painted area`: görsel üretim metriği olabilir; territory alanını artırmaz.

Rakip capture durumunda alınan hücre alanı eski owner skorundan düşerken yeni owner skoruna aynı transaction içinde eklenir. Skor gerektiğinde canonical cell alanlarının toplamından yeniden üretilebilir.

## State machine özeti

İstemci akışı açık state'ler kullanır:

```text
IDLE → LOCATION_READY → TRACKING → LOOP_AVAILABLE
LOOP_AVAILABLE → CONTINUING → TRACKING
LOOP_AVAILABLE → SUBMITTING_CLAIM → ACCEPTED | PARTIAL | REJECTED
TRACKING → PAUSED_LOW_ACCURACY | PAUSED_OFFLINE | RESYNCING_MAP
TRACKING → FINISHED
her aktif state → SESSION_REVOKED
```

UI geometri kararı vermez; yalnız state machine ve domain sonucunu sunar.

## Gizlilik ve simülasyon

Kendi konumu oyuncuya görünür; diğer oyuncular yalnız committed territory/paint görür. Raw GPS ve aktif rota feed, notification, public API veya realtime patch içine konmaz. Ayrıntılar [ADR-004](./ADR-004-location-privacy.md) içindedir.

WASD/yön tuşu simülasyonu demo ve geliştirme sandbox'ı içindir. Production mode simülasyon session'ını hem uygulama hem authoritative server katmanında reddetmelidir. Tarayıcı GPS sahteciliğini yüzde yüz engelleme iddiası yapılmaz; risk sinyalleri kötüye kullanımı azaltır.
