import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export function correlationIdFrom(request: Request) {
  const supplied = request.headers.get("x-correlation-id")?.trim();
  return supplied && /^[a-zA-Z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

export function safeAudit(
  database: DatabaseSync,
  input: { correlationId: string; userId?: string | null; action: string; outcome: string; context?: Record<string, string | number | boolean | null> },
) {
  database.prepare(`
    INSERT INTO audit_events (id, correlation_id, user_id, action, outcome, safe_context_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.correlationId, input.userId ?? null, input.action, input.outcome, JSON.stringify(input.context ?? {}));
}

export function incrementMetric(database: DatabaseSync, key: string, amount = 1) {
  database.prepare(`
    INSERT INTO game_metrics (metric_key, metric_value) VALUES (?, ?)
    ON CONFLICT(metric_key) DO UPDATE SET metric_value = metric_value + excluded.metric_value, updated_at = CURRENT_TIMESTAMP
  `).run(key, amount);
}

export function safeRiskEvent(
  database: DatabaseSync,
  input: { userId?: string | null; sessionId?: string | null; category: string; severity: "info" | "warning" | "critical"; context?: Record<string, string | number | boolean | null> },
) {
  database.prepare(`
    INSERT INTO risk_events (id, user_id, session_id, category, severity, safe_context_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.userId ?? null, input.sessionId ?? null, input.category, input.severity, JSON.stringify(input.context ?? {}));
}
