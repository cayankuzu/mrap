# mrap Cloudflare manuel kurulum

Durum: **MANUAL REQUIRED**

Cloudflare zone'u, Vercel proje bağlantısı ve gerçek özel alan adı bu repository kanıtıyla doğrulanmadı. Aşağıdaki adımlar hesap yetkisi gerektirir. Hiçbir DNS target, nameserver veya secret değeri tahmin edilmemelidir.

## A. Cloudflare'a alan adı ekleme

1. **Panel:** Cloudflare Dashboard  
   **Menü:** Websites → Add a domain  
   **Alan:** mrap için satın alınmış gerçek apex alan adı  
   **Girilecek değer:** Registrar'da sahip olunan doğrulanmış alan adı  
   **Proxy durumu:** Bu adımda uygulanamaz  
   **Beklenen sonuç:** Zone oluşur ve mevcut DNS kayıtları inceleme ekranına gelir.

2. Import edilen MX, SPF, DKIM, DMARC ve diğer kayıtları registrar kayıtlarıyla satır satır karşılaştır. Eksik e-posta kaydı varken nameserver değiştirme.

## B. Nameserver değiştirme

1. **Panel:** Cloudflare Dashboard  
   **Menü:** Overview → Nameservers  
   **Alan:** Atanan iki yetkili nameserver  
   **Girilecek değer:** `Cloudflare Dashboard tarafından verilen NS #1` ve `Cloudflare Dashboard tarafından verilen NS #2`  
   **Proxy durumu:** Uygulanamaz  
   **Beklenen sonuç:** Cloudflare zone durumu Active olur.

2. Aynı iki değeri registrar panelindeki nameserver alanına gir. Eski DNS zone'u hemen silme; yayılım ve e-posta doğrulanana kadar rollback için sakla.

## C. DNS kayıtları

1. **Panel:** Vercel Dashboard  
   **Menü:** Project → Settings → Domains  
   **Alan:** Gerçek apex ve gerekiyorsa `www`  
   **Girilecek değer:** Alan adlarını projeye ekle; Vercel'in her host için gösterdiği A/CNAME/TXT hedeflerini kopyala  
   **Proxy durumu:** Uygulanamaz  
   **Beklenen sonuç:** Vercel gerekli DNS hedeflerini gösterir.

2. **Panel:** Cloudflare Dashboard  
   **Menü:** DNS → Records  
   **Alan:** Aşağıdaki matris  
   **Girilecek değer:** Yalnız Vercel'in o anda verdiği değerler  
   **Proxy durumu:** DNS Only  
   **Beklenen sonuç:** Vercel domain ekranında Valid Configuration ve HTTPS sertifikası görünür.

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| Vercel'in istediği type | Apex host | Vercel domain inspection sonucu | DNS Only |
| Vercel'in istediği type | `www` | Vercel domain inspection sonucu | DNS Only |
| TXT/CNAME | Vercel verification adı | Vercel verification sonucu | DNS Only |

Web kaydını orange-cloud yapma. MX/SPF/DKIM/DMARC kayıtlarına dokunma. Canonical yönlendirme tercihini Vercel Domains ekranında tek yönlü tanımla ve her iki yönde redirect loop testi yap.

## D. Turnstile

1. **Panel:** Cloudflare Dashboard  
   **Menü:** Turnstile → Add widget  
   **Alan:** Widget name  
   **Girilecek değer:** `mrap Production`  
   **Proxy durumu:** Gerekmez; Turnstile DNS Only web hostuyla çalışır  
   **Beklenen sonuç:** Production site key ve secret key üretilir.

2. **Alan:** Hostname Management  
   **Girilecek değer:** Yalnız Vercel'de doğrulanmış gerçek apex ve `www` production hostları  
   **Proxy durumu:** Uygulanamaz  
   **Beklenen sonuç:** Başka hosttan üretilen token uygulamanın server allow-list kontrolünden geçmez.

3. Preview için production secret'ı kullanma. Sabit bir preview hostu varsa ayrı `mrap Preview` widget'ı ve ayrı key seti kullan; rastgele bütün `vercel.app` hostlarını production widget'a ekleme. Yerelde key olmadan uygulama çalışır; Cloudflare resmi test key'leriyle ayrı entegrasyon testi yapılabilir.

## E. R2

R2 bu implementasyonda kullanılmıyor. Bucket, public access, CORS veya R2 API tokenı oluşturma. Medya provider kararı ayrı ADR ve contract testleriyle verilmeden R2'yi production'a ekleme.

## F. Vercel environment

**Panel:** Vercel Dashboard  
**Menü:** Project → Settings → Environment Variables  
**Proxy durumu:** Uygulanamaz

| Key | Scope | Girilecek değer | Beklenen sonuç |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY` | Production, build-time public | Production widget site key | Kayıt ve şifre yenileme formunda challenge yüklenir |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Production, server-only | Aynı widget'ın secret key'i | Siteverify trusted server'dan çağrılır |
| `MRAP_TURNSTILE_EXPECTED_HOSTNAMES` | Production, server-only | Virgülle ayrılmış kesin apex ve `www` hostları | Yanlış hostname tokenı reddedilir |
| Aynı üç key | Preview | Ayrı preview widget değerleri | Production key preview'a sızmaz |

Key'lerden herhangi biri tanımlanırsa üçü de zorunludur; kısmi konfigürasyon auth mutation'ını 503 ile fail-closed tutar. Public site key dışındaki hiçbir değere `NEXT_PUBLIC_` prefix'i verme.

Değerleri girdikten sonra yeni deployment oluştur; public env değeri build anında sabitlenir. Ardından kayıt, şifremi unuttum, MapLibre, geolocation ve claim smoke testlerini gerçek production hostunda yeniden çalıştır.

## Son doğrulama

```text
Cloudflare code integration: hazır ve yerel test edilebilir
Cloudflare account configuration: MANUAL REQUIRED
Cloudflare web proxy: DNS Only
Vercel custom domain: MANUAL REQUIRED
R2: kullanılmıyor
Supabase runtime adapterları: kodda mevcut; uzak migration/RLS/realtime kabulü ayrıca gerekli
Production readiness: uzak Supabase kabulü, Vercel project/env, domain/DNS, Turnstile ve production E2E tamamlanana kadar FAIL
```
