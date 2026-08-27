# mrap yerel iki oyunculu test rehberi

Bu rehber iki bağımsız hesabı aynı Next.js sürecine ve aynı SQLite authoritative dünyasına bağlayan uygulanabilir hızlı akıştır. Ayrıntılı invariant ve saldırı denemeleri [LOCAL_MULTIPLAYER.md](./LOCAL_MULTIPLAYER.md), tam senaryo kataloğu [TEST_MATRIX.md](./TEST_MATRIX.md) içindedir.

Bu akış yalnız Node.js, npm, Next.js, SQLite ve proje simülatörünü kullanır.

## Ön koşullar

- Repository bağımlılıkları kurulmuş olmalıdır.
- Port `3100` başka süreç tarafından kullanılmamalıdır.
- Test için production sırrı içermeyen ayrı bir SQLite dosya adı kullanılmalıdır.
- Bütün oyuncular aynı geliştirme sunucusuna bağlanmalıdır; iki ayrı `npm run dev` süreci iki ayrı authoritative dünya oluşturur.

## 1. İzole sunucuyu başlat

PowerShell terminal A:

```powershell
$env:MRAP_DATA_PROVIDER='sqlite'
$env:MRAP_SQLITE_FILENAME='mrap-multiplayer-test.sqlite'
$env:MRAP_CANONICAL_ORIGIN='http://localhost:3100'
$env:NEXT_PUBLIC_MRAP_DEVELOPER_CONTROLS='true'
npm run dev -- --port 3100
```

Veri `data/mrap-multiplayer-test.sqlite` içinde kalır. Dosya adı dışında yol verilmez; uygulama `data/` dışına çıkışı reddeder. Bu dosyayı gerçek yerel profil veriniz için kullanmayın.

Sunucu hazır olduğunda `http://localhost:3100` adresinin cevap verdiğini doğrulayın.

## 2. Otomatik X/Y senaryosunu çalıştır

PowerShell terminal B:

```powershell
$env:MRAP_SIMULATOR_BASE_URL='http://localhost:3100'
npm run simulate:multiplayer
```

Script gerçek HTTP API üzerinden:

1. benzersiz X ve Y hesapları oluşturur,
2. ayrı HttpOnly session cookie'leri taşır,
3. aynı development sandbox'ta iki simülasyon session'ı açar,
4. sıralı rota noktalarını gönderir,
5. duplicate point batch'in güvenli no-op olduğunu kontrol eder,
6. çakışan claimleri eşzamanlı yollar,
7. canonical snapshot owner/version sonucunu doğrular,
8. session finish retry'nin aynı sonucu verdiğini kontrol eder.

Başarı çıktısında en az şu alanlar bulunur:

```json
{
  "ok": true,
  "worldId": "development-sandbox",
  "players": ["...", "..."],
  "latestWinner": "...",
  "canonicalCells": 1,
  "duplicateBatch": "ignored",
  "finishRetry": "idempotent"
}
```

`canonicalCells` fixture ve grid yapılandırmasına göre değişebilir; sabit sayı varsaymayın.

## 3. Gecikme ve paket kaybı

Aynı sunucu açıkken terminal B'de:

```powershell
$env:MRAP_SIMULATOR_BASE_URL='http://localhost:3100'
$env:MRAP_SIMULATOR_LATENCY_MS='500'
$env:MRAP_SIMULATOR_PACKET_LOSS='0.05'
npm run simulate:multiplayer
```

Simüle edilen kayıpta point batch yeniden gönderilir. Beklenen sonuç duplicate ownership, ikinci skor veya ikinci finish sonucu değil; aynı accepted sequence ve idempotent final state'tir.

## 4. İki tarayıcı context'iyle UI testi

1. Normal tarayıcı profilinde X hesabını oluşturun.
2. Ayrı gizli pencere veya tamamen ayrı browser profilinde Y hesabını oluşturun.
3. İki context'te de `http://localhost:3100/play` ekranını açın.
4. Konum test panelinden sanal konumu seçin ve iki oyuncuyu aynı harita bölgesine taşıyın.
5. `Harekete Geç` ile rotaları başlatın; WASD/yön tuşlarıyla çakışan looplar üretin.
6. Aday panelinde bir context'te `Devam Et`, sonraki adayda `Alanı Kapat` akışını doğrulayın.
7. İki claim sonrası haritayı ve ağ cevaplarını karşılaştırın.

UI oracle'ları:

- X yalnız X markerını/aktif rotasını, Y yalnız Y markerını/aktif rotasını görür.
- Açık rota diğer context'e yayınlanmaz.
- Commit sonrasında iki context aynı current owner/paint durumuna yakınsar.
- Territory alanı ile rota mesafesi ayrı değişir.
- Aynı yüzeyi aynı renkle tekrar kapatmak territory skorunu artırmaz.
- Reconnect veya version gap sonrasında snapshot final state'i geri getirir.

## 5. Negatif güvenlik denemeleri

- X cookie'siyle Y session veya candidate ID'si kullanılınca generic hata ve sıfır mutation beklenir.
- Aynı idempotency key farklı payloadla tekrar kullanıldığında ilk sonuç korunmalı, ikinci istek reddedilmelidir.
- İzin verilmeyen renk, aşırı batch, sequence gap ve geçersiz geometri ownership oluşturmamalıdır.
- `world-main` için `development_simulation` session'ı reddedilmelidir.
- Region/SSE payloadında latitude, longitude, accuracy, nonce veya aktif rota bulunmamalıdır.

## Sorun giderme

| Belirti | Kontrol |
| --- | --- |
| `403` origin hatası | `MRAP_CANONICAL_ORIGIN` ile portun aynı olduğunu doğrulayın |
| Sunucuya bağlanamıyor | `MRAP_SIMULATOR_BASE_URL` ve terminal A çıktısını kontrol edin |
| Simülatör reddediliyor | Ortamın development ve world'ün `development-sandbox` olduğunu doğrulayın |
| Candidate oluşmuyor | Minimum süre/nokta/alan kurallarını ve script hatasını inceleyin |
| Harita görseli yok | OpenFreeMap ağ erişimini kontrol edin; API doğrulaması harita tile'ına bağlı değildir |
| Önceki veri görünüyor | Teste özel `MRAP_SQLITE_FILENAME` kullandığınızı doğrulayın |

## Sonuçların anlamı

Bu akış yerel domain/API doğrulamasıdır. Supabase RLS, PostGIS transactionı, private Realtime, Cloudflare WAF veya çok-instance Vercel davranışını kanıtlamaz. Ortak production dünya yalnız [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) tamamlandığında açılabilir. Ortam değişkenlerinin tam listesi [ENVIRONMENT.md](./ENVIRONMENT.md) içindedir.
