import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check, Mail } from "lucide-react";

export const metadata: Metadata = { title: "E-posta doğrulama" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const parameters = await searchParams;
  const confirmed = parameters.status === "confirmed";
  const invalid = parameters.error === "invalid_confirmation";

  return (
    <div className="auth-success verify-email-page">
      <span>{confirmed ? <Check size={28} strokeWidth={3} /> : invalid ? <AlertCircle size={28} /> : <Mail size={28} />}</span>
      <h1>{confirmed ? "E-postan doğrulandı" : invalid ? "Bağlantı geçersiz veya süresi dolmuş" : "E-postanı doğrula"}</h1>
      <p>
        {confirmed
          ? "Hesabın artık güvenli. mrap’e girip ilk alanını kapatabilirsin."
          : invalid
            ? "Yeni bir doğrulama e-postası istemek için giriş ekranından hesabınla giriş yapmayı dene."
            : "Gelen kutundaki mrap doğrulama bağlantısını aç. E-posta doğrulanmadan hesaba giriş yapılamaz."}
      </p>
      <Link href={confirmed ? "/home" : "/login"} className="primary-button">
        {confirmed ? "mrap’e devam et" : "Giriş ekranına dön"} <ArrowRight size={18} />
      </Link>
    </div>
  );
}
