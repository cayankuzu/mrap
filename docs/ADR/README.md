# mrap mimari karar kayıtları

Bu dizin, kabul edilmiş Architecture Decision Record belgeleri için giriş ve durum indeksidir. Mevcut ADR dosyaları geriye dönük bağlantıları bozmamak için `docs/` kökünde tutulur.

## Karar indeksi

| ADR | Durum | Karar |
| --- | --- | --- |
| [ADR-001](../ADR-001-authoritative-ownership-grid.md) | Kabul edildi | Authoritative ownership için deterministik canonical hücre grid'i |
| [ADR-002](../ADR-002-concurrency-resolution.md) | Kabul edildi | Çakışan claimlerde son başarılı authoritative commit |
| [ADR-003](../ADR-003-realtime-versioning.md) | Kabul edildi | Region versioning ve transactional Realtime outbox |
| [ADR-004](../ADR-004-location-privacy.md) | Kabul edildi | Kesin canlı konum ve aktif rotanın yalnız sahibine görünmesi |

## Okuma sırası

1. Ürün kuralı için [mrap oyun kuralları](../MRAP_GAME_RULES.md).
2. Ownership/paint invariantları için [ownership ve paint sözleşmesi](../OWNERSHIP_AND_PAINT.md).
3. Sistem sınırı için [ARCHITECTURE.md](../ARCHITECTURE.md).
4. Ardından ilgili ADR ve operasyon belgesi.

Kabul edilmiş ADR kararın normatif gerekçesidir. Bir ADR'nin kabul edilmiş olması, hedef production adapter'ının kurulmuş veya canlı ortam kabulünün tamamlanmış olduğu anlamına gelmez. Uygulama durumu [ARCHITECTURE.md](../ARCHITECTURE.md) ve [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) üzerinden doğrulanır.

## Yeni ADR biçimi

Yeni kayıt şu alanları içermelidir:

```text
# ADR-NNN: Kısa karar adı

- Durum: Önerildi | Kabul edildi | Kullanımdan kaldırıldı | Yerine geçti
- Tarih: YYYY-AA-GG
- Karar sahipleri: ekip/rol

## Bağlam
## Karar
## Sonuçlar
## Reddedilen seçenekler
## Doğrulama ve geçiş planı
```

Kurallar:

- Karar geçmişi geriye dönük sessizce yeniden yazılmaz.
- Değişen karar yeni ADR ile öncekinin yerini alır; eski dosya bağlantı için kalır.
- Henüz uygulanmayan hedef açıkça `hedef`, `önerildi` veya `release kapısı` olarak yazılır.
- Secret, gerçek kullanıcı verisi veya canlı altyapı kimliği ADR'ye eklenmez.
- Ürün kuralı tekrarlanmaz; ilgili kanonik belgeye bağlantı verilir.
