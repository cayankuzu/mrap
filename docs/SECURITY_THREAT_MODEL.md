# mrap güvenlik ve tehdit modeli

Bu belge ürün düzeyindeki güven sınırını, bugünkü kontrol durumunu ve production risklerini tek giriş noktasında toplar. Ayrıntılı saldırı/kontrol matrisi [THREAT_MODEL.md](./THREAT_MODEL.md), uygulanan kontroller [SECURITY.md](./SECURITY.md), abuse limitleri [ABUSE_PREVENTION.md](./ABUSE_PREVENTION.md) ve açık riskler [audit/RISK_REGISTER.md](./audit/RISK_REGISTER.md) içindedir.

## Güven varsayımı

Tarayıcı, istemci state'i, cihaz saati, GPS sağlayıcısı ve Realtime mesaj sırası güvenilmezdir. UI'da bir alanı gizlemek veya butonu kapatmak authorization değildir.

```text
Bugün doğrulanan yerel akış:
Tarayıcı → Next.js same-origin API → SQLite authoritative adapter

Hedef production akışı:
Tarayıcı → Cloudflare → Vercel BFF → Supabase Auth/PostgreSQL/PostGIS
                                      └→ private Realtime outbox
```

Cloudflare veya Realtime ownership kaynağı değildir. Hedef ortak dünyada tek source of truth PostgreSQL/PostGIS transactionı olmalıdır.

## Korunan varlıklar

1. Current owner, paint, skor ve region version bütünlüğü.
2. Raw GPS, aktif rota ve risk kanıtının gizliliği.
3. Hesap, session cookie, reset tokenı ve kullanıcı içeriği.
4. Idempotent claim/event geçmişi ve audit izi.
5. Server secretları, database bağlantısı ve publisher yetkisi.
6. Geometri veya spam yükü altında kullanılabilirlik.

## Başlıca tehditler

| Tehdit | Güvenlik hedefi | Bugünkü durum | Production kapısı |
| --- | --- | --- | --- |
| Başka kullanıcı kimliği/session'ı | User-session-candidate eşleşmesi | Yerel API/store testleri var | Supabase Auth/RLS saldırı testi |
| GPS spoof, teleport, replay | Sequence, nonce, lease, hız/doğruluk ve risk kontrolü | Yerel authoritative sandbox'ta uygulanıyor | Gerçek cihaz ve abuse yük testi |
| Owner/score/cell tampering | Client bu alanları yazamaz | Server komut şeması client sonucunu kabul etmiyor | Postgres grants/RLS/RPC kabulü |
| Duplicate veya eşzamanlı claim | Tek event, atomik skor ve deterministik son durum | SQLite concurrency/idempotency testleri var | Hosted Postgres lock/retry testi |
| Raw GPS sızıntısı | Self-only erişim, payload allow-list, retention | Public/realtime DTO testleri var | Cron, log redaction ve privacy kabulü |
| Realtime spoof/reorder/gap | Private receive, service-only publish, version+snapshot | Yerel SSE reconciler uygulanıyor | Private Realtime publisher/RLS E2E |
| Geometry/JSON DoS | Ucuz erken limitler ve bounded canonical cell sayısı | API/store sınırları var | Cloudflare WAF ve staging load testi |
| XSS/zararlı medya | React escaping, allow-list ve medya doğrulama | Sınırlı data URL doğrulaması var | Private bucket, signed URL, EXIF temizleme |
| Secret sızıntısı | Server secretı clienta girmez | Bundle taraması temiz baseline verdi | Deploy sonrası artifact/rotation kanıtı |
| Hesap ele geçirme | Parola/session/reset koruması | Yerel `scrypt`, hashli token ve cookie kontrolü var | Managed Auth ve incident tatbikatı |

“Bugünkü durum” sütunu production hazır anlamına gelmez. Yalnız repository içinde çalışan veya test edilen kapsamı ifade eder.

## Ownership güvenlik sınırı

Client claim komutu owner, score, canonical cell listesi, final polygon veya kazanan timestamp gönderemez. Trusted server user kimliğini oturumdan çıkarır; session, candidate, accepted point sequence, allow-list renk ve idempotency anahtarıyla karar verir.

Owner, paint, skor, immutable event ve realtime outbox birlikte commit veya rollback olmalıdır. Aynı yüzeyde son başarılı authoritative transaction güncel owner'dır. Tam sözleşme [OWNERSHIP_AND_PAINT.md](./OWNERSHIP_AND_PAINT.md) ve [CONCURRENCY_RULES.md](./CONCURRENCY_RULES.md) içindedir.

## Konum güvenlik sınırı

Başka oyuncunun kesin markerı veya aktif rotası hiçbir hesap görünürlüğü seçeneğiyle açılmaz. Raw GPS, feed/realtime/log payloadına konmaz; production simulation hard reject olmalıdır. Ayrıntılar [LOCATION_PRIVACY.md](./LOCATION_PRIVACY.md) içindedir.

GPS risk kontrolleri kesin fiziksel varlık kanıtı değildir. Yüzde yüz anti-spoofing iddiası kabul edilmez.

## Web ve API kontrolleri

- Korunan endpointler server-side current user doğrular.
- Unsafe same-origin isteklerde origin kontrolü uygulanır.
- Hassas JSON endpointleri content type, byte, UTF-8, shape ve alan allow-list sınırı kullanır.
- Parametreli SQL ve enum/renk allow-listleri dinamik veri enjeksiyonunu sınırlar.
- Hız limitleri kullanıcı/endpoint/session bağlamında uygulanır; process-memory limit tek başına production dayanıklılığı sayılmaz.
- Hata cevapları stack, SQL detayı, token, GPS veya risk evidence içermez; correlation ID ile izlenir.
- Cookie ve güvenlik başlıkları HTTPS production varsayımıyla doğrulanmalıdır.

## Kabul edilmeyen varsayımlar

- “Gizli hesap GPS'i korur” yeterli değildir; GPS her hesapta private'tır.
- “Realtime mesajı geldi” ownership kanıtı değildir.
- “İstek bir kere gelir” varsayımı yoktur; retry ve duplicate beklenir.
- “Service role RLS tarafından korunur” denmez; secret ve grant sınırı ayrıca korunur.
- “SQLite dosyası Vercel instance'ları arasında ortak dünyadır” denmez.
- “Migration dosyası var” hosted RLS/PostGIS kabulü sayılmaz.

## Release engelleri

Aşağıdakilerden biri varsa competitive production claimleri kapalı kalmalıdır:

- başka kullanıcı raw GPS/aktif rota erişimi,
- clienttan owner/score/cell mutationı,
- duplicate istekte çift skor/event,
- production simülasyon claim'i,
- kritik/yüksek dependency açığı veya client bundle secretı,
- doğrulanmamış RLS/private topic/publisher yetkisi,
- claim transactionında partial owner/paint/score sonucu,
- Cloudflare/Vercel origin ve body/rate sınırlarının eksikliği.

Kanıt listesi [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md), test kimlikleri [TEST_MATRIX.md](./TEST_MATRIX.md), hata anı prosedürü [FAILURE_RECOVERY.md](./FAILURE_RECOVERY.md) içindedir.
