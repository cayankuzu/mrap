import type { Metadata, Viewport } from "next";
import { AnalyticsReporter } from "@/components/AnalyticsReporter";
import { I18nProvider } from "@/i18n/I18nProvider";
import { DEFAULT_LOCALE, PRODUCT_NAME } from "@/lib/app-config";
import { resolvePublicOrigin } from "@/lib/public-origin";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(resolvePublicOrigin()),
  applicationName: PRODUCT_NAME,
  title: {
    default: `${PRODUCT_NAME} — Şehri adımlarınla sar`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description:
    "Yürüdüğün rotaları kapat, şehrin gerçek haritasında alanını oluştur ve arkadaşlarınla yarış.",
  manifest: "/manifest.webmanifest",
  authors: [{ name: "MeMoDe" }],
  creator: "MeMoDe",
  publisher: "MeMoDe",
  category: "oyun",
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: PRODUCT_NAME, statusBarStyle: "default" },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    siteName: PRODUCT_NAME,
    title: `${PRODUCT_NAME} — Şehri adımlarınla sar`,
    description: "Rotanı kapat, alanını oluştur ve şehrin ortak oyun haritasında yarış.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PRODUCT_NAME} — Şehri adımlarınla sar`,
    description: "Rotanı kapat, alanını oluştur ve şehrin ortak oyun haritasında yarış.",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f7f8f3",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" data-scroll-behavior="smooth">
      <body>
        <I18nProvider locale={DEFAULT_LOCALE}>{children}</I18nProvider>
        <AnalyticsReporter />
      </body>
    </html>
  );
}
