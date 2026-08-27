import { AlertCircle, Check } from "lucide-react";
import type { AvailabilityStatus } from "@/lib/use-account-availability";

export function AccountAvailabilityHint({ status, label }: { status: AvailabilityStatus; label: string }) {
  if (status === "idle") return null;
  const text = status === "checking" ? "Kontrol ediliyor…" : status === "available" ? `${label} kullanılabilir.` : status === "taken" ? `${label} daha önce kullanılmış.` : status === "invalid" ? `${label} biçimi geçerli değil.` : "Kontrol şu anda yapılamadı.";
  return <small className={`availability-hint is-${status}`} role="status" aria-live="polite">{status === "available" ? <Check size={13} /> : status === "taken" || status === "invalid" ? <AlertCircle size={13} /> : null}{text}</small>;
}
