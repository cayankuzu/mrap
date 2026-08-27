import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_SCHEMA_VERSION,
  createAnalyticsClient,
  inspectAnalyticsPrivacy,
  toWebVitalAnalyticsEvent,
  validateAnalyticsEvent,
  type AnalyticsAdapter,
  type AnalyticsEnvelope,
  type AnalyticsEvent,
} from "@/lib/analytics";

const validEvents = [
  { name: "landing_view", payload: { entry: "direct" } },
  { name: "auth_started", payload: { flow: "register" } },
  {
    name: "auth_completed",
    payload: { flow: "register", outcome: "failure", reasonCode: "USERNAME_TAKEN" },
  },
  { name: "login", payload: { method: "password", outcome: "success" } },
  { name: "map_view", payload: { surface: "game", context: "real" } },
  {
    name: "tracking_started",
    payload: { locationMode: "development_simulation", world: "development" },
  },
  {
    name: "loop_candidate",
    payload: { source: "active_route", outcome: "available", areaBucket: "100_to_999_m2" },
  },
  {
    name: "claim_accepted",
    payload: { status: "partially_accepted", areaBucket: "1k_to_9k_m2", hadOverlap: true },
  },
  { name: "claim_rejected", payload: { reasonCode: "GPS_JITTER", retryable: true } },
  { name: "post_created", payload: { imageCount: 6, hasText: true, hasMapView: true } },
  { name: "feed_interaction", payload: { feed: "explore", action: "map_open" } },
  {
    name: "realtime_reconnect",
    payload: { trigger: "version_gap", phase: "succeeded", attemptBucket: "retry_2_3" },
  },
  { name: "app_error", payload: { boundary: "map", code: "MAP_STYLE_LOAD", recoverable: true } },
  {
    name: "web_vital",
    payload: {
      name: "INP",
      value: 170,
      delta: 24,
      rating: "good",
      navigationType: "navigate",
    },
  },
] satisfies AnalyticsEvent[];

describe("analytics event schema", () => {
  it("requires a valid fixture for every central event name", () => {
    expect(validEvents.map((event) => event.name)).toEqual([...ANALYTICS_EVENT_NAMES]);
    for (const event of validEvents) {
      expect(validateAnalyticsEvent(event)).toMatchObject({ ok: true });
    }
  });

  it("rejects unknown fields, invalid limits and unsafe diagnostic codes", () => {
    expect(validateAnalyticsEvent({
      name: "post_created",
      payload: { imageCount: 7, hasText: true, hasMapView: true },
    })).toMatchObject({ ok: false, reason: "schema" });
    expect(validateAnalyticsEvent({
      name: "app_error",
      payload: { boundary: "map", code: "raw error message", recoverable: true },
    })).toMatchObject({ ok: false, reason: "schema" });
    expect(validateAnalyticsEvent({
      name: "landing_view",
      payload: { entry: "direct", campaign: "launch" },
    })).toMatchObject({ ok: false, reason: "schema" });
    expect(validateAnalyticsEvent({ name: "future_event", payload: {} }))
      .toMatchObject({ ok: false, reason: "schema" });
  });
});

describe("analytics payload privacy", () => {
  it.each([
    [{ position: { latitude: 41.0082, longitude: 28.9784 } }, "forbidden-key"],
    [{ profile: { email: "oyuncu@example.com" } }, "forbidden-key"],
    [{ shippingAddress: "Kadikoy" }, "forbidden-key"],
    [{ accessToken: "secret" }, "forbidden-key"],
    [{ postTitle: "Kisisel gonderi basligi" }, "forbidden-key"],
    [{ harmless: "oyuncu@example.com" }, "forbidden-value"],
    [{ harmless: "41.008200, 28.978400" }, "forbidden-value"],
  ] as const)("rejects private payload %j", (payload, reason) => {
    expect(inspectAnalyticsPrivacy(payload)).toMatchObject({ safe: false, reason });
  });

  it("rejects private data before a forged event can reach an adapter", () => {
    const result = validateAnalyticsEvent({
      name: "map_view",
      payload: { surface: "game", context: "real", rawRoute: [[28.9, 41.0]] },
    });
    expect(result).toMatchObject({ ok: false, reason: "privacy" });
  });

  it("allows only aggregate, enumerated product signals", () => {
    expect(inspectAnalyticsPrivacy(validEvents)).toEqual({ safe: true });
  });
});

describe("analytics delivery dedupe", () => {
  it("drops identical events in the window and accepts them after expiry", () => {
    let timestamp = Date.parse("2026-08-27T12:00:00Z");
    let sequence = 0;
    const delivered: AnalyticsEnvelope<"development">[] = [];
    const adapter: AnalyticsAdapter<"development"> = {
      mode: "development",
      name: "test-collector",
      send: (event) => {
        delivered.push(event);
      },
    };
    const client = createAnalyticsClient({
      mode: "development",
      adapter,
      dedupeWindowMs: 1_000,
      now: () => timestamp,
      idFactory: () => `event-${sequence += 1}`,
    });
    const event: AnalyticsEvent<"feed_interaction"> = {
      name: "feed_interaction",
      payload: { feed: "home", action: "like" },
    };

    expect(client.report(event)).toEqual({ status: "accepted", eventId: "event-1" });
    expect(client.report({
      name: "feed_interaction",
      payload: { action: "like", feed: "home" },
    })).toEqual({ status: "duplicate" });
    expect(delivered).toHaveLength(1);

    timestamp += 1_001;
    expect(client.report(event)).toEqual({ status: "accepted", eventId: "event-2" });
    expect(delivered).toHaveLength(2);
    expect(delivered[0]).toMatchObject({
      mode: "development",
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      occurredAt: "2026-08-27T12:00:00.000Z",
    });
  });

  it("uses an explicit no-op adapter when no vendor is configured", () => {
    const client = createAnalyticsClient({ mode: "production" });
    expect(client.adapterName).toBe("noop-production");
    expect(client.report(validEvents[0])).toMatchObject({ status: "accepted" });
  });
});

describe("Core Web Vitals transform", () => {
  it("keeps only bounded metric fields and derives a rating when absent", () => {
    expect(toWebVitalAnalyticsEvent({
      name: "LCP",
      value: 2_745.7,
      delta: 245.2,
      navigationType: "reload",
    })).toEqual({
      name: "web_vital",
      payload: {
        name: "LCP",
        value: 2_746,
        delta: 245,
        rating: "needs-improvement",
        navigationType: "reload",
      },
    });
  });

  it("preserves CLS precision without forwarding metric entries or identifiers", () => {
    const event = toWebVitalAnalyticsEvent({
      name: "CLS",
      value: 0.09123,
      delta: 0.01111,
      rating: "good",
      navigationType: "back-forward-cache",
    });
    expect(event?.payload).toEqual({
      name: "CLS",
      value: 0.0912,
      delta: 0.0111,
      rating: "good",
      navigationType: "back-forward-cache",
    });
    expect(event?.payload).not.toHaveProperty("id");
    expect(event?.payload).not.toHaveProperty("entries");
  });

  it("ignores custom or malformed metrics", () => {
    expect(toWebVitalAnalyticsEvent({
      name: "Next.js-hydration",
      value: 80,
      delta: 80,
    })).toBeNull();
    expect(toWebVitalAnalyticsEvent({ name: "INP", value: Number.NaN, delta: 1 })).toBeNull();
    expect(toWebVitalAnalyticsEvent({ name: "INP", value: 100, delta: -1 })).toBeNull();
  });
});
