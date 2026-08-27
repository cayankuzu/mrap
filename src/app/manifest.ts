import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@/lib/app-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${PRODUCT_NAME} — Şehri adımlarınla sar`,
    short_name: PRODUCT_NAME,
    description: "Rotanı kapat, alanını oluştur ve şehrin ortak oyun haritasında yarış.",
    lang: "tr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f8f3",
    theme_color: "#f7f8f3",
    categories: ["games", "social", "navigation"],
    icons: [
      { src: "/icon.png", sizes: "500x500", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Ana sayfa", short_name: "Akış", url: "/home" },
      { name: "Haritayı aç", short_name: "Harita", url: "/play" },
    ],
  };
}
