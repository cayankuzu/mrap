# mrap bağımlılık ve lisans envanteri

Bu belge, 27 Ağustos 2026 tarihinde `package-lock.json`, kurulu bağımlılık ağacı ve npm registry advisory verisi yeniden taranarak oluşturulmuştur. Hukuk görüşü değildir; dağıtım öncesinde lisans yükümlülükleri yetkili incelemeyle onaylanmalıdır.

Makine tarafından okunabilir tam kanıt [dependencies-final.json](../artifacts/audit/dependencies-final.json) dosyasındadır.

## Doğrulanmış bağımlılık durumu

- Lockfile v3 paket kaydı: **543** (proje kökü hariç).
- Production işaretli kayıt: **123**.
- Development işaretli kayıt: **420**.
- Optional kayıt: **93**; bu sayı production/development sınıflarıyla çakışır ve toplama ayrıca eklenmez.
- Dev-optional kayıt: **4**.
- Doğrudan bağımlılık: **19 production + 10 development = 29**.
- `npm ls --all --json`: exit 0, invalid/missing problem **0**.
- `npm ls --all --omit=dev --json`: exit 0, invalid/missing problem **0**.
- `npm audit --json` ve `npm audit --omit=dev --json`: exit 0; info/low/moderate/high/critical açıkların her biri **0**.
- Lockfile mevcut; CI kurulumu `npm ci` kullanır.

`npm ls` tam grafikte 1.099 çözümlenmiş dependency occurrence ve 105 sürümsüz optional/peer-optional stub; production grafiğinde 223 çözümlenmiş occurrence ve 35 stub bildirdi. Bu sürümsüz optional stub'lar `npm ls` problemi değildir. Audit sonucu yalnız tarama anındaki registry advisory verisini temsil eder; gelecekteki veya henüz açıklanmamış açıklar için garanti değildir.

## Grafik değişikliği

- `@turf/turf` meta paketi kaldırıldı; kullanılan 14 Turf modülü doğrudan bağımlılık oldu.
- `@vitest/coverage-v8` doğrudan development bağımlılığı olarak eklendi.
- Önceki belgelenmiş envantere göre lockfile kayıt sayısı 633'ten 543'e, production işaretli kayıt sayısı 225'ten 123'e düştü. Development kayıt sayısı 408'den 420'ye çıktı.

## Doğrudan production bağımlılıkları

| Paket                            | İstenen aralık | Çözümlenen sürüm | Lisans metadata'sı |
| -------------------------------- | -------------- | ---------------- | ------------------ |
| `@turf/area`                     | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/bbox`                     | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/boolean-intersects`       | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/boolean-point-in-polygon` | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/boolean-valid`            | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/difference`               | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/distance`                 | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/helpers`                  | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/intersect`                | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/kinks`                    | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/length`                   | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/line-intersect`           | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/nearest-point-on-line`    | `^7.4.0`       | 7.4.0            | MIT                |
| `@turf/union`                    | `^7.4.0`       | 7.4.0            | MIT                |
| `lucide-react`                   | `^0.468.0`     | 0.468.0          | ISC                |
| `maplibre-gl`                    | `^6.6.0`       | 6.6.0            | BSD-3-Clause       |
| `next`                           | `16.3.3`       | 16.3.3           | MIT                |
| `react`                          | `^19.2.0`      | 19.2.8           | MIT                |
| `react-dom`                      | `^19.2.0`      | 19.2.8           | MIT                |

## Doğrudan development bağımlılıkları

| Paket                  | İstenen aralık | Çözümlenen sürüm | Lisans metadata'sı |
| ---------------------- | -------------- | ---------------- | ------------------ |
| `@axe-core/playwright` | `^4.13.0`      | 4.13.0           | MPL-2.0            |
| `@playwright/test`     | `^1.62.1`      | 1.62.1           | Apache-2.0         |
| `@types/node`          | `^22.10.2`     | 22.20.1          | MIT                |
| `@types/react`         | `^19.0.2`      | 19.2.18          | MIT                |
| `@types/react-dom`     | `^19.0.2`      | 19.2.5           | MIT                |
| `@vitest/coverage-v8`  | `^4.1.11`      | 4.1.11           | MIT                |
| `eslint`               | `^9.17.0`      | 9.39.5           | MIT                |
| `eslint-config-next`   | `16.3.3`       | 16.3.3           | MIT                |
| `typescript`           | `^5.7.2`       | 5.9.3            | Apache-2.0         |
| `vitest`               | `^4.1.11`      | 4.1.11           | MIT                |

