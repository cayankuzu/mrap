import type { Metadata } from "next";
import { PublicInfoPage } from "@/components/PublicInfoPage";

export const metadata: Metadata = { title: "Yardım" };

export default function HelpPage() {
  return <PublicInfoPage eyebrow="mrap yardım" title="İlk alanını üç adımda kapat." intro="Haritaya geç, konum yöntemini seç ve kendi aktif rotana ya da sahip olduğun alan sınırına yeniden temas ederek kapalı bir döngü oluştur." sections={[{ title: "Gerçek konum", body: "Harita ekranında Gerçek konum seçeneğini seç, Harekete geç düğmesine bas ve tarayıcı iznini onayla. Canlı rota yalnızca kendi ekranında görünür." }, { title: "Masaüstü testi", body: "Sanal konum seçeneğinde Harekete geç düğmesine bas. WASD veya yön tuşlarıyla hareket et; hız, konumu taşıma, sıfırlama ve takip kontrolleri konum test panelindedir." }, { title: "Alanı kapatma", body: "Geçerli bir döngü bulunduğunda mrap seni uyarır. Alanı kapat seçeneğiyle alanını kaydedebilir veya Devam et seçeneğiyle aynı oturumda yeni bir stratejik döngü arayabilirsin." }, { title: "Paylaşım", body: "Alan kaydedildikten sonra Ana sayfada paylaşım oluştur. İlgili alanını seç, harita kadrajını ayarla; başlık, açıklama ve istersen en fazla altı fotoğraf ekle." }]} />;
}
