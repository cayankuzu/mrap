import type { tr } from "@/i18n/tr";

type WidenDictionaryLeaves<Value> = Value extends string
  ? string
  : Value extends ReadonlyArray<infer Item>
    ? ReadonlyArray<WidenDictionaryLeaves<Item>>
    : Value extends object
      ? { [Key in keyof Value]: WidenDictionaryLeaves<Value[Key]> }
      : Value;

/**
 * The Turkish source dictionary is the schema for every future locale.
 * Literal values are widened to strings while namespaces and keys stay exact.
 */
export type TranslationDictionary = WidenDictionaryLeaves<typeof tr>;

export type DictionaryRegistry<Locale extends string> = {
  readonly fallbackLocale: Locale;
  readonly locales: readonly Locale[];
  readonly dictionaries: Readonly<Record<Locale, TranslationDictionary>>;
  hasLocale(value: unknown): value is Locale;
  resolveLocale(value: unknown): Locale;
  getDictionary(value?: unknown): TranslationDictionary;
};
