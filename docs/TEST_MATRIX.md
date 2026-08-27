# mrap zorunlu test matrisi

## Ortak fixture ve oracle

Her test temiz sandbox world, deterministic grid fixture ve ayrı X/Y/Z auth
contextleri kullanır. Testler yalnız UI sonucu değil şu database oracle'larını da
doğrular:

```text
cell uniqueness: (world_id, cell_id) tek satır
score: SUM(owned cell area) ile eşit (tolerans 0,01 m²)
region version: monoton
idempotency: command başına en fazla bir claim_event
atomicity: owner/paint/score/event/notification/outbox birlikte veya hiçbiri
privacy: başka user raw point/live route okuyamaz
convergence: tüm client region hashleri eventler bitince eşit
```

Katmanlar: `DB` SQL transaction/RLS, `DOMAIN` geometry/grid, `API` BFF sözleşme,
`RT` Realtime reducer, `E2E` iki gerçek browser context, `FUZZ` property-based.

## Concurrency — C01–C10

| ID | Katman | Senaryo | Beklenen kesin sonuç |
| --- | --- | --- | --- |
| C01 | DB/E2E | X önce, Y sonra aynı hücreleri commit eder | Ortak hücre Y; version ardışık; X azalır/Y artar |
| C02 | DB/E2E | Y önce, X sonra | Ortak hücre X; C01 simetriği |
| C03 | DB | X/Y aynı anda aynı polygon | İki atomik event; region version ardışık; son lock/commit kazanır |
| C04 | DB | X/Y/Z aynı hücreler | Üç version; son authoritative transaction owner |
| C05 | DB/DOMAIN | Kısmi overlap | Ortak hücre son commit; iki unique bölüm korunur |
| C06 | DOMAIN/DB | Polygonlar yalnız boundary/noktada temas | Ortak canonical merkez hücresi yoksa transfer yok |
| C07 | DB/API | X aynı commandı iki kez | Tek command/event/score delta; aynı result payload |
| C08 | API/DB | Committen sonra HTTP timeout, aynı key retry | Önceki result; çift event/score yok |
| C09 | DB/E2E | Aynı user iki cihaz session başlatır | Partial unique yalnız bir live competitive session bırakır |
| C10 | DB | Claim sırasında rakip repaint | Transaction sırası owner/paint kuralını belirler; paint non-ownerda kalmaz |

## Realtime — R11–R20

| ID | Katman | Senaryo | Beklenen kesin sonuç |
| --- | --- | --- | --- |
| R11 | RT/E2E | Broadcast HTTP response'dan önce | Claim bir kez uygulanır; pending doğru kapanır |
| R12 | RT/E2E | HTTP response önce | Sonraki Broadcast duplicate kabul edilir |
| R13 | RT | Aynı Broadcast iki kez | İkinci event state/version değiştirmez |
| R14 | RT | Version N+2, sonra N+1 | Gapte refetch; ters patch tahmini yok |
| R15 | RT | Bir region versionı düşürülür | Region DESYNCED ve snapshot refetch |
| R16 | RT/E2E | Client üç commit boyunca disconnect | Reconnect snapshot final version/state getirir |
| R17 | RT | Subscribe sırasında event, snapshot sonra | Buffer içindeki yeni event snapshot üstüne uygulanır |
| R18 | RT/E2E | X/Y tüm eventler tamam | Stable canonical sort ile final map hash eşit |
| R19 | DB/RT | Patch cell limiti aşılır | `requiresRefetch=true`, changedCells yok |
| R20 | RT | LastApplied'dan eski event | State/version geri gitmez |

## Geometry — G21–G35

| ID | Katman | Senaryo | Beklenen kesin sonuç |
| --- | --- | --- | --- |
| G21 | DOMAIN/DB | Valid basit loop | Server polygon valid; deterministic cell set |
| G22 | DOMAIN | Başlangıca dönmeden geçmiş segmente temas | Yalnız ilgili sequence segmentinden candidate |
| G23 | DOMAIN/FUZZ | Çoklu self-intersection | Reject veya sınırlı valid repair; sahiplik yok |
| G24 | DOMAIN/DB | Minimum altı loop | Area/route/cell rule reject |
| G25 | DOMAIN | Tek çizgi/zero area | Invalid geometry reject |
| G26 | DOMAIN | Duplicate noktalar | Normalize/dedupe; benzersiz nokta azsa reject |
| G27 | API/DOMAIN | NaN | Schema reject, PostGIS çağrılmaz |
| G28 | API/DOMAIN | Infinity | Schema reject, PostGIS çağrılmaz |
| G29 | API/DOMAIN | Vertex limiti üstü | Erken reject; timeout yok |
| G30 | DOMAIN | Maximum bbox üstü | Erken reject |
| G31 | DOMAIN/FUZZ | Aşırı ince sliver | Cell/min-area epsilon altında fragment yok |
| G32 | DOMAIN | Antimeridian geçişi | Unsupported world policy ile açık reject |
| G33 | API/DOMAIN | Desteklenmeyen latitude/polar | Coordinate/world bounds reject |
| G34 | DOMAIN/PostGIS | `ST_MakeValid` alanı ciddi değiştirir | Repair kabul edilmez |
| G35 | DOMAIN/PostGIS | Repair MultiPolygon/çok parça üretir | Policy sınırı üstünde reject; sessiz büyük değişim yok |

