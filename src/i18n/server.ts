import "server-only";

import { getDictionary, resolveLocale } from "@/i18n";

/** Server Components and server utilities can use this without importing React context. */
export function getServerI18n(locale?: unknown) {
  const resolvedLocale = resolveLocale(locale);
  return { locale: resolvedLocale, dictionary: getDictionary(resolvedLocale) } as const;
}
