import { CONTENT_LIMITS, DEFAULT_POST_TITLE } from "@/lib/content-limits";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_CHARACTERS_PATTERN = /^[\p{L}\p{N}_]+$/u;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").normalize("NFKC").toLocaleLowerCase("tr-TR");
}

export function isValidEmail(value: string) {
  const normalized = normalizeEmail(value);
  return normalized.length <= CONTENT_LIMITS.email.max && EMAIL_PATTERN.test(normalized);
}

export function isValidUsername(value: string) {
  const normalized = normalizeUsername(value);
  const length = [...normalized].length;
  return length >= CONTENT_LIMITS.username.min
    && length <= CONTENT_LIMITS.username.max
    && USERNAME_CHARACTERS_PATTERN.test(normalized);
}

export function resolvePostTitle(value: unknown, body: string) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (requested) return requested;
  const firstLine = body.trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine.slice(0, CONTENT_LIMITS.postTitle.max) || DEFAULT_POST_TITLE;
}

export function parseIsoCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}
