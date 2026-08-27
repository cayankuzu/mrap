import { describe, expect, it } from "vitest";
import { notificationCategory, notificationHref } from "@/lib/notification-presentation";

describe("bildirim sunum sözleşmesi", () => {
  it.each(["territory", "claim_confirmed", "territory_lost", "paint_confirmed"])("%s türünü alan kategorisine alır", (type) => {
    expect(notificationCategory(type)).toBe("territory");
    expect(notificationHref(type)).toBe("/play");
  });

  it.each(["social", "follow_request"])("%s türünü sosyal kategorisine ve oyuncu profiline bağlar", (type) => {
    expect(notificationCategory(type)).toBe("social");
    expect(notificationHref(type, "ada_1")).toBe("/users/ada_1");
  });

  it.each(["post_like", "post_comment"])("%s bildirimini tekil gönderiye bağlar", (type) => {
    expect(notificationCategory(type)).toBe("social");
    expect(notificationHref(type, "ada_1", "post", "post-42")).toBe("/posts/post-42");
  });

  it("geçersiz kaynak kimliğini profil fallback'ine kapatır", () => {
    expect(notificationHref("post_like", "ada_1", "post", "../settings")).toBe("/users/ada_1");
  });

  it("bilinmeyen türü güvenli sistem bildirimi olarak tutar", () => {
    expect(notificationCategory("unknown")).toBe("system");
    expect(notificationHref("unknown", "ada")).toBeNull();
  });
});
