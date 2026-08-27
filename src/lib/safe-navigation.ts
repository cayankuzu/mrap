import { PROTECTED_ROUTE_PREFIXES } from "@/lib/auth-config";

const FALLBACK_ROUTE = "/home";

/** Accept only an in-app protected path; absolute/protocol-relative URLs fail closed. */
export function normalizeProtectedReturnPath(value: unknown, fallback = FALLBACK_ROUTE) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://mrap.invalid");
    if (parsed.origin !== "https://mrap.invalid") return fallback;
    const isProtected = PROTECTED_ROUTE_PREFIXES.some((prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`));
    return isProtected ? `${parsed.pathname}${parsed.search}` : fallback;
  } catch {
    return fallback;
  }
}
