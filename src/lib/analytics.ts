export const ANALYTICS_SCHEMA_VERSION = 1 as const;

export const ANALYTICS_EVENT_NAMES = [
  "landing_view",
  "auth_started",
  "auth_completed",
  "login",
  "map_view",
  "tracking_started",
  "loop_candidate",
  "claim_accepted",
  "claim_rejected",
  "post_created",
  "feed_interaction",
  "realtime_reconnect",
  "app_error",
  "web_vital",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsMode = "development" | "production";

export const ANALYTICS_CODES = [
  "UNKNOWN",
  "USERNAME_TAKEN",
  "EMAIL_TAKEN",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "NETWORK_UNAVAILABLE",
  "GPS_JITTER",
  "LOOP_TOO_SMALL",
  "INVALID_GEOMETRY",
  "SELF_INTERSECTION",
  "NO_NEW_AREA",
  "OWNERSHIP_CONFLICT",
  "UNHANDLED_UI",
  "API_REQUEST_FAILED",
  "MAP_STYLE_LOAD",
  "REALTIME_DISCONNECTED",
  "GAME_STATE_INVALID",
] as const;

export type AnalyticsCode = (typeof ANALYTICS_CODES)[number];

export const ANALYTICS_AREA_BUCKETS = [
  "unknown",
  "under_100_m2",
  "100_to_999_m2",
  "1k_to_9k_m2",
  "10k_plus_m2",
] as const;

export type AnalyticsAreaBucket = (typeof ANALYTICS_AREA_BUCKETS)[number];

export const WEB_VITAL_NAMES = ["CLS", "FCP", "FID", "INP", "LCP", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export type WebVitalRating = (typeof WEB_VITAL_RATINGS)[number];

export const NAVIGATION_TYPES = [
  "navigate",
  "reload",
  "prerender",
  "back-forward",
  "back-forward-cache",
  "restore",
  "unknown",
] as const;

export type AnalyticsNavigationType = (typeof NAVIGATION_TYPES)[number];

export interface AnalyticsPayloadMap {
  landing_view: {
    entry: "direct" | "internal" | "external" | "unknown";
  };
  auth_started: {
    flow: "register" | "login" | "password_reset";
  };
  auth_completed: {
    flow: "register" | "login" | "password_reset";
    outcome: "success" | "failure";
    reasonCode?: AnalyticsCode;
  };
  login: {
    method: "password";
    outcome: "success" | "failure";
    reasonCode?: AnalyticsCode;
  };
  map_view: {
    surface: "game" | "post" | "frame_editor";
    context: "real" | "demo";
  };
  tracking_started: {
    locationMode: "real_gps" | "development_simulation";
    world: "production" | "development";
  };
  loop_candidate: {
    source: "active_route" | "owned_boundary";
    outcome: "available" | "rejected";
    areaBucket: AnalyticsAreaBucket;
    reasonCode?: AnalyticsCode;
  };
  claim_accepted: {
    status: "accepted" | "partially_accepted";
    areaBucket: AnalyticsAreaBucket;
    hadOverlap: boolean;
  };
  claim_rejected: {
    reasonCode: AnalyticsCode;
    retryable: boolean;
  };
  post_created: {
    imageCount: number;
    hasText: boolean;
    hasMapView: boolean;
  };
  feed_interaction: {
    feed: "home" | "explore" | "profile" | "saved";
    action:
      | "like"
      | "unlike"
      | "save"
      | "unsave"
      | "comments_open"
      | "comment_create"
      | "profile_open"
      | "map_open"
      | "media_open"
      | "follow"
      | "unfollow";
  };
  realtime_reconnect: {
    trigger: "offline_online" | "stream_error" | "version_gap" | "token_refresh";
    phase: "started" | "succeeded" | "failed";
    attemptBucket: "first" | "retry_2_3" | "retry_4_plus";
  };
  app_error: {
    boundary: "ui" | "api" | "map" | "realtime" | "game";
    code: AnalyticsCode;
    recoverable: boolean;
  };
  web_vital: {
    name: WebVitalName;
    value: number;
    delta: number;
    rating: WebVitalRating;
    navigationType: AnalyticsNavigationType;
  };
}

export type AnalyticsEvent<Name extends AnalyticsEventName = AnalyticsEventName> =
  Name extends AnalyticsEventName
    ? Readonly<{
        name: Name;
        payload: Readonly<AnalyticsPayloadMap[Name]>;
      }>
    : never;

export type AnalyticsEnvelope<Mode extends AnalyticsMode = AnalyticsMode> =
  AnalyticsEvent &
    Readonly<{
      eventId: string;
      mode: Mode;
      occurredAt: string;
      schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
    }>;

export interface AnalyticsAdapter<Mode extends AnalyticsMode> {
  readonly mode: Mode;
  readonly name: string;
  send(event: AnalyticsEnvelope<Mode>): void | Promise<void>;
}

export interface AnalyticsAdapterError<Mode extends AnalyticsMode> {
  readonly adapterName: string;
  readonly eventName: AnalyticsEventName;
  readonly mode: Mode;
}

export interface AnalyticsClientOptions<Mode extends AnalyticsMode> {
  readonly mode: Mode;
  readonly adapter?: AnalyticsAdapter<Mode>;
  readonly dedupeWindowMs?: number;
  readonly maxDedupeEntries?: number;
  readonly now?: () => number;
  readonly idFactory?: () => string;
  readonly onAdapterError?: (diagnostic: AnalyticsAdapterError<Mode>) => void;
}

export type AnalyticsReportResult =
  | Readonly<{ status: "accepted"; eventId: string }>
  | Readonly<{ status: "duplicate" }>
  | Readonly<{ status: "rejected"; reason: "privacy" | "schema" | "adapter-error" }>;

export interface AnalyticsClient<Mode extends AnalyticsMode> {
  readonly mode: Mode;
  readonly adapterName: string;
  report(event: AnalyticsEvent): AnalyticsReportResult;
  clearDedupe(): void;
}

export type AnalyticsPrivacyViolationReason =
  | "forbidden-key"
  | "forbidden-value"
  | "circular-reference"
  | "unsupported-value";

export type AnalyticsPrivacyResult =
  | Readonly<{ safe: true }>
  | Readonly<{
      safe: false;
      reason: AnalyticsPrivacyViolationReason;
      path: string;
    }>;

export type AnalyticsValidationResult =
  | Readonly<{ ok: true; event: AnalyticsEvent }>
  | Readonly<{
      ok: false;
      reason: "privacy" | "schema";
      detail: string;
    }>;

export interface WebVitalMetricInput {
  readonly name: string;
  readonly value: number;
  readonly delta: number;
  readonly rating?: string;
  readonly navigationType?: string;
}

const EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);
const ANALYTICS_CODE_SET = new Set<string>(ANALYTICS_CODES);
const AREA_BUCKET_SET = new Set<string>(ANALYTICS_AREA_BUCKETS);
const WEB_VITAL_NAME_SET = new Set<string>(WEB_VITAL_NAMES);
const WEB_VITAL_RATING_SET = new Set<string>(WEB_VITAL_RATINGS);
const NAVIGATION_TYPE_SET = new Set<string>(NAVIGATION_TYPES);
const LANDING_ENTRY_SET = new Set(["direct", "internal", "external", "unknown"]);
const AUTH_FLOW_SET = new Set(["register", "login", "password_reset"]);
const OUTCOME_SET = new Set(["success", "failure"]);
const MAP_SURFACE_SET = new Set(["game", "post", "frame_editor"]);
const MAP_CONTEXT_SET = new Set(["real", "demo"]);
const LOCATION_MODE_SET = new Set(["real_gps", "development_simulation"]);
const WORLD_SET = new Set(["production", "development"]);
const LOOP_SOURCE_SET = new Set(["active_route", "owned_boundary"]);
const LOOP_OUTCOME_SET = new Set(["available", "rejected"]);
const CLAIM_STATUS_SET = new Set(["accepted", "partially_accepted"]);
const FEED_SET = new Set(["home", "explore", "profile", "saved"]);
const FEED_ACTION_SET = new Set([
  "like",
  "unlike",
  "save",
  "unsave",
  "comments_open",
  "comment_create",
  "profile_open",
  "map_open",
  "media_open",
  "follow",
  "unfollow",
]);
const REALTIME_TRIGGER_SET = new Set([
  "offline_online",
  "stream_error",
  "version_gap",
  "token_refresh",
]);
const REALTIME_PHASE_SET = new Set(["started", "succeeded", "failed"]);
const ATTEMPT_BUCKET_SET = new Set(["first", "retry_2_3", "retry_4_plus"]);
const ERROR_BOUNDARY_SET = new Set(["ui", "api", "map", "realtime", "game"]);

const SAFE_CONTENT_SUMMARY_KEYS = new Set(["context", "hastext"]);
const FORBIDDEN_EXACT_KEYS = new Set([
  "lat",
  "lng",
  "lon",
  "gps",
  "location",
  "position",
  "points",
  "accuracy",
  "altitude",
  "heading",
  "mail",
  "body",
  "text",
  "title",
  "caption",
  "comment",
  "bio",
  "username",
  "displayname",
  "fullname",
  "firstname",
  "lastname",
  "content",
  "message",
]);
const FORBIDDEN_KEY_FRAGMENTS = [
  "latitude",
  "longitude",
  "coordinate",
  "geolocation",
  "route",
  "polygon",
  "geometry",
  "email",
  "address",
  "streetaddress",
  "postalcode",
  "zipcode",
  "token",
  "authorization",
  "password",
  "secret",
  "cookie",
  "body",
  "text",
  "title",
  "bio",
  "caption",
  "comment",
  "username",
  "displayname",
  "fullname",
  "firstname",
  "lastname",
  "content",
  "message",
  "description",
];

const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const AUTH_VALUE_PATTERN = /^(?:bearer|basic)\s+[a-z0-9._~+/=-]+$/i;
const JWT_VALUE_PATTERN = /^[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}$/i;
const URL_OR_DATA_VALUE_PATTERN = /^(?:https?:\/\/|www\.|data:)/i;
const COORDINATE_PAIR_PATTERN = /^-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}$/;
const EVENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const DEFAULT_DEDUPE_WINDOW_MS = 1_000;
const DEFAULT_MAX_DEDUPE_ENTRIES = 512;
const WEB_VITAL_THRESHOLDS: Readonly<Record<WebVitalName, readonly [number, number]>> = {
  CLS: [0.1, 0.25],
  FCP: [1_800, 3_000],
  FID: [100, 300],
  INP: [200, 500],
  LCP: [2_500, 4_000],
  TTFB: [800, 1_800],
};

