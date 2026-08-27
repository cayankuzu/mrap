import { describe, expect, it } from "vitest";
import { createDictionaryRegistry, defaultDictionary, dictionaries, getDictionary, isAppLocale, resolveLocale } from "@/i18n";
import type { TranslationDictionary } from "@/i18n";
import { formatMessage } from "@/i18n/format";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@/lib/app-config";

describe("yerelleştirme temeli", () => {
  it("Türkçeyi varsayılan ve desteklenen dil olarak kullanır", () => {
    expect(DEFAULT_LOCALE).toBe("tr");
    expect(SUPPORTED_LOCALES).toContain(DEFAULT_LOCALE);
    expect(Object.keys(dictionaries)).toEqual([...SUPPORTED_LOCALES]);
    expect(getDictionary()).toBe(defaultDictionary);
    expect(isAppLocale("tr")).toBe(true);
    expect(isAppLocale("en")).toBe(false);
    expect(resolveLocale("desteklenmeyen-dil")).toBe(DEFAULT_LOCALE);
    expect(getDictionary("desteklenmeyen-dil")).toBe(defaultDictionary);
  });

  it("ortak arayüz metinlerini Türkçe sözlükten sunar", () => {
    expect(defaultDictionary.navigation).toMatchObject({
      home: "Ana sayfa",
      explore: "Keşfet",
      map: "Harita",
      leaderboard: "Sıralama",
      profile: "Profil",
    });
    expect(defaultDictionary.common.logout).toBe("Çıkış yap");
  });

  it("ana ürün yüzeylerinin her biri için typed bir ad alanı sunar", () => {
    expect(Object.keys(defaultDictionary)).toEqual(expect.arrayContaining([
      "common",
      "navigation",
      "shell",
      "auth",
      "feed",
      "social",
      "profile",
      "settings",
      "game",
      "leaderboard",
      "dialogs",
      "errors",
    ]));
  });

  it("bileşen değiştirmeden yalnızca sözlük kaydıyla yeni locale eklenmesini destekler", () => {
    const fixtureDictionary = {
      ...defaultDictionary,
      navigation: { ...defaultDictionary.navigation, home: "Fixture home" },
      auth: { ...defaultDictionary.auth, login: "Fixture login" },
    } satisfies TranslationDictionary;
    const registry = createDictionaryRegistry({ tr: defaultDictionary, fixture: fixtureDictionary }, "tr");

    expect(registry.locales).toEqual(["tr", "fixture"]);
    expect(registry.hasLocale("fixture")).toBe(true);
    expect(registry.getDictionary("fixture").navigation.home).toBe("Fixture home");
    expect(registry.getDictionary("bilinmeyen")).toBe(defaultDictionary);
  });

  it("dinamik metinleri eksik değişkenleri bozmadan yerleştirir", () => {
    expect(formatMessage("{count} alan · {distance} km", { count: 2, distance: "1,4" })).toBe("2 alan · 1,4 km");
    expect(formatMessage("{missing} korunur", {})).toBe("{missing} korunur");
  });
});
