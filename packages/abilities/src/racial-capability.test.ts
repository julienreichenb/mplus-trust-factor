import { describe, expect, it } from "vitest";
import {
  getAllRegisteredRules,
  resolveAbilityCapability,
} from "./index.js";

describe("racial resolveAbilityCapability", () => {
  const ruleByKey = (key: string) => {
    const found = getAllRegisteredRules().find((r) => r.canonicalKey === key);
    if (!found) throw new Error(`missing catalog rule ${key}`);
    return found;
  };
  const stoneform = () => ruleByKey("shared.racial.stoneform");
  const fireblood = () => ruleByKey("shared.racial.fireblood");
  const shadowmeld = () => ruleByKey("shared.racial.shadowmeld");
  const spatialRift = () => ruleByKey("shared.racial.spatial-rift");

  it("1. Night Elf + Shadowmeld → AVAILABLE", () => {
    expect(
      resolveAbilityCapability(shadowmeld(), { raceSlug: "night-elf" }).state,
    ).toBe("AVAILABLE");
  });

  it("2. Void Elf + Shadowmeld → NOT_AVAILABLE", () => {
    expect(
      resolveAbilityCapability(shadowmeld(), { raceSlug: "void-elf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("3. Void Elf + Spatial Rift → AVAILABLE movement utility", () => {
    const rift = spatialRift();
    expect(rift.category).toBe("MOVEMENT_UTILITY");
    expect(rift.raceSlugs).toEqual(["void-elf"]);
    expect(
      resolveAbilityCapability(rift, { raceSlug: "void-elf" }).state,
    ).toBe("AVAILABLE");
    expect(
      resolveAbilityCapability(rift, { raceSlug: "night-elf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("4. Dwarf + Stoneform → AVAILABLE", () => {
    expect(
      resolveAbilityCapability(stoneform(), { raceSlug: "dwarf" }).state,
    ).toBe("AVAILABLE");
  });

  it("5. Dark Iron + Stoneform → NOT_AVAILABLE", () => {
    expect(
      resolveAbilityCapability(stoneform(), { raceSlug: "dark-iron-dwarf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("6. Dark Iron + Fireblood → AVAILABLE", () => {
    expect(
      resolveAbilityCapability(fireblood(), { raceSlug: "dark-iron-dwarf" }).state,
    ).toBe("AVAILABLE");
    expect(
      resolveAbilityCapability(fireblood(), { raceSlug: "dwarf" }).state,
    ).toBe("NOT_AVAILABLE");
  });

  it("7. UNKNOWN race + observed racial → AVAILABLE for that rule only", () => {
    expect(resolveAbilityCapability(shadowmeld(), {}).state).toBe("UNKNOWN");
    expect(
      resolveAbilityCapability(shadowmeld(), { observedSpellIds: [58984] }).state,
    ).toBe("AVAILABLE");
    expect(
      resolveAbilityCapability(stoneform(), { observedSpellIds: [58984] }).state,
    ).toBe("UNKNOWN");
    expect(
      resolveAbilityCapability(spatialRift(), { observedSpellIds: [256948] }).state,
    ).toBe("AVAILABLE");
    expect(
      resolveAbilityCapability(shadowmeld(), { observedSpellIds: [256948] }).state,
    ).toBe("UNKNOWN");
  });

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
});
