import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correlationIdFrom,
  incrementMetric,
  safeAudit,
  safeRiskEvent,
} from "@/server/game/safe-telemetry";

vi.mock("server-only", () => ({}));

let database: DatabaseSync | undefined;

function telemetryDatabase() {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      safe_context_json TEXT NOT NULL
    );
    CREATE TABLE game_metrics (
      metric_key TEXT PRIMARY KEY,
      metric_value INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE risk_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      session_id TEXT,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      safe_context_json TEXT NOT NULL
    );
  `);
  return database;
}

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("güvenli authoritative telemetri", () => {
  it("geçerli correlation id'yi korur, geçersiz girdiyi UUID ile değiştirir", () => {
    const supplied = correlationIdFrom(new Request("https://mrap.test", {
      headers: { "x-correlation-id": "  trace_01  " },
    }));
    const generatedForShort = correlationIdFrom(new Request("https://mrap.test", {
      headers: { "x-correlation-id": "short" },
    }));
    const generatedForUnsafe = correlationIdFrom(new Request("https://mrap.test", {
      headers: { "x-correlation-id": "unsafe value!" },
    }));

    expect(supplied).toBe("trace_01");
    expect(generatedForShort).toMatch(/^[0-9a-f-]{36}$/);
    expect(generatedForUnsafe).toMatch(/^[0-9a-f-]{36}$/);
    expect(generatedForShort).not.toBe(generatedForUnsafe);
  });

  it("audit kaydında eksik kullanıcı ve context için yalnız güvenli varsayılanları yazar", () => {
    const db = telemetryDatabase();

    safeAudit(db, {
      correlationId: "audit-correlation",
      action: "claim.validate",
      outcome: "accepted",
    });
    safeAudit(db, {
      correlationId: "audit-correlation-2",
      userId: "user-1",
      action: "claim.commit",
      outcome: "rejected",
      context: { regionCount: 2, retried: false, reason: null },
    });

    expect(db.prepare(`
      SELECT correlation_id, user_id, action, outcome, safe_context_json
      FROM audit_events ORDER BY correlation_id
    `).all()).toEqual([
      {
        correlation_id: "audit-correlation",
        user_id: null,
        action: "claim.validate",
        outcome: "accepted",
        safe_context_json: "{}",
      },
      {
        correlation_id: "audit-correlation-2",
        user_id: "user-1",
        action: "claim.commit",
        outcome: "rejected",
        safe_context_json: JSON.stringify({ regionCount: 2, retried: false, reason: null }),
      },
    ]);
  });

  it("metriği varsayılan ve özel miktarla atomik olarak artırır", () => {
    const db = telemetryDatabase();

    incrementMetric(db, "claims.accepted");
    incrementMetric(db, "claims.accepted", 4);

    expect(db.prepare("SELECT metric_key, metric_value FROM game_metrics").get())
      .toEqual({ metric_key: "claims.accepted", metric_value: 5 });
  });

  it("risk olayında nullable kimlikleri ve güvenli context JSON'unu tutarlı saklar", () => {
    const db = telemetryDatabase();

    safeRiskEvent(db, {
      category: "gps_outlier",
      severity: "warning",
    });
    safeRiskEvent(db, {
      userId: "user-1",
      sessionId: "session-1",
      category: "speed_anomaly",
      severity: "critical",
      context: { speedMps: 48.5, blocked: true },
    });

    expect(db.prepare(`
      SELECT user_id, session_id, category, severity, safe_context_json
      FROM risk_events ORDER BY category
    `).all()).toEqual([
      {
        user_id: null,
        session_id: null,
        category: "gps_outlier",
        severity: "warning",
        safe_context_json: "{}",
      },
      {
        user_id: "user-1",
        session_id: "session-1",
        category: "speed_anomaly",
        severity: "critical",
        safe_context_json: JSON.stringify({ speedMps: 48.5, blocked: true }),
      },
    ]);
  });
});
