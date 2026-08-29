"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Crown, Globe2, MapPin, Search, Trophy, UsersRound } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { LEADERBOARD_LIMIT } from "@/lib/content-limits";
import {
  filterLeaderboardEntries,
  leaderboardCityKey,
  scopeLeaderboardEntries,
  type LeaderboardScope,
  type ScopedLeaderboardEntry,
} from "@/lib/leaderboard-filter";
import type { AppUser, LeaderboardEntry } from "@/lib/models";
import { normalizeUserSearchText } from "@/lib/user-search";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

type CurrentLeaderboardUser = Pick<AppUser, "id" | "cityId" | "city" | "countryCode" | "country">;
type LocationOption = {
  id: string;
  label: string;
  context?: string;
  countryCode?: string;
  city?: string;
};

type LeaderboardClientProps = {
  entries: LeaderboardEntry[];
  optionEntries?: LeaderboardEntry[];
  cityOptions?: Array<{ countryCode: string; country: string; city: string }>;
  countryOptions?: Array<{ countryCode: string; country: string }>;
  currentUser: CurrentLeaderboardUser;
  followingIds?: string[];
  profileBasePath: string;
  selfProfilePath: string;
  remote?: boolean;
};

const MAX_LOCATION_SELECTIONS = 20;

function locationOptions(
  entries: LeaderboardEntry[],
  current: LocationOption,
  kind: "city" | "country",
  additional: LocationOption[] = [],
) {
  const options = new Map<string, LocationOption>([[current.id, current], ...additional.map((option) => [option.id, option] as const)]);
  for (const entry of entries) {
    const option = kind === "city"
      ? {
        id: leaderboardCityKey(entry.countryCode, entry.city),
        label: entry.city,
        context: entry.country,
        countryCode: entry.countryCode,
        city: entry.city,
      }
      : { id: entry.countryCode.toUpperCase(), label: entry.country };
    if (!options.has(option.id)) options.set(option.id, option);
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, "tr-TR"));
}

function requestCacheKey(
  scope: LeaderboardScope,
  cityKeys: ReadonlySet<string>,
  countryCodes: ReadonlySet<string>,
) {
  return JSON.stringify([
    scope,
    scope === "city" ? [...cityKeys].sort() : [],
    scope === "country" ? [...countryCodes].sort() : [],
  ]);
}

function LocationMultiSelect({
  kind,
  options,
  selected,
  onChange,
  onSearch,
}: {
  kind: "city" | "country";
  options: LocationOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  onSearch?: (query: string) => void;
}) {
  const { dictionary: copy } = useI18n();
  const [filterQuery, setFilterQuery] = useState("");
  const title = kind === "city" ? copy.leaderboard.citySelection : copy.leaderboard.countrySelection;
  const selectedOptions = options.filter((option) => selected.has(option.id));
  const summary = selectedOptions.length === 1
    ? selectedOptions[0].label
    : formatMessage(kind === "city" ? copy.leaderboard.cityCount : copy.leaderboard.countryCount, { count: selectedOptions.length });
  const normalizedFilter = normalizeUserSearchText(filterQuery);
  const visibleOptions = normalizedFilter
    ? options.filter((option) => normalizeUserSearchText(`${option.label} ${option.context ?? ""}`).includes(normalizedFilter))
    : options;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      if (next.size === 1) return;
      next.delete(id);
    } else {
      if (next.size >= MAX_LOCATION_SELECTIONS) return;
      next.add(id);
    }
    onChange(next);
  };

  return (
    <details className="leaderboard-multiselect">
      <summary aria-label={`${title}: ${summary}`}>
        {kind === "city" ? <MapPin size={18} /> : <Globe2 size={18} />}
        <span><small>{title}</small><strong>{summary}</strong></span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="leaderboard-multiselect-panel">
        <header>
          <span><strong>{title}</strong><small>{copy.leaderboard.multiSelectHint}</small></span>
          <button type="button" onClick={() => onChange(new Set(visibleOptions.slice(0, MAX_LOCATION_SELECTIONS).map((option) => option.id)))} disabled={!visibleOptions.length}>
            {visibleOptions.length > MAX_LOCATION_SELECTIONS ? copy.leaderboard.selectLimit : copy.leaderboard.selectAll}
          </button>
        </header>
        <label className="leaderboard-option-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={filterQuery}
            onChange={(event) => {
              setFilterQuery(event.target.value);
              onSearch?.(event.target.value);
            }}
            placeholder={kind === "city" ? copy.leaderboard.filterCities : copy.leaderboard.filterCountries}
            aria-label={kind === "city" ? copy.leaderboard.filterCitiesAria : copy.leaderboard.filterCountriesAria}
            maxLength={40}
            autoComplete="off"
          />
        </label>
        <div className="leaderboard-option-list" role="group" aria-label={title}>
          {visibleOptions.map((option) => (
            <label key={option.id}>
              <input type="checkbox" checked={selected.has(option.id)} onChange={() => toggle(option.id)} />
              <span><strong>{option.label}</strong>{option.context ? <small>{option.context}</small> : null}</span>
              <Check size={16} aria-hidden="true" />
            </label>
          ))}
          {!visibleOptions.length ? <span className="leaderboard-option-empty">{copy.leaderboard.noLocationMatch}</span> : null}
        </div>
        <p>{copy.leaderboard.oneSelectionRequired}</p>
      </div>
    </details>
  );
}

