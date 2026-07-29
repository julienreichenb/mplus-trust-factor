import { describe, expect, it } from "vitest";
import { routeDefs } from "./routes";

describe("web router", () => {
  it("registers required foundation routes", () => {
    const names = routeDefs.map((route) => route.name);
    expect(names).toContain("home");
    expect(names).toContain("character");
    expect(names).toContain("compare");
    expect(names).toContain("admin-models");
    expect(names).toContain("admin-ability-catalog");
    expect(names).toContain("auth-signin");
    expect(names).toContain("auth-error");
    expect(names).toContain("account");
    expect(names).toContain("access-denied");
  });
});
