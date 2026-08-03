import { describe, expect, it } from "vitest";
import { canonicalRoleForClassSpec } from "@mplus/abilities";
import { resolveAuthoritativeSpecRole } from "./character-repository.js";

describe("resolveAuthoritativeSpecRole (static catalog SoT)", () => {
  it("derives HEALER from catalog without a provider role", () => {
    expect(resolveAuthoritativeSpecRole({ classSlug: "paladin", specSlug: "holy" })).toBe(
      "HEALER",
    );
  });

  it("derives TANK from catalog without a provider role", () => {
    expect(
      resolveAuthoritativeSpecRole({ classSlug: "warrior", specSlug: "protection" }),
    ).toBe("TANK");
  });

  it("derives DPS from catalog without a provider role", () => {
    expect(resolveAuthoritativeSpecRole({ classSlug: "mage", specSlug: "fire" })).toBe("DPS");
  });

  it("catalog specialization role is authoritative (provider role is irrelevant)", () => {
    // canonicalRoleForClassSpec never accepts a provider role — catalog always wins.
    expect(canonicalRoleForClassSpec("paladin", "holy")).toBe("HEALER");
    expect(canonicalRoleForClassSpec("priest", "holy")).toBe("HEALER");
    expect(resolveAuthoritativeSpecRole({ classSlug: "paladin", specSlug: "holy" })).toBe(
      "HEALER",
    );
  });

  it("fails closed for unknown class/spec (no fabricated DPS)", () => {
    expect(
      resolveAuthoritativeSpecRole({ classSlug: "not-a-class", specSlug: "not-a-spec" }),
    ).toBeNull();
    expect(canonicalRoleForClassSpec("not-a-class", "not-a-spec")).toBeNull();
  });
});