## Lockfile lisans dağılımı

| Lisans metadata değeri                   | Paket sayısı |
| ---------------------------------------- | -----------: |
| MIT                                      |          420 |
| Apache-2.0                               |           38 |
| ISC                                      |           31 |
| MPL-2.0                                  |           14 |
| LGPL-3.0-or-later                        |           10 |
| BSD-2-Clause                             |            9 |
| BSD-3-Clause                             |            8 |
| Apache-2.0 AND LGPL-3.0-or-later         |            3 |
| Unlicense                                |            2 |
| (MIT OR Apache-2.0)                      |            1 |
| 0BSD                                     |            1 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT |            1 |
| BDS-3-Clause                             |            1 |
| BlueOak-1.0.0                            |            1 |
| CC-BY-4.0                                |            1 |
| CC0-1.0                                  |            1 |
| Python-2.0                               |            1 |
| **Toplam**                               |      **543** |

Lockfile kayıtlarının tamamında bir `license` metadata değeri vardır. Mevcut platformda kurulu 458 paketin `package.json` lisansı lockfile ile karşılaştırıldı: eksik lisans 0, uyuşmazlık 0. Bu Windows kurulumunda bulunmayan diğer 85 kayıt platforma özgü optional paketlerdir; lisansları yalnız lockfile metadata'sı üzerinden doğrulanmıştır.

## Elle inceleme gerektiren lisans riskleri

- `splaytree-ts@1.0.2`, metadata içinde `BDS-3-Clause` taşır. Paketle gelen `LICENSE` dosyası “BSD 3-Clause License” ile başlasa da metadata geçerli görünen bir BSD SPDX kimliği değildir. Upstream düzeltmesi veya hukuk onaylı manuel override olmadan bu kayıt “tam çözüldü” sayılmaz.
- `@img/sharp-libvips-*` optional paketleri `LGPL-3.0-or-later`; bazı `@img/sharp-*` paketleri birleşik Apache/LGPL/MIT ifadeleri taşır. Gerçekte dağıtılan platform binary'si için notice ve yeniden dağıtım yükümlülükleri ayrıca doğrulanmalıdır.
- OpenFreeMap/OpenStreetMap tile ve veri attribution yükümlülüğü npm paket lisanslarından ayrıdır; sağlayıcı attribution'ı haritada görünür kalmalıdır.
- Eksik lockfile lisans metadata sayısının 0 olması, bütün metadata'nın hukuken doğru olduğu veya lisans çatışmasının bulunmadığı anlamına gelmez.

Önceki envanterde eksik metadata taşıyan `arc@0.2.0`, Turf meta paketinin kaldırılmasıyla güncel grafikte artık bulunmuyor. Bu, `splaytree-ts` metadata belirsizliğini veya platform binary yükümlülüklerini ortadan kaldırmaz.

## Güncelleme durumu

`npm outdated --json` beklenen exit 1 ile dört doğrudan araçta major “latest” farkı bildirdi: `@types/node` 22.20.1 → 26.4.0, `eslint` 9.39.5 → 10.9.1, `lucide-react` 0.468.0 → 1.34.0 ve `typescript` 5.9.3 → 7.0.2. Bu tek başına güvenlik açığı değildir; major yükseltmeler changelog, framework uyumu, build ve tam regresyon sonrasında yapılmalıdır.

## Kalan release kanıtları

- Kullanılmayan dependency taraması yapılmadı.
- CI, production bağımlılıkları için standart CycloneDX SBOM üretip 30 günlük `mrap-production-sbom` artifaktı olarak saklar; release'e ait başarılı workflow artifaktı ayrıca korunmalıdır.
- Lisans allow/deny politikası CI içinde uygulanmıyor.
- Package provenance/signature kontrolü CI kalite kapısı değildir.
- Bundle katkısı paket bazında analyzer raporuyla ayrıştırılmadı.

Bu maddeler ve elle inceleme kayıtları kapanmadan “lisans çatışması 0” veya “supply-chain riski yok” iddiası yapılmaz.
