# mrap konum gizliliği

Bu belge ürünün kullanıcıya verdiği konum gizliliği sözüdür. Normatif mimari karar [ADR-004](./ADR-004-location-privacy.md), teknik güvenlik kontrolleri [SECURITY.md](./SECURITY.md) içindedir.

## Temel söz

**mrap gerçek zamanlı territory oyunudur; gerçek zamanlı oyuncu takip ürünü değildir.**

- Oyuncunun kesin konumu ve aktif rotası yalnız kendi ekranında görünür.
- Diğer oyuncular yalnız başarıyla commit edilmiş territory/paint sonucunu görür.
- Bir hesabın açık veya gizli olması canlı GPS kuralını değiştirmez.
- Ayarlardaki konum görünürlüğü kalıcı olarak `private`tır; kullanıcı bunu public moda çeviremez.
- Rakip markerı, tamamlanmamış rota veya kesin “yakındaki oyuncu” koordinatı MVP'de yayınlanmaz.

## Konum ne zaman kullanılır?

Tarayıcı konum izni kullanıcı rota başlatmayı seçtiğinde istenir. Rota oturumu dışında arka planda sürekli GPS takibi ürün sözleşmesi değildir. Oyuncu izni reddederse gerçek rota başlamaz; demo/geliştirme ortamında simülatör kullanılabilir.

İşlenen rota verisi şunları içerebilir:

- koordinat ve doğruluk,
- istemci gözlem zamanı,
- monoton sıra numarası,
- session/batch bütünlük bilgisi,
- hile ve veri kalitesi sınıflaması.

Bu verinin amacı rota doğrulama, loop candidate üretimi, mesafe hesabı ve oyuncunun kendi canlı UX'idir.

## Bağlantı kesintisi ve cihazdaki geçici kayıt

Aktif rota sırasında bağlantı kesilirse GPS sağlayıcısı görünür sekmede çalışmayı sürdürebilir; ancak bu noktalar rekabetçi komut kuyruğuna girmez. En fazla 512 çevrimdışı örnek, ilk örnekten itibaren en fazla 5 dakika ve hiçbir durumda rota lease süresini aşmayacak biçimde yalnız o sekmenin `sessionStorage` alanında kişisel rota taslağı olarak tutulur.

- Çevrimdışı taslak `/api/game/sessions/:id/points` gövdesine dönüştürülmez.
- Taslak noktaları loop, claim, ownership veya leaderboard hesabına katılmaz.
- Yeniden bağlantıda ACK'i belirsiz, daha önce online gözlenmiş noktalar sequence/idempotency kurallarıyla tamamlanır; ardından sunucu yeni bir online segment açar.
- TTL, kapasite veya tarayıcı depolama sınırı aşılırsa takip sessiz veri kaybetmek yerine duraklatılır ve Türkçe uyarı gösterilir.
- Başarılı rota bitirme, rota sıfırlama, çıkış ve hesap silme cihazdaki kuyruk ile taslağı temizler.

Bu kayıt başka sekmeyle veya başka kullanıcıyla paylaşılmaz; kalıcı çevrimdışı gezi arşivi değildir.

## Asla public payload olmayan veriler

- raw latitude/longitude noktaları,
- aktif veya tamamlanmamış rota,
- GPS accuracy geçmişi,
- session nonce ve point batch içeriği,
- risk kanıtı, IP veya cihaz izi.

Bunlar sosyal gönderi, bildirim, leaderboard, public profil, region patch veya public log alanı değildir. Paylaşılan harita kadrajı committed territory sonucunu gösterir; raw route değildir.

## Retention ve silme

Raw konum sınırsız saklanmaz. Yerel authoritative adapter yapılandırılmış retention süresini uygular; hedef production şemasında varsayılan süre 30 gündür ve bakım endpoint/migration sözleşmesi vardır.

Ancak production cronunun, alarmının ve yasal retention kararının canlı ortamda doğrulanması henüz tamamlanmamıştır. Bu nedenle release öncesinde [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) içindeki retention kapısı kapanmalıdır.

Hesap silme, kişisel rota/konum verisi için doğrulanmış silme politikası gerektirir. Canonical dünya bütünlüğünü etkileyen geçmiş eventler doğrudan sessizce silinmek yerine anonimleştirme veya compensating işlem politikasına göre ele alınmalıdır.

## Simülatör sınırı

- Simülatör demo ve development sandbox içindir.
- Production world, simülasyon session'ını sunucuda reddetmelidir.
- Simulator noktaları gerçek GPS ile aynı provider sözleşmesinden geçse de gerçek hareket kanıtı sayılmaz.

## GPS sahteciliği ve kalan risk

Web tarayıcısında GPS sahteciliğini yüzde yüz engellemek mümkün değildir. Server doğruluk, hız, ivme, sıra boşluğu, tekrar oynatma, teleport ve eşzamanlı session sinyalleriyle riski azaltır. Ele geçirilmiş hesap, kötü amaçlı tarayıcı eklentisi veya işletim sistemi seviyesindeki sahte konum kalan risktir.

## Gelecekte yaklaşık aktivite

Kesin konum yerine kaba region düzeyinde anonim bir aktif oyuncu sayacı ileride ayrıca tasarlanabilir. Böyle bir özellik mevcut MVP'nin tamamlanmış parçası değildir; privacy review, minimum kalabalık eşiği ve yeniden tanımlama riski değerlendirilmeden açılamaz.

Tehditler ve release engelleri [SECURITY_THREAT_MODEL.md](./SECURITY_THREAT_MODEL.md) içinde özetlenir.
