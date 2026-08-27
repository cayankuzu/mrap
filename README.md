# mrap MVP

Gerçek dünya haritasında özgür rota kapatma, benzersiz alan sahipliği ve harita boyamayı sosyal bir akışla birleştiren responsive web uygulaması.

## Yerelde çalıştırma

```bash
npm install
npm run dev
```

Ardından `http://localhost:3000` adresini açın. Etkileşimli demo `/demo/home`, gerçek hesap deneyimi ise kayıt/giriş sonrasında `/home` üzerinden kullanılabilir.

## Oyun kontrolleri

- Gerçek konum veya geliştirici sanal konum sağlayıcısını seçin.
- Sanal konum modunda `WASD` veya yön tuşlarıyla hareket edin.
- Aktif rota eski ve geçerli bir rota segmentine ya da sahip olunan alan sınırına temas ettiğinde alan kapatma fırsatı oluşur.
- Aynı yüzey sahiplik skoruna yalnızca bir kez eklenir; yeniden boyama sahiplik skorunu artırmaz.

## Kontroller

```bash
npm run check
npm run build
npm audit --omit=dev
```

## Yerel çok oyunculu simülasyon

Geliştirme sunucusu çalışırken ikinci bir terminalde aşağıdaki komutu kullanın:

```bash
npm run simulate:multiplayer
```

Komut iki geçici hesap oluşturur; aynı alan için eşzamanlı claim, paket tekrar oynatma,
son-yazan-kazanır sahiplik sonucu, region version/snapshot ve idempotent rota bitirme
kurallarını gerçek HTTP API üzerinden doğrular. Gecikme veya paket kaybı denemek için
`MRAP_SIMULATOR_LATENCY_MS` ve `MRAP_SIMULATOR_PACKET_LOSS` değişkenleri verilebilir.
Hedef sunucu varsayılan olarak `http://localhost:3000` adresidir; gerekirse
`MRAP_SIMULATOR_BASE_URL` ile değiştirilebilir. Sanal konum yalnız geliştirme dünyasında
çalışır ve production ortamında sunucu tarafından reddedilir.

Yerel geliştirmede kimlik doğrulama, paylaşımlar, sahiplik geometrileri, boya geometrileri ve alan kapatma geçmişi SQLite veritabanında kalıcıdır. `MRAP_DATA_PROVIDER=supabase` seçildiğinde uygulama Supabase Auth, Postgres/PostGIS, özel medya bucket'ı ve sunucu otoriteli oyun adaptörlerini kullanır. Sağlayıcılar arasında sessiz fallback yapılmaz.

Üretim ağı, veri sahipliği ve canlı geçiş kapıları için [`docs/production-architecture.md`](docs/production-architecture.md) belgesine bakın. SQLite Vercel üzerinde bilinçli olarak engellenir. Supabase adaptörlerinin kodda bulunması tek başına production yayınının tamamlandığı anlamına gelmez; migration kabulü, RLS, iki istemci yakınsaması, Vercel ortam değişkenleri, özel alan adı ve Cloudflare güvenlik kontrolleri ayrıca doğrulanmalıdır.

`supabase/migrations` altındaki `001`–`015` migrationları bağlı kabul projesine sıralı uygulandı; uzak lint, contract ve geçici iki hesaplı ürün smoke testi geçti. Bu, farklı bir production projesinin veya Vercel/Cloudflare ağının hazır olduğunu kanıtlamaz. Ham konum temizliği Vercel Cron üzerinden çalıştırılacak şekilde hazırlanmıştır; sunucu ortamındaki `CRON_SECRET` en az 16 karakterlik rastgele bir değer olmalı ve tarayıcıya açılmamalıdır.

Bu proje Docker kullanmaz. Cloudflare, Vercel ve Supabase için hesap veya özel alan adı gerektiren adımlar kod dışındaki yetkili panellerde ayrıca tamamlanmalıdır.
