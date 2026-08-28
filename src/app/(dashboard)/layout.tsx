import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { requireCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
