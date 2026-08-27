import type { DictionaryRegistry, TranslationDictionary } from "@/i18n/types";

export function createDictionaryRegistry<
  const Dictionaries extends Record<string, TranslationDictionary>,
  const FallbackLocale extends keyof Dictionaries & string,
>(dictionaries: Dictionaries, fallbackLocale: FallbackLocale): DictionaryRegistry<keyof Dictionaries & string> {
  type Locale = keyof Dictionaries & string;
  const locales = Object.freeze(Object.keys(dictionaries)) as readonly Locale[];
  const localeSet = new Set<string>(locales);

  function hasLocale(value: unknown): value is Locale {
    return typeof value === "string" && localeSet.has(value);
  }

  function resolveLocale(value: unknown): Locale {
    return hasLocale(value) ? value : fallbackLocale;
  }

  return Object.freeze({
    fallbackLocale,
    locales,
    dictionaries,
    hasLocale,
    resolveLocale,
    getDictionary(value?: unknown) {
      return dictionaries[resolveLocale(value)];
    },
  });
}
