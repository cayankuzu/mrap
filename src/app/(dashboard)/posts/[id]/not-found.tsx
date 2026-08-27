import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export default function PostNotFound() {
  return (
    <div className="content-page post-detail-page">
      <section className="post-access-state">
        <span className="post-access-icon" aria-hidden="true"><LockKeyhole size={26} /></span>
        <span className="eyebrow">Gönderi kullanılamıyor</span>
        <h1>Bu gönderiye ulaşamıyoruz.</h1>
        <p>Gönderi kaldırılmış olabilir veya gizli hesap izinlerin bu içeriği görmene yetmiyor olabilir.</p>
        <Link href="/home" className="primary-button"><ArrowLeft size={17} /> Akışa dön</Link>
      </section>
    </div>
  );
}
