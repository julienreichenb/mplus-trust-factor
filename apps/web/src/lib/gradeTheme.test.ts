import { describe, expect, it } from "vitest";
import { gradeThemeCssVars, resolveGradeTheme } from "./gradeTheme";

describe("gradeTheme", () => {
  it("returns gold accents for missing or unrated grades", () => {
    expect(resolveGradeTheme(null).base).toBe("#f4d58d");
    expect(resolveGradeTheme("U").rgb).toBe("232 184 74");
  });

  it("exposes soft/mid/deep variants per rated tier", () => {
    const a = resolveGradeTheme("A");
    expect(a.base).toBe("#a3e635");
    expect(a.soft).not.toBe(a.deep);
    expect(resolveGradeTheme("S").base).toBe("#38bdf8");
    expect(gradeThemeCssVars("B")["--color-brand"]).toBe("#14b8a6");
    expect(gradeThemeCssVars("B")["--color-rank-rgb"]).toBe("45 212 191");
  });
});
