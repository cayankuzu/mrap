import { describe, expect, it } from "vitest";
import {
  citiesForCountry,
  COLOR_PALETTE_PAGES,
  DEFAULT_CITY_ID,
  DEFAULT_COUNTRY_CODE,
  isSupportedLocation,
  LOCATION_OPTIONS,
  normalizeRouteColor,
  PRODUCT_NAME,
  readableTextColor,
  resolveLocation,
  ROUTE_COLORS,
} from "@/lib/app-config";

describe("uygulama yapılandırması", () => {
  it("ürün adını tek ve doğru marka değeriyle sunar", () => {
    expect(PRODUCT_NAME).toBe("mrap");
  });

  it("36 benzersiz rengi üç adet 12'li grupta tutar", () => {
    expect(COLOR_PALETTE_PAGES).toHaveLength(3);
    expect(COLOR_PALETTE_PAGES.every((page) => page.colors.length === 12)).toBe(true);
    expect(ROUTE_COLORS).toHaveLength(36);
    expect(new Set(ROUTE_COLORS)).toHaveLength(36);
    expect(ROUTE_COLORS.every((color) => /^#[0-9A-F]{6}$/i.test(color))).toBe(true);
  });

  it("renkleri canonical palette allow-list ile sınırlar", () => {
    expect(normalizeRouteColor(ROUTE_COLORS[0].toLowerCase())).toBe(ROUTE_COLORS[0]);
    expect(normalizeRouteColor("#FFFFFF")).toBeNull();
    expect(normalizeRouteColor("#fff'); DROP TABLE users; --")).toBeNull();
  });

  it("her palet rengi için okunabilir bir metin rengi üretir", () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const color of ROUTE_COLORS) {
      const text = readableTextColor(color);
      const foreground = luminance(text);
      const background = luminance(color);
      const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("varsayılan ülke ve şehri desteklenen konumlarda bulur", () => {
    expect(isSupportedLocation(DEFAULT_COUNTRY_CODE, DEFAULT_CITY_ID)).toBe(true);
    expect(citiesForCountry(DEFAULT_COUNTRY_CODE).some((city) => city.id === DEFAULT_CITY_ID)).toBe(true);
    expect(resolveLocation(DEFAULT_COUNTRY_CODE, DEFAULT_CITY_ID)).toEqual({ country: "Türkiye", city: "İstanbul" });
  });

  it("ülke ve şehir listelerinde tekrar veya boş grup barındırmaz", () => {
    const countryCodes = LOCATION_OPTIONS.map((location) => location.code);
    expect(new Set(countryCodes)).toHaveLength(countryCodes.length);

    for (const location of LOCATION_OPTIONS) {
      expect(location.cities.length).toBeGreaterThan(0);
      expect(new Set(location.cities.map((city) => city.id))).toHaveLength(location.cities.length);
      expect(location.cities.every((city) => city.id.trim().length > 0 && city.label.trim().length > 0)).toBe(true);
    }
  });

  it("tanınmayan konumu kabul etmez", () => {
    expect(citiesForCountry("XX")).toEqual([]);
    expect(isSupportedLocation(DEFAULT_COUNTRY_CODE, "bilinmeyen-sehir")).toBe(false);
  });
});