let fallbackEventSequence = 0;

function normalizeKey(key: string) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isForbiddenKey(key: string) {
  const normalized = normalizeKey(key);
  if (SAFE_CONTENT_SUMMARY_KEYS.has(normalized)) return false;
  if (FORBIDDEN_EXACT_KEYS.has(normalized)) return true;
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isForbiddenString(value: string) {
  if (value.length > 128 || value.includes("\n") || value.includes("\r")) return true;
  return EMAIL_VALUE_PATTERN.test(value)
    || AUTH_VALUE_PATTERN.test(value)
    || JWT_VALUE_PATTERN.test(value)
    || URL_OR_DATA_VALUE_PATTERN.test(value)
    || COORDINATE_PAIR_PATTERN.test(value);
}

function inspectPrivacyValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): AnalyticsPrivacyResult {
  if (value === null || typeof value === "boolean") return { safe: true };

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { safe: true }
      : { safe: false, reason: "unsupported-value", path };
  }

  if (typeof value === "string") {
    return isForbiddenString(value)
      ? { safe: false, reason: "forbidden-value", path }
      : { safe: true };
  }

  if (typeof value !== "object") {
    return { safe: false, reason: "unsupported-value", path };
  }

  if (seen.has(value)) {
    return { safe: false, reason: "circular-reference", path };
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const result = inspectPrivacyValue(value[index], `${path}[${index}]`, seen);
        if (!result.safe) return result;
      }
      return { safe: true };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { safe: false, reason: "unsupported-value", path };
    }

    for (const [key, entry] of Object.entries(value)) {
      const entryPath = `${path}.${key}`;
      if (isForbiddenKey(key)) {
        return { safe: false, reason: "forbidden-key", path: entryPath };
      }
      const result = inspectPrivacyValue(entry, entryPath, seen);
      if (!result.safe) return result;
    }

    return { safe: true };
  } finally {
    seen.delete(value);
  }
}

