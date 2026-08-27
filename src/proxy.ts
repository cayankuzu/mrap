import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { hasOptimisticSessionCookie, PROTECTED_ROUTE_PREFIXES } from "@/lib/auth-config";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function supabaseProviderEnabled() {
  return (process.env.MRAP_DATA_PROVIDER ?? "sqlite").trim().toLocaleLowerCase("en-US") === "supabase";
}

async function refreshSupabaseSession(request: NextRequest, requestHeaders?: Headers) {
  let response = requestHeaders
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.next();
  if (!supabaseProviderEnabled() || !hasOptimisticSessionCookie(request.cookies.getAll())) {
    return { response, authenticated: hasOptimisticSessionCookie(request.cookies.getAll()) };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url || !publishableKey) return { response, authenticated: false };

  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = requestHeaders
          ? NextResponse.next({ request: { headers: requestHeaders } })
          : NextResponse.next();
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  const { data, error } = await client.auth.getUser();
  return { response, authenticated: !error && Boolean(data.user) };
}

export async function proxy(request: NextRequest) {
  const isProtectedPage = PROTECTED_ROUTE_PREFIXES.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));
  if (isProtectedPage) {
    const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    if (!hasOptimisticSessionCookie(request.cookies.getAll())) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", returnTo);
      return NextResponse.redirect(loginUrl);
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-mrap-return-to", returnTo);
    const refreshed = await refreshSupabaseSession(request, requestHeaders);
    if (supabaseProviderEnabled() && !refreshed.authenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", returnTo);
      const redirectResponse = NextResponse.redirect(loginUrl);
      for (const cookie of refreshed.response.cookies.getAll()) redirectResponse.cookies.set(cookie);
      return redirectResponse;
    }
    return refreshed.response;
  }

  if (!request.nextUrl.pathname.startsWith("/api/") || !unsafeMethods.has(request.method)) {
    return (await refreshSupabaseSession(request)).response;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return NextResponse.json({ error: "Güvenlik doğrulaması başarısız." }, { status: 403 });

  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.MRAP_CANONICAL_ORIGIN?.replace(/\/$/, "") || request.nextUrl.origin;
  if (!origin || origin !== expectedOrigin) return NextResponse.json({ error: "İstek kaynağı doğrulanamadı." }, { status: 403 });

  return (await refreshSupabaseSession(request)).response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/home/:path*",
    "/explore/:path*",
    "/play/:path*",
    "/leaderboard/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/notifications/:path*",
    "/posts/:path*",
    "/users/:path*",
  ],
};