## Security — S36–S50

| ID | Katman | Senaryo | Beklenen kesin sonuç |
| --- | --- | --- | --- |
| S36 | API/DB | Client owner ID gönderir/değiştirir | Schema alanı kabul etmez; direct write RLS/grant reject |
| S37 | API/DB | X, Y session ID'si | Generic reject+risk/audit; mutation yok |
| S38 | API/DB | X, Y candidate ID'si | Generic reject+risk/audit; mutation yok |
| S39 | API | Expired JWT | BFF 401; service RPC çağrılmaz |
| S40 | DB/API | Eski request replay | Önceki idempotent result |
| S41 | DB/API | Aynı key farklı payload hash | Reject, risk/audit; ilk result değişmez |
| S42 | BUILD | Client bundle/source map secret scan | Service role/DB secret eşleşmesi sıfır |
| S43 | DB/RLS | Auth core tablo INSERT/UPDATE/DELETE | Permission denied/RLS; satır değişmez |
| S44 | DB/RT | Anon private region subscribe | Unauthorized |
| S45 | DB/RT | X, Y private topic subscribe | Unauthorized |
| S46 | DB/API | Simulation -> production world | `SIMULATION_NOT_ALLOWED`; ownership yok |
| S47 | Edge/API/DB | Claim rate aşılıyor | 429 veya terminal rate reject; partial yok |
| S48 | Edge/API | Huge/deep JSON | Body/schema limit reject; DB çağrılmaz |
| S49 | API/DB | Script/CSS içeren color | Allow-list regex reject; rendera ulaşmaz |
| S50 | API/DB | SQL injection benzeri string | Parametreli query/regex reject; schema değişmez |

## Score ve atomic invariant — I51–I60

| ID | Katman | Senaryo | Beklenen kesin sonuç |
| --- | --- | --- | --- |
| I51 | DB | Aynı world/cell iki owner insert | Composite PK/tek owner modeli engeller |
| I52 | DB | Normal claim sonrası reconciliation | Current score = owned cell area toplamı |
| I53 | DB | Self-overlap | Unique territory score artmaz |
| I54 | DB | Enemy capture | Eski owner eksi/yeni owner artı aynı cell alanı ve transaction |
| I55 | DB | Paint-only | Territory area/cell count artmaz; paint version güncellenir |
| I56 | DB | Open saved route | Territory/claim/score satırı oluşmaz |
| I57 | DB | Compensating rollback fixture | Yalnız event hâlâ son etkiyse geri alınır; skor reconcile |
| I58 | DB | Same owner+same color tekrar | No-op; event/version/outbox/notification spamı yok |
| I59 | DB | Son hücre kaybı | Score sıfır; hiçbir numeric negatif değil |
| I60 | DB | Event insert/outbox aşamasında forced failure | Bütün owner/paint/score/event/notification/outbox rollback |

## Property-based/fuzz özellikleri

En az 1.000 seed; başarısız seed CI artifactı olarak saklanır ve replay edilir:

- random valid/invalid route ve loop,
- random X/Y/Z claim sırası,
- duplicate/drop/reorder network eventleri,
- random self/capture/repaint oranı,
- vertex/bbox/precision sınır değerleri,
- random disconnect/snapshot zamanı.

Her seed sonunda cell uniqueness, monotonic version, score reconciliation,
owner/paint uyumu, event idempotency ve multi-client map hash convergence
invariantları çalışır.

## RLS rol matrisi

| Kaynak | anon | authenticated sahibi | authenticated diğer | service_role |
| --- | --- | --- | --- | --- |
| Territory current cells | yok | read | read | read/write |
| Own route/session/batch/candidate/command/event | yok | read | yok | read/write |
| Saved raw route | yok | read | yok | read/write |
| Notifications | yok | read | yok | read/write |
| Claim cell changes/outbox/risk/audit | yok | yok | yok | read/write |
| Region private Broadcast receive | yok | active region read | active region read | publish |
| User private Broadcast receive | yok | yalnız kendi topic | yok | publish |

## Kabul raporu

CI raporu test ID, seed, commit SHA, migration checksum, Postgres/PostGIS sürümü,
süre ve sonucu kaydeder. `skip`, flaky rerunla gizlenen hata veya yalnız manuel
gözlem production kabulü sayılmaz. Environment gerektiren E2E açıkça ayrı jobda
çalışır ve checklist kanıtına bağlanır.
