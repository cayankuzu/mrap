import { NextResponse } from "next/server";
import { createMrapSupabaseServerClient } from "@/lib/supabase/server-client";
import { supabaseProviderEnabled } from "@/lib/supabase/server-config";

function callbackDestination(requestUrl: URL) {
  return requestUrl.searchParams.get("next") === "/forgot-password?recovery=1"
    ? "/forgot-password?recovery=1"
    : "/verify-email?status=confirmed";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const recoveryFlow = requestUrl.searchParams.get("next") === "/forgot-password?recovery=1";
  const errorUrl = new URL(recoveryFlow ? "/forgot-password" : "/verify-email", requestUrl.origin);
  errorUrl.searchParams.set("error", recoveryFlow ? "invalid_recovery" : "invalid_confirmation");
  if (!supabaseProviderEnabled()) return NextResponse.redirect(errorUrl);

  const code = requestUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(errorUrl);

  const client = await createMrapSupabaseServerClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(errorUrl);

  return NextResponse.redirect(new URL(callbackDestination(requestUrl), requestUrl.origin));
}
