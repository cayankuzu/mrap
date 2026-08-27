# mrap yerel çoklu oyuncu doğrulaması

## Amaç

İki bağımsız kullanıcı aynı yerel authoritative sunucuya ve aynı SQLite dünya durumuna bağlanır. `localStorage`, sekmeler arası event veya istemci polygonu sahiplik kaynağı değildir. Simülasyon yalnız development sandbox dünyasında çalışır.

Bu akışta **Docker kullanılmaz**. Yerel doğrulama Node.js, Next.js ve projenin SQLite adaptörüyle yapılır.

## Gereksinimler

- `package-lock.json` ile uyumlu Node.js 22.
- `npm ci` ile kurulmuş bağımlılıklar.
- Production sırrı içermeyen yerel `.env.local`.
- Aynı çalışma alanında tek authoritative geliştirme sunucusu.

İzole test verisi istenirse sunucuyu başlatmadan önce yalnız dosya adı verilir:

```powershell
$env:MRAP_SQLITE_FILENAME='mrap-multiplayer-test.sqlite'
npm run dev -- --port 3100
```

Dosya yolu kabul edilmez; adaptör dosyayı yalnız proje `data/` dizininde oluşturur.

## Otomatik iki oyunculu senaryo

Ayrı bir terminalde:

```powershell
$env:MRAP_SIMULATOR_BASE_URL='http://localhost:3100'
npm run simulate:multiplayer
```

Simulator:

1. Benzersiz e-posta ve kullanıcı adına sahip X/Y hesapları oluşturur.
2. Her hesap için ayrı HttpOnly session cookie kullanır.
3. İki development simulation oturumu başlatır.
4. GPS noktalarını aynı authoritative HTTP sözleşmesiyle gönderir.
5. Duplicate point batch’in güvenli no-op olduğunu doğrular.
6. İki çakışan claim’i eşzamanlı gönderir.
7. Son canonical region snapshot’ında deterministik owner/version sonucunu doğrular.
8. Finish retry’nin idempotent olduğunu kontrol eder.

Başarılı çıktı `ok: true`, sandbox world kimliği, oyuncular, region sürümleri ve canonical hücre sayısını içerir.

## Ağ hata enjeksiyonu

Gecikme ve paket kaybı aynı scriptte uygulanabilir:

```powershell
$env:MRAP_SIMULATOR_BASE_URL='http://localhost:3100'
$env:MRAP_SIMULATOR_LATENCY_MS='500'
$env:MRAP_SIMULATOR_PACKET_LOSS='0.05'
npm run simulate:multiplayer
```

Paket kaybında aynı nokta paketi yeniden gönderilir; idempotency anahtarı ve accepted sequence sonucu değişmemelidir.

## İki gerçek tarayıcı context’i

UI doğrulaması için iki ayrı browser context/profile kullanılmalıdır:

```text
Context X → X hesabı → development sandbox → simulated provider
Context Y → Y hesabı → aynı development sandbox → simulated provider
```

Kontroller:

- Her kullanıcı yalnız kendi markerını ve aktif rotasını görür.
- Kapanmamış rota diğer context’e yayınlanmaz.
- Claim commit edildiğinde iki context aynı region version’a yakınsar.
- Rakibin kesin GPS noktası, accuracy veya canlı route payloadı ağda bulunmaz.
- Reconnect sonrasında version gap varsa snapshot alınır.

## Güvenlik denemeleri

- X session cookie’siyle Y session/candidate kimliği kullanmak reddedilmelidir.
- Aynı idempotency anahtarı farklı payload hash’iyle reddedilmelidir.
- Production world’de simulated session reddedilmelidir.
- İzin verilmeyen renk, aşırı büyük batch ve sequence gap reddedilmelidir.
- Hiçbir reddedilen işlem partial ownership/score/outbox verisi bırakmamalıdır.

## Production ayrımı

SQLite yerel MVP ve test adaptörüdür; Vercel ortak dünya çözümü değildir. Production için Postgres/PostGIS tabanlı, transaction ve realtime yayın sınırları aynı domain sözleşmesini uygulayan ayrı adapter gerekir. Adapter ve canlı environment doğrulanmadan shared-world deployment yapılmamalıdır.
