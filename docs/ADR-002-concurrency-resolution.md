# ADR-002: Claim çakışmalarının authoritative commit sırasıyla çözülmesi

- Durum: Kabul edildi
- Tarih: 2026-08-27

## Bağlam

İki veya daha çok oyuncu aynı hücreleri eşzamanlı kapatabilir. Client timestamp,
rota başlangıcı veya butona basma zamanı güvenilir değildir ve alan rezervasyonu
oluşturamaz.

## Karar

Aynı hücrede son başarılı server transaction güncel owner olur. Sıra, database
lock/commit düzenidir; cihaz saati kullanılmaz.

MVP claim transactionı şu kilit sırasını kullanır:

1. `worlds` satırı,
2. artan UUID sırasıyla bütün etkilenen `world_regions` satırları,
3. `(region_id, cell_id)` sırasıyla bütün hedef `territory_cells` satırları.

World lock, MVP'de global monoton `world_version` ve açık bir toplam sıra sağlar.
Regionlar ayrıca transaction içinde artırılır. İleride world lock kaldırılırsa
aynı conflict kuralı korunur; yalnız bağımsız region transactionları paralel
çalışır ve client region versionlarına göre uzlaşır.

`app_private.execute_claim_command` current ownership'i lock sonrasında tekrar
okur; stale istemci snapshotını temel almaz. Owner, paint, score, event,
notification ve outbox aynı transactionda yazılır. Hata partial state bırakmaz.

İdempotency anahtarı `(user_id, operation_type, idempotency_key)` ile unique'tir.
Aynı key/aynı payload önceki sonucu döndürür. Aynı key/farklı payload reddedilir,
risk ve audit kaydı üretir.

## Çakışma örneği

```text
X commit -> region version 41
Y commit -> region version 42

X/Y ortak hücrelerinin owner'ı = Y
```

Y'nin rotaya X'ten önce başlaması veya isteği daha erken hazırlaması sonucu
değiştirmez. Y transactionı ikinci işlendiği için en güncel state üzerinde
capture yapar; X skoru azalırken Y skoru aynı transactionda artar.

## Retry

Deadlock ve serialization failure kullanıcı hatası değildir. Trusted server aynı
idempotency key ile bounded exponential backoff+jitter uygular. İş kuralı
reddi retry edilmez. Maksimum retry sonrası komut retryable hata olarak sunulur;
database içinde yarım mutation yoktur.

## Sonuçlar

- Sonuç deterministik, audit edilebilir ve client saatinden bağımsızdır.
- Başlanmış rota alanı rezerve etmez.
- Global world lock doğruluk lehine bir MVP darboğazıdır; metriklerle izlenir.
- Çok-region deadlock riski sabit lock sırasıyla sınırlanır.

## Reddedilen seçenekler

- First-started-wins: doğrulanamaz ve griefing ile alan rezervasyonu yaratır.
- Client timestamp last-write-wins: saat manipülasyonuna açıktır.
- Her hücreyi bağımsız transactionda yazmak: partial claim/score üretir.
- Eventual ownership merge: kısa süreli dahi çift owner kabul edilemez.

