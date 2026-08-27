import { describe, expect, it } from "vitest";
import { notificationClientReducer, type NotificationClientState } from "@/lib/notification-client-state";

const state: NotificationClientState = {
  items: [{ id: "old", type: "social", title: "Eski", body: "Eski bildirim", read_at: null, created_at: "2026-08-27T10:00:00.000Z", href: null }],
  requests: [{
    requestedAt: "2026-08-27T10:00:00.000Z",
    user: { id: "requester", username: "istek", displayName: "İstek", initials: "İS", color: "#0D8BFF", pattern: 1, city: "İstanbul", accountVisibility: "public", avatarData: null },
  }],
};

describe("bildirim istemci state'i", () => {
  it("yenilenen sunucu proplarını eski istemci state'inin yerine geçirir", () => {
    const nextItem = { ...state.items[0], id: "new", title: "Yeni" };
    const next = notificationClientReducer(state, { type: "synchronize", items: [nextItem], requests: [] });
    expect(next.items).toEqual([nextItem]);
    expect(next.requests).toEqual([]);
  });

  it("yerel okundu ve takip isteği işlemlerini deterministik uygular", () => {
    const read = notificationClientReducer(state, { type: "mark-all-read", readAt: "2026-08-27T11:00:00.000Z" });
    expect(read.items[0].read_at).toBe("2026-08-27T11:00:00.000Z");
    expect(notificationClientReducer(read, { type: "resolve-request", requesterId: "requester" }).requests).toEqual([]);
  });
});
