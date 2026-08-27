const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE = /\s+/g;

/**
 * Produces the same searchable form for Turkish dotted/dotless I and accented
 * Latin characters. This intentionally folds diacritics so `cayan` finds
 * `Çayan`, while the original display value is never changed.
 */
export function normalizeUserSearchText(value: string) {
  return value
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replaceAll("ı", "i")
    .replace(WHITESPACE, " ");
}

export function buildUserSearchKey(username: string, displayName = "") {
  return `${normalizeUserSearchText(username)} ${normalizeUserSearchText(displayName)}`.trim();
}

export function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
