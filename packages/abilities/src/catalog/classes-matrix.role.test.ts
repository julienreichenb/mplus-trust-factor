import { describe, expect, it } from "vitest";
import {
  RETAIL_CLASS_MATRIX,
  canonicalRoleForClassSpec,
  findRetailSpecIdentityByBlizzardSpecId,
  findSpecDefinition,
  normalizeRetailClassSlug,
} from "./classes-matrix.js";
import type { AbilityRole } from "../types.js";

const PLAYABLE_ROLES = new Set<AbilityRole>(["DPS", "TANK", "HEALER"]);

describe("RETAIL_CLASS_MATRIX specialization → role catalog", () => {
  it("every supported specialization has exactly one playable role", () => {
    const seen = new Set<string>();
    let specCount = 0;

    for (const cls of RETAIL_CLASS_MATRIX) {
      expect(cls.specs.length).toBeGreaterThan(0);
      for (const spec of cls.specs) {
        specCount += 1;
        const key = `${cls.slug}/${spec.slug}`;
        expect(seen.has(key), `duplicate class/spec entry: ${key}`).toBe(false);
        seen.add(key);

        expect(
          PLAYABLE_ROLES.has(spec.role),
          `${key} role must be DPS|TANK|HEALER, got ${String(spec.role)}`,
        ).toBe(true);

        // Lookup API returns the same single role (no ambiguity / second SoT).
        expect(canonicalRoleForClassSpec(cls.slug, spec.slug)).toBe(spec.role);
        expect(findSpecDefinition(cls.slug, spec.slug)?.role).toBe(spec.role);
      }
    }

    expect(specCount).toBe(seen.size);
    expect(specCount).toBeGreaterThanOrEqual(40);
  });

  it("unknown class/spec fails closed (null, never fabricated)", () => {
    expect(canonicalRoleForClassSpec("not-a-class", "not-a-spec")).toBeNull();
    expect(canonicalRoleForClassSpec("mage", "not-a-spec")).toBeNull();
    expect(canonicalRoleForClassSpec("not-a-class", "fire")).toBeNull();
  });

  it("covers healer, tank, and dps specializations", () => {
    const roles = new Set(
      RETAIL_CLASS_MATRIX.flatMap((c) => c.specs.map((s) => s.role)),
    );
    expect(roles.has("HEALER")).toBe(true);
    expect(roles.has("TANK")).toBe(true);
    expect(roles.has("DPS")).toBe(true);
  });

  it("normalizes WCL class slugs and resolves CombatantInfo spec IDs", () => {
    expect(normalizeRetailClassSlug("deathknight")).toBe("death-knight");
    expect(normalizeRetailClassSlug("demonhunter")).toBe("demon-hunter");
    expect(normalizeRetailClassSlug("warlock")).toBe("warlock");
    expect(findRetailSpecIdentityByBlizzardSpecId(104)).toEqual({
      classSlug: "druid",
      specSlug: "guardian",
      role: "TANK",
      blizzardSpecId: 104,
      blizzardClassId: 11,
    });
    expect(findRetailSpecIdentityByBlizzardSpecId(252)?.specSlug).toBe("unholy");
    expect(findRetailSpecIdentityByBlizzardSpecId(999999)).toBeNull();
  });
});
