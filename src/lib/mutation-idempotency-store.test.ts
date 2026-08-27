import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  createMutationPayloadHash,
  findCommentIdempotencyReplay,
  findPostIdempotencyReplay,
  IdempotencyPayloadConflictError,
} from "@/lib/mutation-idempotency-store";

function setup() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      idempotency_key TEXT,
      payload_hash TEXT
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      idempotency_key TEXT,
      payload_hash TEXT
    );
  `);
  return database;
}

describe("mutation idempotency store", () => {
  it("canonical JSON içeriğini SHA-256 ile sabit biçimde özetler", () => {
    const payload = { territoryId: "territory-1", title: "Başlık", images: ["image"] };
    expect(createMutationPayloadHash(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(createMutationPayloadHash(payload)).toBe(createMutationPayloadHash({ territoryId: "territory-1", title: "Başlık", images: ["image"] }));
    expect(createMutationPayloadHash(payload)).not.toBe(createMutationPayloadHash({ ...payload, title: "Başka" }));
  });

  it("aynı gönderi anahtarı ve aynı hash için mevcut sonucu replay eder", () => {
    const database = setup();
    const hash = createMutationPayloadHash({ title: "A" });
    database.prepare("INSERT INTO posts VALUES (?, ?, ?, ?)").run("post-1", "user-1", "post-key-12345678", hash);

    expect(findPostIdempotencyReplay(database, "user-1", "post-key-12345678", hash)).toBe("post-1");
    expect(findPostIdempotencyReplay(database, "user-2", "post-key-12345678", hash)).toBeNull();
    expect(() => findPostIdempotencyReplay(database, "user-1", "post-key-12345678", createMutationPayloadHash({ title: "B" })))
      .toThrow(IdempotencyPayloadConflictError);
  });

  it("yorum replay kapsamını kullanıcı ve gönderiye birlikte bağlar", () => {
    const database = setup();
    const hash = createMutationPayloadHash({ body: "Merhaba" });
    database.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").run("comment-1", "user-1", "post-1", "comment-key-1234", hash);

    expect(findCommentIdempotencyReplay(database, "user-1", "post-1", "comment-key-1234", hash)).toBe("comment-1");
    expect(findCommentIdempotencyReplay(database, "user-1", "post-2", "comment-key-1234", hash)).toBeNull();
    expect(() => findCommentIdempotencyReplay(database, "user-1", "post-1", "comment-key-1234", createMutationPayloadHash({ body: "Değişti" })))
      .toThrow(IdempotencyPayloadConflictError);
  });
});
