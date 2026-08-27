# mrap başlangıç skorları

Skorlar 27 Ağustos 2026 tarihli, kaynak değişikliği öncesi kanıta dayanır. `9,8` yalnızca ilgili kategorinin zorunlu ölçümleri eksiksiz geçtiğinde verilebilir.

| No | Kategori | Başlangıç | Karar | Başlıca gerekçe |
|---:|---|---:|---|---|
| 1 | UI/UX ve görsel tutarlılık | 8,2 | FAIL | Yorumlar inline; panel standardı tutarsız |
| 2 | Responsive ve mobil uyumluluk | 8,5 | FAIL | Tam cihaz/zoom matrisi kanıtı yok |
| 3 | Performans ve Lighthouse | 7,2 | FAIL | Landing 82, harita 65; LCP hedef dışı |
| 4 | Güvenlik | 9,1 | FAIL | Audit temiz; yorum endpoint’i sertleştirilmeli |
| 5 | Modülerlik ve mimari | 8,8 | FAIL | Sağlam katmanlar; büyük modüller var |
| 6 | DRY ve tekrar kontrolü | 8,5 | FAIL | %1,56 tekrar ve sosyal akış duplikasyonu |
| 7 | Konfigürasyon yönetimi | 8,7 | FAIL | Bazı eşik ve limitlerin merkezi kanıtı eksik |
| 8 | State ve veri akışı | 9,0 | FAIL | Genel ayrım iyi; sosyal durum iki kez uygulanıyor |
| 9 | API ve realtime | 9,2 | FAIL | Oyun güçlü; yorum GET/cursor sözleşmesi yok |
| 10 | Erişilebilirlik | 9,2 | FAIL | Lighthouse 100; tam klavye/panel matrisi yok |
| 11 | Ölçeklenebilirlik | 6,8 | FAIL | Vercel ortak dünya runtime adaptörü yok |
| 12 | Hata yönetimi | 8,5 | FAIL | Temel yapı var; uçtan uca hata matrisi eksik |
| 13 | Test kapsamı ve kalitesi | 7,8 | FAIL | 208 test geçiyor; %82,01 satır/%69,90 dal |
| 14 | Türkçe ve i18n hazırlığı | 8,8 | FAIL | UI Türkçe; tam anahtar/audit kanıtı eksik |
| 15 | Offline ve zayıf ağ davranışı | 8,0 | FAIL | Kesinti belgeleri var; kullanıcı akışı kanıtı eksik |
| 16 | Bildirim ve deep-link | 8,5 | FAIL | Özellik var; tüm izin/deep-link matrisi eksik |
| 17 | Analitik ve gözlemlenebilirlik | 6,5 | FAIL | Tipli gizlilik adaptörü ve dashboard kanıtı yok |
| 18 | CI/CD kalite kapıları | 7,0 | FAIL | Temel check/build var; kapsam/perf/e2e kapısı yok |
| 19 | Dokümantasyon | 8,0 | FAIL | ADR’ler güçlü; istenen teslim paketi eksik |
| 20 | Sosyal özellik mantığı | 8,2 | FAIL | Beğeni/takip var; yorum liste/panel akışı eksik |
| 21 | Bağımlılık ve lisans sağlığı | 8,8 | FAIL | 0 açık; iki geometri lisansı ayrıca doğrulanmalı |
| 22 | Kaynak/bellek verimliliği | 8,4 | FAIL | Harita maliyeti yüksek; uzun oturum ölçümü yok |
| 23 | Tarayıcı uyumluluğu | 7,5 | FAIL | Chromium kanıtı var; Firefox/WebKit yok |
| 24 | Üretim ve PWA hazırlığı | 6,8 | FAIL | Ortak DB adapteri ve PWA/manifest/SW eksik |
| 25 | Due diligence hazırlığı | 7,5 | FAIL | Canlı altyapı kanıtı ve teslim paketi eksik |
| 26 | Kod okunabilirliği | 8,2 | FAIL | Strict TS; çok büyük bileşen/dosya mevcut |
| 27 | Profesyonellik | 8,6 | FAIL | Temel kalite iyi; release kanıtları tamamlanmamış |
| 28 | Mimari yapı | 8,6 | FAIL | 0 dairesel bağımlılık; sınırlar bazı yerlerde iri |
| 29 | Kod kalitesi | 8,2 | FAIL | Check temiz; kapsam/duplikasyon açığı var |
| 30 | KISS | 9,0 | FAIL | MVP odağı iyi; bazı ekran kodları gereğinden büyük |
| 31 | Hard-code azaltma | 8,5 | FAIL | Çoğu config’te; tüm limit/eşik envanteri eksik |
| 32 | Derin DRY incelemesi | 8,5 | FAIL | jscpd düşük; API/modal kalıpları tekrarlı |
| 33 | Kod seviyesi performans | 7,8 | FAIL | Harita chunk ve ana thread maliyeti yüksek |
| 34 | Test edilebilirlik | 8,7 | FAIL | Domain ayrımı iyi; bazı runtime parçaları kapsamsız |
| 35 | Genişletilebilirlik | 7,2 | FAIL | Migration hazırlığı var; runtime provider sınırı eksik |

**Aritmetik ortalama: 8,20 / 10**  
**Başlangıç sonucu: FAIL**
