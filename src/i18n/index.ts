import { DEFAULT_LOCALE } from "@/lib/app-config";
import type { AppLocale } from "@/lib/app-config";
import { createDictionaryRegistry } from "@/i18n/registry";
import { tr } from "@/i18n/tr";
import type { TranslationDictionary } from "@/i18n/types";

export const dictionaries = { tr } as const satisfies Record<AppLocale, TranslationDictionary>;
export const i18n = createDictionaryRegistry(dictionaries, DEFAULT_LOCALE);

export const isAppLocale = i18n.hasLocale;
export const resolveLocale = i18n.resolveLocale;
export const getDictionary = i18n.getDictionary;
export const defaultDictionary = getDictionary();

export { createDictionaryRegistry } from "@/i18n/registry";
export type { AppLocale } from "@/lib/app-config";
export type { DictionaryRegistry, TranslationDictionary } from "@/i18n/types";
