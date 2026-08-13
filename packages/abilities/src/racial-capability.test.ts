import { describe, expect, it } from "vitest";
import {
  getAllRegisteredRules,
  resolveAbilityCapability,
} from "./index.js";

describe("racial resolveAbilityCapability", () => {
  const stoneform = () =>
    getAllRegisteredRules().find((r) => r.canonicalKey === "shared.racial.stoneform")!;
  const shadowmeld = () =>
    getAllRegisteredRules().find((r) => r.canonicalKey === "shared.racial.shadowmeld")!;

  it("historical race wins over missing observation", () => {
    expect(
      resolveAbilityCapability(stoneform(), { raceSlug: "dwarf" }).reason,
    ).toBe("race_compatible");
  });

  it("current-profile-style wrong race is rejected without observation", () => {
    expect(
      resolveAbilityCapability(stoneform(), { raceSlug: "night-elf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("observed Shadowmeld proves availability without race metadata", () => {
    expect(
      resolveAbilityCapability(shadowmeld(), { observedSpellIds: [58984] }).state,
    ).toBe("AVAILABLE");
  });
});
