"use client";

import Link from "next/link";

export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="tr">
      <head><title>mrap · Bir hata oluştu</title></head>
      <body style={{ margin: 0, background: "#f4f5ef", color: "#15221b", fontFamily: '"Segoe UI", Arial, sans-serif' }}>
        <main style={{ display: "grid", minHeight: "100dvh", padding: 20, placeItems: "center" }}>
          <section style={{ width: "min(100%, 480px)", padding: "36px 28px", border: "1px solid #dfe4da", borderRadius: 24, background: "#fff", boxShadow: "0 20px 60px rgba(21,34,27,.10)", textAlign: "center" }}>
            <strong style={{ display: "block", marginBottom: 24, fontSize: 25, letterSpacing: "-.05em" }}>mrap</strong>
            <span style={{ display: "block", color: "#6d786f", fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>Sistem hatası</span>
            <h1 style={{ margin: "10px 0", fontSize: 28, lineHeight: 1.15 }}>Uygulamayı yeniden yükleyelim.</h1>
            <p style={{ margin: "0 auto 24px", maxWidth: 380, color: "#667268", lineHeight: 1.6 }}>Beklenmeyen bir sorun oluştu. Verilerin güvende; yeniden deneyebilir veya ana sayfaya dönebilirsin.</p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
              <button type="button" onClick={retry} style={{ minHeight: 46, padding: "0 18px", border: 0, borderRadius: 12, background: "#15221b", color: "#fff", font: "inherit", fontWeight: 800, cursor: "pointer" }}>Yeniden dene</button>
              <Link href="/" style={{ display: "inline-flex", minHeight: 46, padding: "0 18px", border: "1px solid #dfe4da", borderRadius: 12, color: "#15221b", fontWeight: 800, textDecoration: "none", alignItems: "center" }}>Ana sayfaya dön</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
