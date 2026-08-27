# mrap hata yönetimi

Bu belge kullanıcı, API, authoritative oyun, realtime ve operasyon hatalarının nasıl sınıflandırıldığını açıklar. Recovery ayrıntıları [FAILURE_RECOVERY.md](./FAILURE_RECOVERY.md), realtime uzlaşması [REALTIME_PROTOCOL.md](./REALTIME_PROTOCOL.md) içindedir.

## İlkeler

- Hata hiçbir zaman partial ownership, paint, score veya event bırakmamalıdır.
- Kullanıcı mesajı Türkçe, kısa ve eyleme geçirilebilir olmalıdır.
- API hata cevabı stable code, retry bilgisi ve correlation ID taşımalıdır.
- Stack, SQL, token, raw GPS veya başka kullanıcı verisi cevap/log içine girmemelidir.
- Pending UI confirmed territory olarak çizilmemelidir.
- Retry yalnız idempotent ve gerçekten transient işlemlerde aynı key/payload ile yapılmalıdır.

## UI sınırları

- `src/app/error.tsx`: route segmenti hatasında yeniden deneme ve ana sayfa dönüşü sunar.
- `src/app/global-error.tsx`: root render hatasında bağımsız Türkçe fallback üretir.
- `src/app/not-found.tsx`: silinmiş/geçersiz route için güvenli 404 sunar.
- Harita state machine offline, düşük accuracy, resync, rejected claim ve revoked session durumlarını ayrı gösterir.
- Aktif rota çevrimdışıyken erişilebilir canlı durum, kişisel taslak/ACK kuyruğu ayrımını ve bu bölümün rekabetçi alana katılmadığını açıklar; TTL/kapasite/depolama hatası konum toplamayı duraklatır.

Bugün bütün hata durumlarının otomatik browser E2E kapsamı yoktur. WebGL unsupported, tile provider failure, offline draft recovery ve infinite-spinner sınırları ayrıca test edilmelidir.

## API hata sözleşmesi

Authoritative oyun hatası örneği:

```json
{
  "error": "Kullanıcıya uygun Türkçe açıklama",
  "code": "STABLE_ERROR_CODE",
  "retryable": false,
  "correlationId": "sunucu-korelasyon-kimliği"
}
```

Bilinen kodlar authorization, session, nonce/sequence, idempotency, candidate, route/geometry/color, rate limit, restricted region, conflict ve retryable sınıflarını kapsar. Beklenmeyen hata güvenli genel mesaj ve HTTP 500 verir; iç exception yalnız redacted server log olayına dönüşür.

## Retry matrisi

| Durum | Otomatik retry | Davranış |
| --- | --- | --- |
| Validation/authorization | Hayır | Kullanıcı girdisi veya session düzeltilir |
| Rate limit | Hayır/sonra | Retry-after veya bekleme gösterilir |
| Duplicate aynı payload | Önceki sonuç | Yeni mutation yapılmaz |
| Aynı key farklı payload | Hayır | Conflict/risk kaydı |
| Postgres serialization/deadlock | Sınırlı | Aynı idempotency key ile jitter/backoff |
| Ağ cevabı committen sonra kayıp | Status sorgusu/retry | Önceki command result bulunur |
| Realtime version gap | Claim retry değil | Region snapshot refetch |
| Tile/harita görsel hatası | Veri mutasyonu yok | Fallback ve yeniden yükleme |

Business rejection otomatik retry edilmez. Retry üst sınırı aşıldığında kullanıcıya bölgenin yoğun olduğu söylenir; belirsiz pending alan confirmed yapılmaz.

## Realtime recovery

Duplicate ve eski event yok sayılır. `previousVersion` beklenen değerden ilerideyse region `DESYNCED` olur ve patch tahmini yapılmadan snapshot alınır. Subscribe-before-snapshot bufferı bağlantı yarışı sırasında gelen yeni eventi korur.

EventSource kapatma, map remove, timeout/interval temizliği ve geolocation `clearWatch` lifecycle içinde uygulanır. Listener leak, hidden-tab ve uzun session memory davranışı henüz otomatik performans kabulüyle kanıtlanmamıştır.

## Operasyon

- Correlation ID HTTP → command → event → outbox zincirinde korunmalıdır.
- Risk, audit ve sayaçlar raw GPS/secret içermeyen context kullanır.
- Dead-letter outbox silinmez; sebep düzeltilip audit ile yeniden pending yapılır.
- Score drift canonical cells toplamından reconciliation ile düzeltilir.
- P0/P1 sahiplik veya privacy incidentinde competitive claim kapatılır, map read-only kalır.

## Açık kalite kapıları

- Error-state browser E2E
- Offline/reconnect ve commit-after-timeout E2E
- WebGL/tile failure fallback testi
- Türkçe form error announcement ve screen-reader testi
- Production error monitoring, dashboard ve alarm entegrasyonu
- Infinite spinner watchdog ve ölçümü

Bu kapılar geçmeden “unhandled hata 0” yalnız kısa manuel oturum gözlemine dayanarak iddia edilmez.
