import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listPostLikeActorsFromDatabase } from "@/lib/post-like-store";

describe("kompakt beğenenler store", () => {
  it("profil gizli alanlarını ve base64 medyayı liste payload'ına taşımaz", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color TEXT NOT NULL,
        email TEXT NOT NULL,
        bio TEXT NOT NULL,
        avatar_data TEXT,
        cover_data TEXT
      );
      CREATE TABLE likes (
        user_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users VALUES (
        'user-1', 'gezgin', 'Ada Yılmaz', '#0D8BFF', 'SECRET@example.test',
        'SECRET_BIO', 'data:image/jpeg;base64,/9j/SECRET_AVATAR', 'SECRET_COVER'
      );
      INSERT INTO likes (user_id, post_id) VALUES ('user-1', 'post-1');
    `);

    const users = listPostLikeActorsFromDatabase(database, "post-1");
    const serialized = JSON.stringify(users);

    expect(users[0]).toEqual({
      id: "user-1",
      username: "gezgin",
      displayName: "Ada Yılmaz",
      initials: "AY",
      color: "#0D8BFF",
      avatarData: "/api/users/user-1/avatar",
    });
    expect(serialized).not.toMatch(/SECRET|base64|example\.test/i);
    expect(serialized.length).toBeLessThan(240);
    database.close();
  });

  it("sorgu limitini kapalı aralıkta doğrular", () => {
    const database = new DatabaseSync(":memory:");
    expect(() => listPostLikeActorsFromDatabase(database, "post-1", 0)).toThrow(RangeError);
    expect(() => listPostLikeActorsFromDatabase(database, "post-1", 101)).toThrow(RangeError);
    database.close();
  });
});
