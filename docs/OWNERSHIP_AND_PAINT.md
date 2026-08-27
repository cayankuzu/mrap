# mrap ownership ve paint sözleşmesi

Bu belge sahiplik skoru ile görsel boyamayı birbirinden ayıran ürün/domain sözleşmesidir. Canonical grid kararı [ADR-001](./ADR-001-authoritative-ownership-grid.md), transaction sırası [ADR-002](./ADR-002-concurrency-resolution.md) içindedir.

## Değiştirilemez invariantlar

```text
Bir world/canonical yüzey aynı anda en fazla bir owner taşır.
Territory skoru = benzersiz sahip olunan yüzey alanı.
Paint değişikliği tek başına territory skorunu değiştirmez.
Owner yoksa aktif paint de yoktur.
Harita claim event katmanlarını değil current state'i render eder.
```

## İki ayrı durum

| Durum | Cevapladığı soru | Güncel değer | Skor etkisi |
| --- | --- | --- | --- |
| Ownership | Bu yüzey kimin? | Tek `ownerId` | Owner değişiminde artar/azalır |
| Paint | Bu yüzey hangi renkte? | Tek `paintColorId` | Yok |

Kullanıcı profili tek renge kilitli değildir. Claim sırasında seçilen izinli renk yeni kazanılan veya yeniden boyanan yüzeye uygulanabilir. Aynı renge tekrar dönmek yeni görsel katman oluşturmaz.

## Current state ve geçmiş

`ClaimEvent` denetim, profil geçmişi, paylaşım ve istatistik için saklanabilir. Bu eventler haritada kalıcı üst üste polygonlar olarak çizilmez.

```text
CLAIM HISTORY  = immutable olay dizisi
CURRENT STATE  = canonical yüzey başına güncel owner + paint
MAP RENDERING  = current state'ten türetilen Polygon/MultiPolygon veya tile
SCORE          = owner'ın güncel benzersiz alan toplamı
```

Birbirinden kopuk sahiplik kümeleri render sınırında `MultiPolygon` olabilir. İki ayrı alanın arası yalnız tek geometri elde etmek için doldurulmaz.

## Claim hesabı

Bir claim için kavramsal ayrım:

```text
hedef yüzey
├─ zaten aynı oyuncunun: ownership delta 0, gerekirse paint değişir
├─ sahipsiz: yeni oyuncuya geçer, skor artar
└─ rakibin: eski oyuncudan çıkar, yeni oyuncuya geçer
```

Örnek:

```text
Mevcut benzersiz alan        10.000 m²
Yeni loop alanı              14.000 m²
Mevcut alanla overlap         8.000 m²
Yeni toplam                  16.000 m²
```

Sonuç 24.000 m² değildir. Aynı yüzey ownership skoruna yalnız bir kez girer. Polygon tabanlı önizlemede bu ilişki `union/intersection/difference` ile anlatılabilir; production authoritative kararı client polygonundan değil server tarafından üretilmiş canonical hücrelerden gelir.

## Repaint ve çizim

- Oyuncu yalnız sahibi olduğu yüzeyin paint sonucunu kalıcılaştırabilir.
- Farklı renk seçilmiş self-overlap, ownership'i korur ve yalnız paint'i değiştirir.
- Aynı owner ve aynı renk tekrarında skor, event, notification, version veya outbox spamı oluşmamalıdır.
- Haritada yalnız son geçerli renk görünür; “level 2” veya opacity birikimi yoktur.
- Renkli bölgeler yan yana kullanılarak desen veya büyük çizimler üretilebilir.

Painted area ayrı bir aktivite metriği olabilir; territory leaderboard'una eklenmez.

## Rakip capture

X oyuncusu Y'nin yüzeyini başarılı claim ile aldığında aynı authoritative transaction:

1. current owner'ı X yapar,
2. X ve Y skor farklarını aynı canonical alanla günceller,
3. paint sonucunu X'in claim rengine geçirir,
4. immutable değişim eventini ve region versionını üretir.

Y'nin eski paint'i ele geçirilen yüzeyde görünmeye devam edemez. Y'nin sahip olduğu diğer parçalardaki paint korunur. Aynı anda iki owner veya owner'dan kopuk eski paint ara durumu kabul edilmez.

## Eşzamanlılık ve idempotency

Aktif rota alan rezerve etmez. Çakışan claimler lock alındıktan sonra current state üzerinde seri uygulanır; son başarılı authoritative commit ortak yüzeyin güncel owner'ıdır.

Aynı idempotency key ve aynı payload önceki sonucu döndürür. Aynı key'in farklı payload ile kullanılması reddedilir. HTTP retry ikinci skor veya ikinci claim event üretmez.

## Uygulama sınırı

- UI yalnız rota/candidate önizlemesi gösterir; owner, skor veya final cell listesine karar vermez.
- Yerel adapter aynı ürün invariantlarını SQLite authoritative sandbox'ta doğrular.
- Ortak production dünya için PostgreSQL/PostGIS adapter'ı, RLS ve atomik claim transactionı hâlâ release kapısıdır.
- Realtime yalnız commit edilmiş sonucu taşır; ownership kaynağı değildir.

Test oracle'ları [TEST_MATRIX.md](./TEST_MATRIX.md), failure/rollback davranışı [FAILURE_RECOVERY.md](./FAILURE_RECOVERY.md) içindedir.
