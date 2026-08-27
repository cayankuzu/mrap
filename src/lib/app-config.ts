export const PRODUCT_NAME = "mrap";
export const SUPPORTED_LOCALES = ["tr"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "tr";

export const COLOR_PALETTE_PAGES = [
  {
    id: "canli",
    label: "Canlı renkler",
    colors: ["#0D8BFF", "#00A4A6", "#12CDB0", "#35B85A", "#8CCF32", "#F2B632", "#FF7A21", "#E5543E", "#E53935", "#FF5D7D", "#D84FD8", "#8F7CFF"],
  },
  {
    id: "acik",
    label: "Açık tonlar",
    colors: ["#64B5F6", "#4DD0E1", "#80CBC4", "#81C784", "#AED581", "#FFD54F", "#FFB74D", "#FF8A80", "#F48FB1", "#CE93D8", "#B39DDB", "#7986CB"],
  },
  {
    id: "koyu",
    label: "Koyu tonlar",
    colors: ["#0D47A1", "#1677D2", "#006064", "#00796B", "#1B5E20", "#667A22", "#B7791F", "#795548", "#8E2430", "#7B1FA2", "#3949AB", "#15221B"],
  },
] as const;

export const ROUTE_COLORS = COLOR_PALETTE_PAGES.flatMap((page) => [...page.colors]);
const ROUTE_COLOR_SET = new Set<string>(ROUTE_COLORS);

/** Canonicalizes a user-supplied palette color; arbitrary hex colors are rejected. */
export function normalizeRouteColor(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ROUTE_COLOR_SET.has(normalized) ? normalized : null;
}

export const SUPPORTED_LOCATIONS = [
  {
    code: "TR",
    country: "Türkiye",
    cities: [
      "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya", "Ardahan", "Artvin", "Aydın",
      "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale",
      "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep",
      "Giresun", "Gümüşhane", "Hakkâri", "Hatay", "Iğdır", "Isparta", "İstanbul", "İzmir", "Kahramanmaraş", "Karabük", "Karaman",
      "Kars", "Kastamonu", "Kayseri", "Kilis", "Kırıkkale", "Kırklareli", "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya",
      "Manisa", "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye", "Rize", "Sakarya", "Samsun",
      "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova",
      "Yozgat", "Zonguldak",
    ],
  },
  { code: "DE", country: "Almanya", cities: ["Berlin", "Hamburg", "Münih", "Köln", "Frankfurt", "Stuttgart", "Düsseldorf"] },
  { code: "US", country: "Amerika Birleşik Devletleri", cities: ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco", "Seattle", "Boston"] },
  { code: "GB", country: "Birleşik Krallık", cities: ["Londra", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Liverpool"] },
  { code: "FR", country: "Fransa", cities: ["Paris", "Marsilya", "Lyon", "Toulouse", "Nice", "Bordeaux"] },
  { code: "NL", country: "Hollanda", cities: ["Amsterdam", "Rotterdam", "Lahey", "Utrecht", "Eindhoven"] },
] as const;

function locationSlug(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[ıİ]/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export const LOCATION_OPTIONS = SUPPORTED_LOCATIONS.map((location) => ({
  code: location.code,
  label: location.country,
  cities: location.cities.map((city) => ({ id: `${location.code.toLowerCase()}-${locationSlug(city)}`, label: city })),
}));

export const DEFAULT_COUNTRY_CODE = "TR";
export const DEFAULT_CITY_ID = "tr-istanbul";

export function citiesForCountry(countryCode: string): ReadonlyArray<{ id: string; label: string }> {
  return LOCATION_OPTIONS.find((item) => item.code === countryCode)?.cities ?? [];
}

export function resolveLocation(countryCode: string, cityId: string) {
  const country = LOCATION_OPTIONS.find((item) => item.code === countryCode);
  const city = country?.cities.find((item) => item.id === cityId);
  return country && city ? { country: country.label, city: city.label } : null;
}

export function isSupportedLocation(countryCode: string, cityId: string) {
  return Boolean(resolveLocation(countryCode, cityId));
}

export function readableTextColor(hex: string) {
  const relativeLuminance = (color: string) => {
    const normalized = color.replace("#", "");
    const channels = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const background = relativeLuminance(hex);
  const dark = "#000000";
  const darkContrast = (background + 0.05) / (relativeLuminance(dark) + 0.05);
  const lightContrast = 1.05 / (background + 0.05);
  return darkContrast >= lightContrast ? dark : "#FFFFFF";
}
