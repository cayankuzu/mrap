export const SESSION_COOKIE = "mrap_session";

type CookieLike = Readonly<{ name: string; value?: string }>;

/** Proxy performs only an optimistic cookie-presence check; authorization is
 * always repeated with the authoritative provider in the page/Route Handler. */
export function hasOptimisticSessionCookie(
  cookies: readonly CookieLike[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if ((environment.MRAP_DATA_PROVIDER ?? "sqlite").trim().toLocaleLowerCase("en-US") !== "supabase") {
    return cookies.some((cookie) => cookie.name === SESSION_COOKIE && Boolean(cookie.value));
  }
  const projectRef = environment.SUPABASE_PROJECT_REF?.trim();
  if (!projectRef) return false;
  const cookiePrefix = `sb-${projectRef}-auth-token`;
  return cookies.some((cookie) => (
    (cookie.name === cookiePrefix || cookie.name.startsWith(`${cookiePrefix}.`))
    && Boolean(cookie.value)
  ));
}

export const PROTECTED_ROUTE_PREFIXES = Object.freeze([
  "/home",
  "/explore",
  "/play",
  "/leaderboard",
  "/profile",
  "/settings",
  "/notifications",
  "/posts",
  "/users",
]);
