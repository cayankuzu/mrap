# mrap güvenlik özeti

Bu belge uygulanan kontrolleri, doğrulanan kanıtları ve açık production risklerini özetler. Ayrıntılı saldırı matrisi [THREAT_MODEL.md](./THREAT_MODEL.md), konum kararı [ADR-004](./ADR-004-location-privacy.md), kötüye kullanım limitleri [ABUSE_PREVENTION.md](./ABUSE_PREVENTION.md) ve kurtarma prosedürü [FAILURE_RECOVERY.md](./FAILURE_RECOVERY.md) içindedir.

## Güven modeli

Tarayıcı tamamen güvenilmeyen istemcidir. UI'da buton gizlemek veya disable etmek güvenlik kontrolü sayılmaz. Production hedefinde:

```text
Tarayıcı → Cloudflare edge → Vercel same-origin BFF → Supabase/PostgreSQL
```

authoritative source of truth PostgreSQL/PostGIS olmalıdır. Realtime yalnız commit edilmiş state değişimini taşır; ownership kanıtı değildir.

## Uygulanan yerel kontroller

- Parolalar `scrypt` ve kullanıcıya özel salt ile hashlenir; karşılaştırma timing-safe yapılır.
- Session tokenları veritabanında SHA-256 hash olarak tutulur. Cookie `HttpOnly`, `SameSite=Lax`, production'da `Secure` ve yüksek önceliklidir.
- Korunan dashboard route'ları sunucuda current user gerektirir.
- Unsafe API metotlarında cross-site ve beklenmeyen/missing origin reddedilir.
- JSON gövdeleri content type, byte limiti, UTF-8 ve nesne şekli üzerinden sınırlandırılır.
- Oyun komutlarında user/session/candidate eşleşmesi, lease, nonce, sequence, idempotency, geometri ve rate limit sunucuda doğrulanır.
- Production mode simulated GPS session'ını sunucuda reddeder.
- Raw GPS ve aktif rota yalnız sahibine/trusted backend'e açıktır; realtime payload allow-list'i bunları içermez.
- Güvenlik başlıkları CSP, HSTS, frame deny, MIME sniffing koruması, referrer ve permissions policy içerir.
- Hata cevapları correlation ID taşır; beklenmeyen hata kullanıcıya iç detay veya stack sızdırmaz.
- Hesap silme işlemi kullanıcı adı, mevcut parola ve açık geri alınamazlık onayı gerektirir.

## Mevcut kanıt

- `npm audit` production ve tüm dependency ağacında kritik/yüksek/orta/düşük bilinen açık göstermedi.
- Bağlı Supabase kabul projesinde `001`–`015` migrationları uygulandı; uzak schema lint warning/error olmadan geçti ve uygulama–SQL sözleşmesi `schema=15`, `world-main`, `grid=22` değerleriyle doğrulandı.
- Uzak ürün smoke testi iki geçici Supabase Auth hesabıyla claim, gönderi, yorum, beğeni, kaydetme, takip ve bildirim akışlarını çalıştırdı. Son temizlik Auth kullanıcısı, profil ve kullanıcıya ait territory hücresi için ayrı ayrı doğrulandı.
- Production client asset taramasında Supabase secret, database URL, cron secret, service-role ve Cloudflare token eşleşmesi bulunmadı.
- Unit/integration testleri replay, farklı payload ile idempotency key, başka kullanıcının session/candidate'ı, production simülasyonu, rate limit, restricted region ve atomik rollback senaryolarını kapsar.
- Local authoritative modelde owner/paint/score/event/version/outbox birlikte commit veya rollback edilir.

Bu kanıt belirli snapshot içindir; gelecekte güvenlik açığı olmayacağını garanti etmez.
Uzak veritabanı kabul adımları kişisel kimlik veya secret içermeyen
[Supabase kabul kaydında](./audit/SUPABASE_ACCEPTANCE_2026-08-27.md) özetlenmiştir.

## Veri sınıflandırması

| Veri | Sınıf | Görünürlük |
| --- | --- | --- |
| Raw GPS ve aktif rota | Çok hassas | Sahibi ve trusted backend |
| Session/candidate/claim command | Hassas | Sahibi ve trusted backend |
| Risk/audit detayı | Güvenlik gizli | Trusted backend/operasyon |
| Current territory/paint | Oyun görünürlüğü | Yetkili dünya oyuncuları |
| Profil ve gönderi | Hesap görünürlüğüne bağlı | Owner/follower/public kuralı |

Raw konum retention varsayılanı 30 gündür ve maintenance migration/cron sözleşmesi vardır. Gerçek production cron çalışması deployment sonrasında ayrıca doğrulanmalıdır.

## Açık production engelleri

- Bağlı Supabase kabul projesinin migration, lint, contract ve temel iki-kullanıcılı ürün smoke kapıları geçti; ancak production dünyası bilinçli olarak `draft` ve `competitive_claims_enabled=false` durumunda tutuluyor.
- Vercel proje/team bağlantısı, production hostname'i ve environment scope'ları bu çalışma ortamında yetkilendirilmedi; dolayısıyla internet yayını ve gerçek origin smoke henüz yoktur.
- Cloudflare zone, WAF, durable rate limit, canonical origin ve origin lockdown kurulmadı.
- Signed media upload, private bucket ve EXIF/GPS metadata temizleme çalışan production akışında doğrulanmadı.
- DAST, dependency provenance/signature ve gerçek incident tatbikatı yoktur. CI üç-engine E2E çalıştırır ve production bağımlılıkları için CycloneDX SBOM saklar; başarılı release koşusunun artifaktı ayrıca arşivlenmelidir.
- Browser GPS spoofing tamamen önlenemez; hız, ivme, accuracy, replay ve cihaz/session sinyalleri yalnız riski azaltır.

Bu turda Docker kullanılmadı. Hosted PostgreSQL/PostGIS migration ve temel RLS/ürün kabulü tamamlandı; yük, rollback/restore, özel Storage, Realtime backpressure ve production ağ zinciri kabulü ayrıca gereklidir.

## Release güvenlik kapısı

Aşağıdakilerden biri varsa ortak dünya açılmamalıdır:

- client bundle'da secret;
- başka oyuncunun raw GPS/aktif rota erişimi;
- client ownership/score yazma yetkisi;
- production simülasyon claim'i;
- duplicate request ile çift skor;
- eksik payload/geometri/rate limiti;
- yetkisiz private realtime publish/subscribe;
- kritik veya yüksek dependency açığı.

Tam checklist [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) içinde izlenir.
