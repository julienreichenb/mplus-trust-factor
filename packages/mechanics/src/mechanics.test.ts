import { describe, expect, it } from "vitest";
import {
  MINIMAL_SEED_CATALOG,
  classifyDamageEvent,
  createEmptyCatalog,
  matchMechanicRules,
  validateMechanicCatalog,
} from "./index.js";

describe("mechanics catalog", () => {
  it("handles empty catalog safely", () => {
    const empty = createEmptyCatalog();
    expect(validateMechanicCatalog(empty)).toEqual([]);
    const result = classifyDamageEvent(empty, {
      seasonSlug: "placeholder-current",
      dungeonSlug: "example-dungeon",
      spellId: 400001,
    });
    expect(result.classification).toBe("UNKNOWN");
  });

  it("never classifies unknown damage as avoidable", () => {
    const result = classifyDamageEvent(MINIMAL_SEED_CATALOG, {
      seasonSlug: "placeholder-current",
      dungeonSlug: "example-dungeon",
      spellId: 999999,
    });
    expect(result.classification).toBe("UNKNOWN");
  });

  it("matches avoidable and soak rules", () => {
    expect(
      classifyDamageEvent(MINIMAL_SEED_CATALOG, {
        seasonSlug: "placeholder-current",
        dungeonSlug: "example-dungeon",
        spellId: 400001,
      }).classification,
    ).toBe("AVOIDABLE");
    expect(
      classifyDamageEvent(MINIMAL_SEED_CATALOG, {
        seasonSlug: "placeholder-current",
        dungeonSlug: "example-dungeon",
        spellId: 400003,
      }).classification,
    ).toBe("SOAK");
  });

  it("filters by role", () => {
    const matches = matchMechanicRules(MINIMAL_SEED_CATALOG, {
      seasonSlug: "placeholder-current",
      dungeonSlug: "example-dungeon",
      spellId: 400010,
      role: "DPS",
      ruleTypes: ["PRIORITY_INTERRUPT"],
    });
    expect(matches).toHaveLength(1);
  });
});
