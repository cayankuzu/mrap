import { describe, expect, it } from "vitest";
import { territoryProfilePath } from "@/lib/territory-profile-path";

describe("harita sahiplik profil yolu", () => {
  it("demo kullanıcısının kendi alanını demo profiline yönlendirir", () => {
    expect(territoryProfilePath({ demo: true, username: "cayan", currentUsername: "cayan" })).toBe("/demo/profile");
  });

  it("demo rakibini demo profiline, gerçek rakibi gerçek profile yönlendirir", () => {
    expect(territoryProfilePath({ demo: true, username: "ışık kullanıcı", currentUsername: "cayan" })).toBe("/demo/users/%C4%B1%C5%9F%C4%B1k%20kullan%C4%B1c%C4%B1");
    expect(territoryProfilePath({ demo: false, username: "defnek", currentUsername: "cayan" })).toBe("/users/defnek");
  });
});
