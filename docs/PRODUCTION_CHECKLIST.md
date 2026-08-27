# mrap production çıkış checklisti

Bu liste bir self-score değildir. Her kutu log, CI çıktısı, dashboard ekranı veya
imzalı review ile kanıtlanmadan production claimleri açılmaz.

## Database ve migration

- [x] Boş bağlı kabul veritabanında 001–015 migrationları sıralı ve hatasız uygulandı (27 Ağustos 2026).
- [x] Uzak `supabase db lint --schema public,app_private --level warning --fail-on warning` sonuç vermeden geçti.
- [ ] Migrationlar staging backup/restore üzerinde tekrar uygulandı.
- [ ] Hosted PostgreSQL major/PostGIS sürümü local config ile uyumlu.
- [x] `app_private` PostgREST exposed schema listesinde değil; `supabase/config.toml` yalnız `public, graphql_public` yayımlar.
- [ ] Production regionları gerçek spatial partitionlarla seed edildi; bootstrap
      global region claim trafiğinde kullanılmıyor.
- [ ] Trusted grid adapter aynı fixture polygon için her ortamda aynı cell setini
      üretiyor; H3 extension bağımlılığı yok.
- [ ] Restricted region seedleri ve ownerları onaylandı.
- [ ] PITR/backup ve restore tatbikatı tamamlandı; RPO/RTO kaydedildi.

## Yetki ve secret

- [ ] Anon/authenticated core tabloları write edemiyor.
- [ ] `execute_claim_command` ve outbox publisher yalnız service_role execute.
- [ ] Başka user session/candidate/private topic testleri reddediliyor.
- [x] Client bundle/source map/CI artifact içinde service-role, DB URL veya token
      bulunmadığı secret scan ile doğrulandı.
- [ ] Development/Preview/Production secretları ayrı ve en az yetkili.
- [ ] Secret rotation runbooku ve sorumlusu belirlendi.
- [ ] Admin/moderasyon aksiyonları before/after/reason audit ediyor.

## Claim doğruluğu

- [ ] 60 senaryolu `TEST_MATRIX.md` otomasyonda geçti.
- [ ] Aynı polygon concurrent X/Y/üç oyuncu sonucu son server commit ile uyumlu.
- [ ] Partial overlap, boundary-only ve sliver testleri geçti.
- [ ] Self-overlap ve same-color no-op score/version/event üretmiyor.
- [ ] Capture eski ownerdan düşüp yeni ownera aynı transactionda ekleniyor.
- [ ] Score reconciliation cell toplamıyla <=0,01 m² fark veriyor.
- [ ] Deadlock/serialization retry aynı idempotency key kullanıyor.
- [ ] API timeout sonrası tek claim event var.
- [ ] Production simulation claimi database seviyesinde reddediliyor.

## Realtime

- [ ] Topicler private; authenticated send policy yok.
- [ ] Subscribe-before-snapshot ve bounded buffer clientta uygulandı.
- [ ] Duplicate, out-of-order, gap ve reconnect testleri geçti.
- [ ] Büyük patch `requiresRefetch`, küçük patch changed cells üretiyor.
- [ ] Outbox worker en az iki instance ile `SKIP LOCKED` testini geçti.
- [ ] Outbox lag/dead-letter alarmları ve replay runbooku çalışıyor.
- [ ] İki client final region/map hashleri eşit.
- [ ] Payload örneklerinde raw GPS/route/email/IP/token/risk evidence yok.

## Konum, güvenlik ve abuse

- [x] GPS accuracy/speed/acceleration/teleport/gap/replay kontrolleri serverda ve otomatik testlerde doğrulandı.
- [x] Payload byte, batch point, polygon vertex/area/bbox/cell limitleri serverda ve DB contractında doğrulandı.
- [ ] User/session/IP/endpoint/region rate limitleri staging yük testinde doğrulandı.
- [ ] Offline grace sonrası competitive claim oluşmuyor.
- [ ] Raw GPS retention purge işi, alarmı ve yasal retention onayı var.
- [ ] Public saved route başlangıç/bitiş kırpma ve EXIF temizliği doğrulandı.
- [ ] Tehlikeli alanda oynama ve araç kullanma güvenlik metni hukuk/ürün onaylı.
- [ ] GPS spoofing için yüzde yüz koruma iddiası ürün metninde yok.

## Ağ ve deploy

- [ ] Cloudflare proxied DNS, TLS, HSTS ve Managed WAF aktif.
- [ ] Auth/claim/media endpointlerinde ayrı rate/body limitleri var.
- [ ] `/api/*`, authenticated RSC/HTML ve cookie cevapları cache bypass.
- [ ] Vercel origin/canonical host/origin kontrolü doğrulandı.
- [ ] Supavisor transaction pooler runtime; direct connection migration/backup.
- [ ] WebSocket ve token refresh staging reconnect testini geçti.
- [ ] `MRAP_DATA_PROVIDER=supabase` yalnız adapter ve bütün kapılar hazırken açıldı.
- [ ] Cloudflare'ın source of truth olmadığı runbookta açık.

## Observability ve operasyon

- [ ] Claim rate/latency/reject, lock wait/retry/deadlock dashboardları var.
- [ ] Realtime lag/gap/refetch/outbox dashboardları var.
- [ ] GPS anomaly/rate block/cell count/geometry timeout dashboardları var.
- [ ] Score drift ve map hash mismatch P1 alarmı var.
- [ ] Log redaction token/secret/raw GPS/PII örnekleriyle test edildi.
- [ ] Correlation ID HTTP -> command -> event -> outbox zincirinde aranabiliyor.
- [ ] P0/P1 incidentte `competitive_claims_enabled=false` read-only prosedürü
      tatbik edildi.
- [x] Account deletion raw points, claims, scores, media ve ilişkili kişisel
      veriyi doğrulanmış policy ile temizliyor; map invalidation/reconciliation
      koşuyor. Uzak smoke, Auth + profil + oyuncuya ait territory temizliğini ayrıca doğruladı.

## Son onay

- [ ] Backend/security review
- [ ] Database/PostGIS review
- [ ] Privacy/legal review
- [x] Mobile minimum/maximum viewport E2E — 320×568–480×800 matrisi ve 390×844 tam ürün yolculuğu geçti.
- [ ] Load/soak test
- [ ] Rollback/restore prova
- [ ] Ürün sahibi production claim açma onayı

Production dünya başlangıçta `draft` ve `competitive_claims_enabled=false` gelir.
Son iki alan ancak bu listenin kanıtları tamamlandıktan sonra kontrollü migration
veya admin runbookuyla etkinleştirilir.