export function inspectAnalyticsPrivacy(value: unknown): AnalyticsPrivacyResult {
  try {
    return inspectPrivacyValue(value, "$", new WeakSet<object>());
  } catch {
    return { safe: false, reason: "unsupported-value", path: "$" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && actual.every((key) => allowed.has(key));
}

function isOneOf(value: unknown, choices: ReadonlySet<string>): value is string {
  return typeof value === "string" && choices.has(value);
}

function isCode(value: unknown): value is AnalyticsCode {
  return isOneOf(value, ANALYTICS_CODE_SET);
}

function hasValidOptionalCode(payload: Record<string, unknown>) {
  return !Object.prototype.hasOwnProperty.call(payload, "reasonCode")
    || isCode(payload.reasonCode);
}

function isValidPayload(name: AnalyticsEventName, payload: Record<string, unknown>) {
  switch (name) {
    case "landing_view":
      return hasExactKeys(payload, ["entry"])
        && isOneOf(payload.entry, LANDING_ENTRY_SET);
    case "auth_started":
      return hasExactKeys(payload, ["flow"])
        && isOneOf(payload.flow, AUTH_FLOW_SET);
    case "auth_completed":
      return hasExactKeys(payload, ["flow", "outcome"], ["reasonCode"])
        && isOneOf(payload.flow, AUTH_FLOW_SET)
        && isOneOf(payload.outcome, OUTCOME_SET)
        && hasValidOptionalCode(payload);
    case "login":
      return hasExactKeys(payload, ["method", "outcome"], ["reasonCode"])
        && payload.method === "password"
        && isOneOf(payload.outcome, OUTCOME_SET)
        && hasValidOptionalCode(payload);
    case "map_view":
      return hasExactKeys(payload, ["surface", "context"])
        && isOneOf(payload.surface, MAP_SURFACE_SET)
        && isOneOf(payload.context, MAP_CONTEXT_SET);
    case "tracking_started":
      return hasExactKeys(payload, ["locationMode", "world"])
        && isOneOf(payload.locationMode, LOCATION_MODE_SET)
        && isOneOf(payload.world, WORLD_SET);
    case "loop_candidate":
      return hasExactKeys(payload, ["source", "outcome", "areaBucket"], ["reasonCode"])
        && isOneOf(payload.source, LOOP_SOURCE_SET)
        && isOneOf(payload.outcome, LOOP_OUTCOME_SET)
        && isOneOf(payload.areaBucket, AREA_BUCKET_SET)
        && hasValidOptionalCode(payload);
    case "claim_accepted":
      return hasExactKeys(payload, ["status", "areaBucket", "hadOverlap"])
        && isOneOf(payload.status, CLAIM_STATUS_SET)
        && isOneOf(payload.areaBucket, AREA_BUCKET_SET)
        && typeof payload.hadOverlap === "boolean";
    case "claim_rejected":
      return hasExactKeys(payload, ["reasonCode", "retryable"])
        && isCode(payload.reasonCode)
        && typeof payload.retryable === "boolean";
    case "post_created":
      return hasExactKeys(payload, ["imageCount", "hasText", "hasMapView"])
        && Number.isInteger(payload.imageCount)
        && typeof payload.imageCount === "number"
        && payload.imageCount >= 0
        && payload.imageCount <= 6
        && typeof payload.hasText === "boolean"
        && typeof payload.hasMapView === "boolean";
    case "feed_interaction":
      return hasExactKeys(payload, ["feed", "action"])
        && isOneOf(payload.feed, FEED_SET)
        && isOneOf(payload.action, FEED_ACTION_SET);
    case "realtime_reconnect":
      return hasExactKeys(payload, ["trigger", "phase", "attemptBucket"])
        && isOneOf(payload.trigger, REALTIME_TRIGGER_SET)
        && isOneOf(payload.phase, REALTIME_PHASE_SET)
        && isOneOf(payload.attemptBucket, ATTEMPT_BUCKET_SET);
    case "app_error":
      return hasExactKeys(payload, ["boundary", "code", "recoverable"])
        && isOneOf(payload.boundary, ERROR_BOUNDARY_SET)
        && isCode(payload.code)
        && typeof payload.recoverable === "boolean";
    case "web_vital":
      return hasExactKeys(payload, ["name", "value", "delta", "rating", "navigationType"])
        && isOneOf(payload.name, WEB_VITAL_NAME_SET)
        && typeof payload.value === "number"
        && Number.isFinite(payload.value)
        && payload.value >= 0
        && typeof payload.delta === "number"
        && Number.isFinite(payload.delta)
        && payload.delta >= 0
        && isOneOf(payload.rating, WEB_VITAL_RATING_SET)
        && isOneOf(payload.navigationType, NAVIGATION_TYPE_SET);
  }
}

export function validateAnalyticsEvent(value: unknown): AnalyticsValidationResult {
  const privacy = inspectAnalyticsPrivacy(value);
  if (!privacy.safe) {
    return {
      ok: false,
      reason: "privacy",
      detail: `${privacy.reason}:${privacy.path}`,
    };
  }

  if (!isRecord(value) || !hasExactKeys(value, ["name", "payload"])) {
    return { ok: false, reason: "schema", detail: "invalid-event-shape" };
  }
  if (typeof value.name !== "string" || !EVENT_NAME_SET.has(value.name)) {
    return { ok: false, reason: "schema", detail: "unknown-event-name" };
  }
  if (!isRecord(value.payload)) {
    return { ok: false, reason: "schema", detail: "invalid-payload-shape" };
  }

  const name = value.name as AnalyticsEventName;
  if (!isValidPayload(name, value.payload)) {
    return { ok: false, reason: "schema", detail: `invalid-${name}-payload` };
  }

  return { ok: true, event: value as AnalyticsEvent };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function normalizeBoundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function defaultEventId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackEventSequence += 1;
  return `evt_${Date.now().toString(36)}_${fallbackEventSequence.toString(36)}`;
}

export function createNoopAnalyticsAdapter<Mode extends AnalyticsMode>(
  mode: Mode,
): AnalyticsAdapter<Mode> {
  return Object.freeze({
    mode,
    name: `noop-${mode}`,
    send: () => undefined,
  });
}

export function createAnalyticsClient<Mode extends AnalyticsMode>(
  options: AnalyticsClientOptions<Mode>,
): AnalyticsClient<Mode> {
  const adapter = options.adapter ?? createNoopAnalyticsAdapter(options.mode);
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? defaultEventId;
  const dedupeWindowMs = normalizeBoundedInteger(
    options.dedupeWindowMs,
    DEFAULT_DEDUPE_WINDOW_MS,
    1,
    60_000,
  );
  const maxDedupeEntries = normalizeBoundedInteger(
    options.maxDedupeEntries,
    DEFAULT_MAX_DEDUPE_ENTRIES,
    1,
    4_096,
  );
  const recentFingerprints = new Map<string, number>();

  function notifyAdapterError(eventName: AnalyticsEventName) {
    if (!options.onAdapterError) return;
    try {
      options.onAdapterError({
        adapterName: adapter.name,
        eventName,
        mode: options.mode,
      });
    } catch {
      // Telemetry diagnostics must never affect the application flow.
    }
  }

  function pruneExpiredDedupeEntries(timestamp: number) {
    for (const [fingerprint, expiresAt] of recentFingerprints) {
      if (expiresAt <= timestamp) recentFingerprints.delete(fingerprint);
    }
  }

  function makeDedupeRoom() {
    while (recentFingerprints.size >= maxDedupeEntries) {
      const oldest = recentFingerprints.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      recentFingerprints.delete(oldest);
    }
  }

  return Object.freeze({
    mode: options.mode,
    adapterName: adapter.name,
    report(event: AnalyticsEvent): AnalyticsReportResult {
      const validation = validateAnalyticsEvent(event);
      if (!validation.ok) {
        return { status: "rejected", reason: validation.reason };
      }

      let timestamp: number;
      try {
        timestamp = now();
        if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) {
          throw new Error("invalid-clock");
        }
      } catch {
        notifyAdapterError(validation.event.name);
        return { status: "rejected", reason: "adapter-error" };
      }
      pruneExpiredDedupeEntries(timestamp);
      const fingerprint = stableSerialize(validation.event);
      const duplicateExpiresAt = recentFingerprints.get(fingerprint);
      if (duplicateExpiresAt !== undefined && duplicateExpiresAt > timestamp) {
        return { status: "duplicate" };
      }

      makeDedupeRoom();
      recentFingerprints.set(fingerprint, timestamp + dedupeWindowMs);
      let eventId: string;
      try {
        eventId = idFactory();
        if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
          throw new Error("invalid-event-id");
        }
      } catch {
        recentFingerprints.delete(fingerprint);
        notifyAdapterError(validation.event.name);
        return { status: "rejected", reason: "adapter-error" };
      }
      const envelope = Object.freeze({
        name: validation.event.name,
        payload: Object.freeze({ ...validation.event.payload }),
        eventId,
        mode: options.mode,
        occurredAt: new Date(timestamp).toISOString(),
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
      }) as AnalyticsEnvelope<Mode>;

      try {
        const delivery = adapter.send(envelope);
        if (delivery && typeof delivery.then === "function") {
          void Promise.resolve(delivery).catch(() => notifyAdapterError(validation.event.name));
        }
      } catch {
        recentFingerprints.delete(fingerprint);
        notifyAdapterError(validation.event.name);
        return { status: "rejected", reason: "adapter-error" };
      }

      return { status: "accepted", eventId };
    },
    clearDedupe() {
      recentFingerprints.clear();
    },
  });
}

