import { describe, expect, it } from "vitest";
import { userMediaReference } from "@/lib/user-media-reference";

describe("userMediaReference", () => {
  it("saklı görüntüyü taşımadan korumalı URL üretir", () => {
    expect(userMediaReference("user one", "avatar", true)).toBe("/api/users/user%20one/avatar");
    expect(userMediaReference("user one", "cover", true)).toBe("/api/users/user%20one/cover");
    expect(userMediaReference("user one", "avatar", false)).toBeNull();
  });
});
