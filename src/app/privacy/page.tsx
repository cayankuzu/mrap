import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/PublicInfoPage";

export const metadata: Metadata = { title: "Gizlilik" };

export default function PrivacyPage() {
  return <PublicInfoPage eyebrow="Gizlilik özeti · 27 Ağustos 2026" title="Konumunun kontrolü sende." intro="mrap yalnızca sen izin verdiğinde konumunu kullanır. Canlı konum noktaların ve aktif rotan diğer oyunculara gösterilmez." sections={[
    { title: "Konum verisi ve amaç", body: "Konum kaydı yalnızca Harekete geç komutuyla, oyun alanını doğrulamak ve rotanı ölçmek için başlar; takip durdurulduğunda biter. İşlemenin dayanağı açık kullanıcı eylemi ve oyun hizmetinin sunulmasıdır. Diğer oyuncular yalnızca sunucunun onayladığı güncel sahiplik alanlarını görür." },
    { title: "Saklama ve silme", body: "Ham rota noktaları için sistemin varsayılan saklama sınırı 30 gündür; süresi dolan kayıtları temizleyen bakım görevinin üretim ortamında etkinliği ayrıca doğrulanır. Çıkışta tamamlanmamış rotanın ham noktaları kaldırılır. Ayarlar ekranındaki Hesabı sil işlemi hesapla ilişkili uygulama verilerini ve hesabı siler. Kanunen saklanması gereken bir kayıt türü eklenirse süresi ve amacı bu metinde yayımlanmadan genel kullanıma açılmaz." },
    { title: "Harita sağlayıcısı", body: "Harita görünümü OpenFreeMap ve OpenStreetMap kaynaklı katmanları kullanır. Haritayı açtığında tarayıcın bu sağlayıcıdan görüntülenen bölgenin karo verisini ister; bu istek sağlayıcıya IP adresi ve yaklaşık görüntülenen harita bölgesi gibi standart ağ bilgilerini gösterebilir. Bu, konumunun başka oyunculara gösterildiği anlamına gelmez." },
    { title: "Ülke ve şehir kataloğu", body: "Kayıt ve profil konum seçimlerinde Countries States Cities Database kaynaklı, ODbL 1.0 lisanslı ülke ve şehir kataloğu kullanılır. Katalog tarayıcı paketine topluca eklenmez; seçtiğin ülke ve yazdığın arama yalnızca uygun şehir seçeneklerini getirmek için sunucuda işlenir." },
    { title: "Hesap, medya ve hizmet sağlayıcıları", body: "E-posta adresin hesap oluşturma, giriş, doğrulama ve parola yenileme için kullanılır. Eklediğin profil görselleri ve gönderi fotoğrafları seçtiğin içerikle sınırlıdır. Yerel geliştirmede veriler bu bilgisayardaki SQLite veritabanında; Supabase yapılandırılan ortamda ise Supabase kimlik doğrulaması, Postgres/PostGIS ve özel medya depolamasında işlenir. Sağlayıcılar arasında sessiz veri geçişi yapılmaz." },
    { title: "Üretim durumu", body: "Supabase ve sunucu otoriteli oyun bağlantılarının kodda bulunması, canlı üretim yayınının tamamlandığı anlamına gelmez. Özel alan adı, Cloudflare güvenlik ayarları, uzak veritabanı kuralları ve saklama görevi doğrulanmadan hizmet genel kullanıma hazır kabul edilmez." },
    { title: "Cihazdaki veriler", body: "Yarım kalan paylaşım taslağı ve etkin rota kurtarma anahtarı yalnızca oturum depolamasında kullanıcıya özel tutulur. Başarılı çıkış veya hesap silme işleminde gerçek hesaba ait bu anahtarlar temizlenir. Demo profili ayrı tutulur." },
  ]} />;
}
