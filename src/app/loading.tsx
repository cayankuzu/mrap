import { LoaderCircle } from "lucide-react";
import { SystemState } from "@/components/SystemState";

export default function Loading() {
  return (
    <SystemState
      eyebrow="mrap hazırlanıyor"
      title="Harita yükleniyor…"
      description="Alanlar ve son hareketler güvenli biçimde getiriliyor."
      icon={<LoaderCircle size={28} />}
      loading
    />
  );
}
