import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobil kaydırma performans sınırı", () => {
  it("non-passive touchmove dinleyicisini uygulama ömrü boyunca açık bırakmaz", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/PullToRefresh.tsx"), "utf8");
    const effectSetup = source.slice(source.indexOf('document.addEventListener("touchstart"'));
    expect(effectSetup).not.toContain('document.addEventListener("touchmove", move');
    expect(source).toContain("function listenForMove()");
    expect(source).toContain("stopListeningForMove();");
  });
});
