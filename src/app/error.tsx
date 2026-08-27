"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { SystemState } from "@/components/SystemState";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <SystemState
      eyebrow="Beklenmeyen hata"
      title="Bu ekranı şu anda açamadık."
      description="Verilerin güvende. Bağlantını kontrol edip yeniden deneyebilir veya ana sayfaya dönebilirsin."
      icon={<TriangleAlert size={28} />}
    >
      <button type="button" className="primary-button" onClick={retry}><RotateCcw size={17} /> Yeniden dene</button>
      <Link href="/" className="secondary-button">Ana sayfaya dön</Link>
    </SystemState>
  );
}
