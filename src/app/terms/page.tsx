import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/PublicInfoPage";

export const metadata: Metadata = { title: "Kullanım koşulları" };

export default function TermsPage() {
  return <PublicInfoPage eyebrow="Kullanım koşulları · 27 Ağustos 2026" title="Gerçek dünya önce güvenlik." intro="mrap, gerçek dünyada oynanan bir yürüyüş ve alan oyunudur. Oyun için trafiğe, özel mülke veya riskli bölgelere girmemelisin." sections={[{ title: "Güvenli hareket", body: "Ekrana değil çevrene odaklan. Yerel kurallara, yaya yollarına ve özel mülkiyet sınırlarına uy. Alan kazanmak hiçbir zaman fiziksel risk almaktan önemli değildir." }, { title: "Adil oyun", body: "Yanıltıcı konum kullanımı ve başkalarını taklit eden hesaplar topluluk deneyimine aykırıdır. Sanal konum seçeneği yalnızca geliştirme ve demo dünyasında çalışır; üretim ortamında sunucu tarafından reddedilir." }, { title: "Hesap ve içerik", body: "Kullanıcı adı ve e-posta adresi benzersiz bir hesapla ilişkilidir; yapılandırılan ortamda e-posta doğrulaması istenebilir. Paylaştığın başlık, açıklama ve görsellerden sen sorumlusun; yasa dışı, yanıltıcı veya başkasının haklarını ihlal eden içerik paylaşmamalısın." }, { title: "Deneme sürümü", body: "Bu sürüm geliştirme ve ürün doğrulama aşamasındadır; kesintisiz hizmet, ödeme veya ticari taahhüt içermez. Supabase bağlantıları ve e-posta doğrulama akışı kodda bulunsa da uzak veritabanı geçişleri, satır düzeyi güvenlik kuralları, özel alan adı, Cloudflare ve üretim uçtan uca testleri tamamlanmadan hizmet genel kullanıma hazır kabul edilmez." }]} />;
}
