"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Globe2, LoaderCircle, MapPin, Search } from "lucide-react";
import { DEFAULT_COUNTRY_CODE } from "@/lib/app-config";

type CountryOption = Readonly<{ code: string; label: string }>;
type CityOption = Readonly<{ id: string; label: string; stateCode: string }>;

type LocationFieldsProps = {
  countryCode: string;
  cityId: string;
  countryLabel?: string;
  cityLabel?: string;
  onCountryChange: (code: string, label: string) => void;
  onCityChange: (id: string, label: string) => void;
  compact?: boolean;
};

const TURKEY_FALLBACK: CountryOption = { code: DEFAULT_COUNTRY_CODE, label: "Türkiye" };
const CITY_QUERY_MAX_LENGTH = 80;
const CITY_REQUEST_CACHE_SIZE = 24;
const CITY_REQUEST_CACHE_TTL_MS = 5 * 60 * 1_000;

type CachedCitySearch = Readonly<{ cities: CityOption[]; expiresAt: number }>;

export function LocationFields({
  countryCode,
  cityId,
  countryLabel,
  cityLabel = "",
  onCountryChange,
  onCityChange,
  compact = false,
}: LocationFieldsProps) {
  const fieldId = useId().replace(/:/g, "");
  const [countries, setCountries] = useState<CountryOption[]>(countryCode === "TR" ? [TURKEY_FALLBACK] : [{ code: countryCode, label: countryLabel || countryCode }]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [query, setQuery] = useState(cityLabel);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);
  const cityRequestCache = useRef(new Map<string, CachedCitySearch>());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locations/countries", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("countries")))
      .then((result: { countries?: CountryOption[] }) => {
        if (result.countries?.length) setCountries(result.countries);
      })
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setLoadError("Ülke listesi yüklenemedi."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!countryCode || !open) return;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError("");
      try {
        const parameters = new URLSearchParams({ country: countryCode, q: query });
        if (cityId) parameters.set("selected", cityId);
        const cacheKey = parameters.toString();
        const cached = cityRequestCache.current.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          cityRequestCache.current.delete(cacheKey);
          cityRequestCache.current.set(cacheKey, cached);
          if (requestSequence.current === sequence) {
            setCities(cached.cities);
            setActiveIndex(cached.cities.findIndex((city) => city.id === cityId));
          }
          return;
        }
        if (cached) cityRequestCache.current.delete(cacheKey);
        const response = await fetch(`/api/locations/cities?${parameters}`, { signal: controller.signal });
        const result = await response.json() as { cities?: CityOption[]; error?: string };
        if (!response.ok) throw new Error(result.error || "Şehirler yüklenemedi.");
        const nextCities = result.cities ?? [];
        cityRequestCache.current.set(cacheKey, { cities: nextCities, expiresAt: Date.now() + CITY_REQUEST_CACHE_TTL_MS });
        while (cityRequestCache.current.size > CITY_REQUEST_CACHE_SIZE) {
          const oldestKey = cityRequestCache.current.keys().next().value as string | undefined;
          if (!oldestKey) break;
          cityRequestCache.current.delete(oldestKey);
        }
        if (requestSequence.current === sequence) {
          setCities(nextCities);
          setActiveIndex(nextCities.findIndex((city) => city.id === cityId));
        }
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError" && requestSequence.current === sequence) setLoadError("Şehir listesi yüklenemedi. Yeniden dene.");
      } finally {
        if (requestSequence.current === sequence) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [cityId, countryCode, open, query, retryKey]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeOption = listRef.current?.querySelector<HTMLElement>(`#${fieldId}-city-${activeIndex}`);
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, fieldId, open]);

  const selectedCountryLabel = useMemo(
    () => countries.find((country) => country.code === countryCode)?.label ?? countryLabel ?? countryCode,
    [countries, countryCode, countryLabel],
  );

  function selectCountry(code: string) {
    const label = countries.find((country) => country.code === code)?.label ?? code;
    onCountryChange(code, label);
    onCityChange("", "");
    setQuery("");
    setCities([]);
    setActiveIndex(-1);
    setOpen(false);
  }

  function selectCity(city: CityOption) {
    onCityChange(city.id, city.label);
    setQuery(city.label);
    setActiveIndex(-1);
    setOpen(false);
  }

  function handleCityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setActiveIndex(-1);
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0 && cities[activeIndex]) {
      event.preventDefault();
      selectCity(cities[activeIndex]);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
    if (cities.length === 0) return;
    setActiveIndex((current) => {
      if (event.key === "Home") return 0;
      if (event.key === "End") return cities.length - 1;
      if (event.key === "ArrowDown") return current < 0 ? 0 : Math.min(current + 1, cities.length - 1);
      return current < 0 ? cities.length - 1 : Math.max(current - 1, 0);
    });
  }

  return (
    <div className={`location-fields${compact ? " is-compact" : ""}`}>
      <label>
        Ülke
        <div className="input-wrap location-country-select">
          <Globe2 size={18} aria-hidden="true" />
          <select value={countryCode} onChange={(event) => selectCountry(event.target.value)} required aria-label="Yaşadığın ülke">
            {countries.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      </label>
      <label>
        Şehir
        <div className="location-city-combobox">
          <div className="input-wrap">
            <MapPin size={18} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                const value = event.target.value.slice(0, CITY_QUERY_MAX_LENGTH);
                setQuery(value);
                if (value !== cityLabel) onCityChange("", "");
                setActiveIndex(-1);
                setOpen(true);
              }}
              onFocus={() => {
                setActiveIndex(cities.findIndex((city) => city.id === cityId));
                setOpen(true);
              }}
              onBlur={() => window.setTimeout(() => {
                setActiveIndex(-1);
                setOpen(false);
              }, 120)}
              onKeyDown={handleCityKeyDown}
              placeholder="Şehir ara"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={`${fieldId}-cities`}
              aria-activedescendant={open && activeIndex >= 0 ? `${fieldId}-city-${activeIndex}` : undefined}
              aria-describedby={`${fieldId}-hint`}
              aria-invalid={query.length > 0 && !cityId}
              autoComplete="off"
              maxLength={CITY_QUERY_MAX_LENGTH}
              required
            />
            {loading ? <LoaderCircle className="location-spinner" size={17} aria-label="Şehirler yükleniyor" /> : <Search size={17} aria-hidden="true" />}
          </div>
          <input type="hidden" name="cityId" value={cityId} />
          {open ? (
            <div ref={listRef} id={`${fieldId}-cities`} className="location-city-results" role="listbox" aria-label={`${selectedCountryLabel} şehirleri`} aria-busy={loading}>
              {loadError ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setLoadError(""); setRetryKey((value) => value + 1); }}>{loadError}</button> : null}
              {!loadError && !loading && cities.length === 0 ? <p>Aramana uygun şehir bulunamadı.</p> : null}
              {cities.map((city, index) => (
                <button
                  key={city.id}
                  id={`${fieldId}-city-${index}`}
                  type="button"
                  role="option"
                  aria-selected={city.id === cityId}
                  data-highlighted={index === activeIndex}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectCity(city)}
                >
                  <span>{city.label}</span>{city.stateCode ? <small>{city.stateCode}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          <span className="visually-hidden" role="status" aria-live="polite">
            {loading ? "Şehirler yükleniyor." : loadError || (open ? `${cities.length} şehir gösteriliyor.` : "")}
          </span>
        </div>
        <small id={`${fieldId}-hint`} className="location-field-hint">
          {query && !cityId ? "Devam etmek için sonuç listesinden bir şehir seç." : "Seçili ülkenin tüm şehirleri aranır."}
        </small>
      </label>
    </div>
  );
}
