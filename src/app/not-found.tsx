import Link from "next/link";
import { ArrowLeft, MapPinOff } from "lucide-react";
import { SystemState } from "@/components/SystemState";

export default function NotFound() {
  return (
    <SystemState
      eyebrow="404 · Yol burada bitiyor"
      title="Aradığın sayfayı bulamadık."
      description="Bağlantı değişmiş veya içerik kaldırılmış olabilir. Ana sayfaya dönerek keşfetmeye devam edebilirsin."
      icon={<MapPinOff size={28} />}
    >
      <Link href="/" className="primary-button"><ArrowLeft size={17} /> Ana sayfaya dön</Link>
    </SystemState>
  );
}
