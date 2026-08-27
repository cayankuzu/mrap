"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, LogOut, Settings, Share2, UserPlus } from "lucide-react";
import { useShellExit } from "@/components/ShellExitContext";

export function ProfileActions({ settingsHref = "/settings", demo = false }: { settingsHref?: string; demo?: boolean }) {
  const [copied, setCopied] = useState(false);
  const requestExit = useShellExit();

  async function share() {
    await navigator.clipboard?.writeText(location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return <div className="profile-actions" role="toolbar" aria-label="Profil işlemleri">
    <button type="button" className="secondary-button profile-share-action" onClick={share} aria-label={copied ? "Profil bağlantısı kopyalandı" : "Profili paylaş"}>{copied ? <Check size={17} /> : <Share2 size={17} />} <span className="profile-action-label">{copied ? "Kopyalandı" : "Paylaş"}</span></button>
    <Link href={settingsHref} className="secondary-button" aria-label="Profil ayarlarını aç" title="Ayarlar"><Settings size={17} /> <span className="profile-action-label">Ayarlar</span></Link>
    {demo ? <>
      <Link href="/register" className="secondary-button profile-demo-mobile-action" aria-label="Gerçek hesap oluştur" title="Gerçek hesap oluştur"><UserPlus size={17} /> <span className="profile-action-label">Gerçek hesap oluştur</span></Link>
      <button type="button" className="secondary-button profile-demo-mobile-action" onClick={requestExit} aria-label="Demodan çık" title="Demodan çık" aria-haspopup="dialog"><LogOut size={17} /> <span className="profile-action-label">Demodan çık</span></button>
    </> : null}
  </div>;
}
