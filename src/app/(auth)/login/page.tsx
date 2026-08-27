import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Giriş yap" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <AuthForm mode="login" initialNext={(await searchParams).next} />;
}