export function LeaderboardClient({
  entries,
  optionEntries,
  cityOptions: catalogCities = [],
  countryOptions: catalogCountries = [],
  currentUser,
  followingIds = [],
  profileBasePath,
  selfProfilePath,
  remote = false,
}: LeaderboardClientProps) {
  const { dictionary: copy } = useI18n();
  const [scope, setScope] = useState<LeaderboardScope>("city");
  const [query, setQuery] = useState("");
  const currentCityKey = leaderboardCityKey(currentUser.countryCode, currentUser.city);
  const [selectedCityKeys, setSelectedCityKeys] = useState(() => new Set([currentCityKey]));
  const [selectedCountryCodes, setSelectedCountryCodes] = useState(() => new Set([currentUser.countryCode]));
  const [remoteEntries, setRemoteEntries] = useState(entries);
  const [discoveredCities, setDiscoveredCities] = useState<LocationOption[]>([]);
  const [remoteStatus, setRemoteStatus] = useState<"idle" | "loading" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const citySearchAbortRef = useRef<AbortController | null>(null);
  const citySearchTimerRef = useRef<number | null>(null);
  const requestSerialRef = useRef(0);

  const scopes = useMemo(() => [
    { id: "friends" as const, label: copy.leaderboard.friends, icon: UsersRound },
    { id: "city" as const, label: copy.leaderboard.city, icon: MapPin },
    { id: "country" as const, label: copy.leaderboard.country, icon: Globe2 },
    { id: "world" as const, label: copy.leaderboard.world, icon: Trophy },
  ], [copy]);
  const locationSource = optionEntries ?? entries;
  const catalogCityLocations = useMemo(() => [...catalogCities, ...discoveredCities.map((option) => ({
    countryCode: option.countryCode!,
    country: option.context!,
    city: option.city!,
  }))].map((option) => ({
    id: leaderboardCityKey(option.countryCode, option.city),
    label: option.city,
    context: option.country,
    countryCode: option.countryCode,
    city: option.city,
  })), [catalogCities, discoveredCities]);
  const catalogCountryLocations = useMemo(() => catalogCountries.map((option) => ({
    id: option.countryCode.toUpperCase(),
    label: option.country,
  })), [catalogCountries]);
  const cities = useMemo(() => locationOptions(locationSource, {
    id: currentCityKey,
    label: currentUser.city,
    context: currentUser.country,
    countryCode: currentUser.countryCode,
    city: currentUser.city,
  }, "city", catalogCityLocations), [catalogCityLocations, currentCityKey, currentUser.city, currentUser.country, currentUser.countryCode, locationSource]);
  const countries = useMemo(() => locationOptions(locationSource, {
    id: currentUser.countryCode.toUpperCase(),
    label: currentUser.country,
  }, "country", catalogCountryLocations), [catalogCountryLocations, currentUser.country, currentUser.countryCode, locationSource]);
  const cacheRef = useRef(new Map<string, LeaderboardEntry[]>([
    [requestCacheKey("city", new Set([currentCityKey]), new Set()), entries],
    ...(optionEntries ? [[requestCacheKey("world", new Set(), new Set()), optionEntries] as const] : []),
  ]));

  const loadRemoteScope = useCallback(async (
    nextScope: LeaderboardScope,
    nextCityKeys: ReadonlySet<string>,
    nextCountryCodes: ReadonlySet<string>,
  ) => {
    if (!remote) return;
    const cacheKey = requestCacheKey(nextScope, nextCityKeys, nextCountryCodes);
    const cached = cacheRef.current.get(cacheKey);
    abortRef.current?.abort();
    if (cached) {
      setRemoteEntries(cached);
      setRemoteStatus("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const serial = ++requestSerialRef.current;
    setRemoteEntries([]);
    setRemoteStatus("loading");
    const params = new URLSearchParams({ scope: nextScope, limit: String(LEADERBOARD_LIMIT) });
    if (nextScope === "city") {
      for (const key of nextCityKeys) {
        const option = cities.find((item) => item.id === key);
        if (option?.countryCode && option.city) params.append("city", `${option.countryCode}:${option.city}`);
      }
    }
    if (nextScope === "country") {
      for (const code of nextCountryCodes) params.append("country", code);
    }

    try {
      const response = await fetch(`/api/leaderboard?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      const body = await response.json() as { entries?: LeaderboardEntry[] };
      if (!response.ok || !Array.isArray(body.entries)) throw new Error("leaderboard_request_failed");
      if (serial !== requestSerialRef.current) return;
      cacheRef.current.set(cacheKey, body.entries);
      setRemoteEntries(body.entries);
      setRemoteStatus("idle");
    } catch {
      if (controller.signal.aborted || serial !== requestSerialRef.current) return;
      setRemoteStatus("error");
    }
  }, [cities, remote]);

  useEffect(() => () => {
    abortRef.current?.abort();
    citySearchAbortRef.current?.abort();
    if (citySearchTimerRef.current !== null) window.clearTimeout(citySearchTimerRef.current);
  }, []);

  const searchCityOptions = useCallback((rawQuery: string) => {
    if (citySearchTimerRef.current !== null) window.clearTimeout(citySearchTimerRef.current);
    citySearchAbortRef.current?.abort();
    if (!remote || rawQuery.trim().length < 2) return;
    const controller = new AbortController();
    citySearchAbortRef.current = controller;
    citySearchTimerRef.current = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ country: currentUser.countryCode, q: rawQuery.trim() });
        const response = await fetch(`/api/locations/cities?${params}`, { signal: controller.signal });
        const body = await response.json() as { cities?: Array<{ label: string }> };
        if (!response.ok || !Array.isArray(body.cities)) return;
        const receivedCities = body.cities;
        setDiscoveredCities((current) => {
          const merged = new Map(current.map((option) => [option.id, option]));
          for (const city of receivedCities) {
            if (!city.label?.trim()) continue;
            const id = leaderboardCityKey(currentUser.countryCode, city.label);
            merged.set(id, {
              id,
              label: city.label,
              context: currentUser.country,
              countryCode: currentUser.countryCode,
              city: city.label,
            });
          }
          return [...merged.values()];
        });
      } catch {
        // Katalog araması ana sıralamayı engellemez; mevcut seçenekler korunur.
      }
    }, 220);
  }, [currentUser.country, currentUser.countryCode, remote]);

  const selectScope = (nextScope: LeaderboardScope) => {
    setScope(nextScope);
    void loadRemoteScope(nextScope, selectedCityKeys, selectedCountryCodes);
  };
  const selectCities = (next: Set<string>) => {
    setSelectedCityKeys(next);
    if (scope === "city") void loadRemoteScope("city", next, selectedCountryCodes);
  };
  const selectCountries = (next: Set<string>) => {
    setSelectedCountryCodes(next);
    if (scope === "country") void loadRemoteScope("country", selectedCityKeys, next);
  };

  const following = useMemo(() => new Set(followingIds), [followingIds]);
  const scoped = useMemo(() => remote
    ? remoteEntries.map((entry, index) => ({ ...entry, scopeRank: index + 1 }))
    : scopeLeaderboardEntries(entries, {
      scope,
      currentUserId: currentUser.id,
      followingIds: following,
      selectedCityKeys,
      selectedCountryCodes,
    }), [currentUser.id, entries, following, remote, remoteEntries, scope, selectedCityKeys, selectedCountryCodes]);
  const filtered = useMemo(() => filterLeaderboardEntries(scoped, query), [query, scoped]);
  const listed = useMemo(() => query.trim() ? filtered : filtered.filter((entry) => entry.scopeRank > 3), [filtered, query]);
  const activeScope = scopes.find((item) => item.id === scope)!;
  const podium = useMemo(() => [scoped[1], scoped[0], scoped[2]]
    .filter((entry): entry is ScopedLeaderboardEntry => Boolean(entry)), [scoped]);

  const playerHref = (entry: LeaderboardEntry) => entry.id === currentUser.id
    ? selfProfilePath
    : `${profileBasePath}/${encodeURIComponent(entry.username)}`;

  return (
    <div className="leaderboard-view real-leaderboard">
      <section className="leaderboard-controls" aria-label={copy.leaderboard.filtersAria}>
        <div className="scope-tabs" role="group" aria-label={copy.leaderboard.scopeAria}>
          {scopes.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={scope === id} className={scope === id ? "is-active" : ""} onClick={() => selectScope(id)}>
              <Icon size={16} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div>
        <div className="leaderboard-tool-row">
          {scope === "city" ? <LocationMultiSelect kind="city" options={cities} selected={selectedCityKeys} onChange={selectCities} onSearch={searchCityOptions} /> : null}
          {scope === "country" ? <LocationMultiSelect kind="country" options={countries} selected={selectedCountryCodes} onChange={selectCountries} /> : null}
          <label className="search-field leaderboard-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.leaderboard.searchPlaceholder} aria-label={copy.leaderboard.searchAria} maxLength={40} autoComplete="off" />
          </label>
        </div>
      </section>

      {remoteStatus === "loading" ? (
        <div className="leaderboard-request-state" role="status" aria-live="polite">
          <span className="loading-spinner" aria-hidden="true" />
          <p>{copy.leaderboard.refreshing}</p>
        </div>
      ) : null}
      {remoteStatus === "error" ? (
        <div className="leaderboard-request-state is-error" role="alert">
          <p>{copy.errors.connection}</p>
          <button type="button" onClick={() => void loadRemoteScope(scope, selectedCityKeys, selectedCountryCodes)}>{copy.common.retry}</button>
        </div>
      ) : null}

      {remoteStatus === "idle" && !query.trim() && podium.length ? (
        <section className="leaderboard-hero" aria-labelledby="leaderboard-leaders-title">
          <div className="leaderboard-heading">
            <span className="eyebrow"><Trophy size={14} /> {copy.leaderboard.competition}</span>
            <h2 id="leaderboard-leaders-title">{formatMessage(copy.leaderboard.leaders, { scope: activeScope.label })}</h2>
            <p>{copy.leaderboard.uniqueAreaHint}</p>
          </div>
          <div className={`podium podium--${podium.length}`}>
            {podium.map((entry) => (
              <div key={entry.id} className={`podium-place podium-place--${entry.scopeRank}${entry.id === currentUser.id ? " is-you" : ""}`}>
                {entry.scopeRank === 1 ? <Crown className="podium-crown" size={27} fill="currentColor" /> : null}
                <span className="podium-avatar-wrap"><UserAvatar user={entry} href={playerHref(entry)} size={entry.scopeRank === 1 ? "xl" : "lg"} className="podium-avatar" /><i>{entry.scopeRank}</i></span>
                <Link href={playerHref(entry)}><strong>{entry.displayName}{entry.id === currentUser.id ? copy.leaderboard.youSuffix : ""}</strong></Link>
                <small className="podium-handle">@{entry.username}</small>
                <span>{entry.areaKm2.toFixed(3).replace(".", ",")} km²</span>
                <small className="podium-claims">{formatMessage(copy.leaderboard.claimCount, { count: entry.routes })}</small>
                <div className="podium-block" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {remoteStatus === "idle" ? <p className="leaderboard-result-note" role="status">
        {query ? `${formatMessage(copy.leaderboard.matches, { count: filtered.length })} ` : ""}
        {formatMessage(copy.leaderboard.resultHint, { count: Math.min(query.trim() ? filtered.length : scoped.length, LEADERBOARD_LIMIT), scope: activeScope.label })}
      </p> : null}

      {remoteStatus === "idle" && listed.length ? (
        <div className="real-rank-list" aria-label={formatMessage(copy.leaderboard.rankingAria, { scope: activeScope.label })}>
          {listed.map((entry) => {
            const href = playerHref(entry);
            return (
              <article key={entry.id} className={entry.id === currentUser.id ? "is-you" : ""}>
                <span className="real-rank-number">{entry.scopeRank === 1 ? <Crown size={20} /> : entry.scopeRank}</span>
                <UserAvatar user={entry} href={href} />
                <Link href={href} className="real-rank-user">
                  <strong>{entry.displayName}{entry.id === currentUser.id ? copy.leaderboard.youSuffix : ""}</strong>
                  <small>@{entry.username} · <MapPin size={11} /> {entry.city}, {entry.country}</small>
                </Link>
                <span className="real-rank-metric"><strong>{entry.areaKm2.toFixed(3).replace(".", ",")} km²</strong><small>{formatMessage(copy.leaderboard.claimCount, { count: entry.routes })}</small></span>
              </article>
            );
          })}
        </div>
      ) : remoteStatus !== "idle" || filtered.length ? null : (
        <div className="real-empty-state">
          <span><Trophy size={26} /></span><h3>{copy.leaderboard.emptyTitle}</h3><p>{query ? copy.leaderboard.searchEmptyBody : copy.leaderboard.emptyBody}</p>
        </div>
      )}
    </div>
  );
}
