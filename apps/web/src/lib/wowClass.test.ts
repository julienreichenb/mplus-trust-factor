import { describe, expect, it } from "vitest";
import { contrastingTextColor } from "./wowClass";

describe("contrastingTextColor", () => {
  it("uses black on light class colors and white on dark ones", () => {
    expect(contrastingTextColor("#FFFFFF")).toBe("#000000");
    expect(contrastingTextColor("#FFF468")).toBe("#000000");
    expect(contrastingTextColor("#00FF98")).toBe("#000000");
    expect(contrastingTextColor("#0070DD")).toBe("#ffffff");
    expect(contrastingTextColor("#C41E3A")).toBe("#ffffff");
    expect(contrastingTextColor("#A330C9")).toBe("#ffffff");
  });

  it("falls back to white for non-hex values", () => {
    expect(contrastingTextColor("var(--color-text)")).toBe("#ffffff");
  });
});
