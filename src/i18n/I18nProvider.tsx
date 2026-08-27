"use client";

import { createContext, useContext, useMemo } from "react";
import { getDictionary, resolveLocale } from "@/i18n";
import type { AppLocale, TranslationDictionary } from "@/i18n";

type I18nContextValue = {
  locale: AppLocale;
  dictionary: TranslationDictionary;
};

const defaultLocale = resolveLocale(undefined);
const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  dictionary: getDictionary(defaultLocale),
});

export function I18nProvider({ children, locale }: { children: React.ReactNode; locale?: unknown }) {
  const resolvedLocale = resolveLocale(locale);
  const value = useMemo<I18nContextValue>(() => ({
    locale: resolvedLocale,
    dictionary: getDictionary(resolvedLocale),
  }), [resolvedLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
