import { describe, expect, it } from "vitest";
import { buildUserSearchKey, escapeSqlLike, normalizeUserSearchText } from "@/lib/user-search";

describe("Türkçe kullanıcı arama anahtarı", () => {
  it.each([
    ["Çayan", "cayan"],
    ["İPEK", "ipek"],
    ["IŞIK", "isik"],
    ["Gökçe Şule", "gokce sule"],
    ["  @ÇaYaN  ", "cayan"],
  ])("%s değerini %s olarak katlar", (value, expected) => {
    expect(normalizeUserSearchText(value)).toBe(expected);
  });

  it("kullanıcı adı ve görünen adı tek arama anahtarında birleştirir", () => {
    expect(buildUserSearchKey("ipek_runs", "İpek Işık")).toBe("ipek_runs ipek isik");
  });

  it("LIKE jokerlerini kullanıcı girdisi olarak kaçırır", () => {
    expect(escapeSqlLike("%_\\")).toBe("\\%\\_\\\\");
  });
});
