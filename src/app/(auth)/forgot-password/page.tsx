import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";

export const metadata: Metadata = { title: "Şifremi unuttum" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; recovery?: string }> }) {
  const query = await searchParams;
  const token = supabaseProviderEnabled() && query.recovery === "1" ? "supabase-session" : query.token;
  return <AuthForm mode="forgot" initialResetToken={typeof token === "string" ? token : ""} />;
}
