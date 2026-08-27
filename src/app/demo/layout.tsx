import type { Metadata } from "next";
import { DemoShell } from "@/components/DemoProfileProvider";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell>{children}</DemoShell>;
}