function isWebVitalName(value: string): value is WebVitalName {
  return WEB_VITAL_NAME_SET.has(value);
}

function normalizeWebVitalNumber(name: WebVitalName, value: number) {
  const factor = name === "CLS" ? 10_000 : 1;
  return Math.round(value * factor) / factor;
}

function calculateWebVitalRating(name: WebVitalName, value: number): WebVitalRating {
  const [goodMaximum, needsImprovementMaximum] = WEB_VITAL_THRESHOLDS[name];
  if (value <= goodMaximum) return "good";
  if (value <= needsImprovementMaximum) return "needs-improvement";
  return "poor";
}

export function toWebVitalAnalyticsEvent(
  metric: WebVitalMetricInput,
): AnalyticsEvent<"web_vital"> | null {
  if (!isWebVitalName(metric.name)) return null;
  if (!Number.isFinite(metric.value) || metric.value < 0) return null;
  if (!Number.isFinite(metric.delta) || metric.delta < 0) return null;

  const value = normalizeWebVitalNumber(metric.name, metric.value);
  const delta = normalizeWebVitalNumber(metric.name, metric.delta);
  const rating = isOneOf(metric.rating, WEB_VITAL_RATING_SET)
    ? metric.rating as WebVitalRating
    : calculateWebVitalRating(metric.name, metric.value);
  const navigationType = isOneOf(metric.navigationType, NAVIGATION_TYPE_SET)
    ? metric.navigationType as AnalyticsNavigationType
    : "unknown";

  return {
    name: "web_vital",
    payload: {
      name: metric.name,
      value,
      delta,
      rating,
      navigationType,
    },
  };
}

const runtimeMode: AnalyticsMode = process.env.NODE_ENV === "production"
  ? "production"
  : "development";

export const defaultAnalyticsClient = createAnalyticsClient({ mode: runtimeMode });

export function reportAnalytics(event: AnalyticsEvent) {
  return defaultAnalyticsClient.report(event);
}
