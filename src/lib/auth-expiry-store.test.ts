import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findActivePasswordResetUserId,
  findActiveSessionUserId,
  removeExpiredSessions,
  removeUnavailablePasswordResetTokens,
} from "@/lib/auth-expiry-store";

let database: DatabaseSync;

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
});

afterEach(() => database.close());

describe("kimlik doğrulama süre sınırları", () => {
  it("JavaScript ISO biçimindeki süresi dolmuş reset tokenını aynı gün içinde reddeder", () => {
    const expired = new Date(Date.now() - 5 * 60_000).toISOString();
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)").run("expired", "user-1", expired);

    expect(findActivePasswordResetUserId(database, "expired")).toBeNull();
  });

  it("yalnız gelecekteki ve kullanılmamış reset tokenını kabul eder", () => {
    const active = new Date(Date.now() + 5 * 60_000).toISOString();
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)").run("active", "user-1", active);
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("used", "user-2", active);

    expect(findActivePasswordResetUserId(database, "active")).toBe("user-1");
    expect(findActivePasswordResetUserId(database, "used")).toBeNull();
  });

  it("eski, kullanılmış, bozuk ve aynı kullanıcıya ait önceki reset tokenlarını temizler", () => {
    const active = new Date(Date.now() + 5 * 60_000).toISOString();
    const expired = new Date(Date.now() - 5 * 60_000).toISOString();
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)").run("same-user", "user-1", active);
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)").run("expired", "user-2", expired);
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, 'geçersiz', NULL)").run("invalid", "user-3");
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("used", "user-4", active);
    database.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, NULL)").run("kept", "user-5", active);

    removeUnavailablePasswordResetTokens(database, "user-1");

    expect(database.prepare("SELECT token_hash FROM password_reset_tokens ORDER BY token_hash").all()).toEqual([{ token_hash: "kept" }]);
  });

  it("ISO biçimindeki süresi dolmuş veya bozuk oturumu siler ve etkin oturumu korur", () => {
    const active = new Date(Date.now() + 5 * 60_000).toISOString();
    const expired = new Date(Date.now() - 5 * 60_000).toISOString();
    database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run("active", "user-1", active);
    database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run("expired", "user-2", expired);
    database.prepare("INSERT INTO sessions VALUES (?, ?, 'bozuk')").run("invalid", "user-3");

    expect(findActiveSessionUserId(database, "expired")).toBeNull();
    expect(findActiveSessionUserId(database, "active")).toBe("user-1");
    removeExpiredSessions(database);

    expect(database.prepare("SELECT token_hash FROM sessions").all()).toEqual([{ token_hash: "active" }]);
  });
});
