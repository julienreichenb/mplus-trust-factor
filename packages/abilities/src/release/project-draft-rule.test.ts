import { describe, expect, it } from "vitest";
import { rule } from "../catalog/rule.js";
import type { ReleaseTopology } from "./types.js";
import {
  filterRaceSlugsForTopology,
  formatArtifactValidationIssue,
  isRedundantAddAgainstActiveCatalog,
  projectDraftRuleForRelease,
} from "./project-draft-rule.js";

const topology: ReleaseTopology = {
  classes: [],
  races: [
    { slug: "human", blizzardRaceIds: [1] },
    { slug: "orc", blizzardRaceIds: [2] },
  ],
};

describe("projectDraftRuleForRelease", () => {
  it("strips EXTERNAL_ONLY races not present in topology", () => {
    const draft = rule({
      canonicalKey: "shared.racial.holy-prism",
      name: "Holy Prism",
      spellIds: [114165],
      classSlug: null,
      roles: ["DPS"],
      category: "GROUP_UTILITY",
      raceSlugs: ["human", "haranir", "orc"],
      availability: "TALENT",
    });
    const projected = projectDraftRuleForRelease(draft, topology);
    expect(projected.raceSlugs).toEqual(["human", "orc"]);
  });

  it("treats heroism add as redundant when bloodlust already owns alias 32182", () => {
    const bloodlust = rule({
      canonicalKey: "shaman.bloodlust.bloodlust",
      name: "Bloodlust / Heroism",
      spellIds: [2825],
      aliases: [32182],
      classSlug: "shaman",
      roles: ["DPS", "HEALER", "TANK"],
      category: "BLOODLUST",
    });
    const heroism = rule({
      canonicalKey: "shared.racial.heroism",
      name: "Heroism",
      spellIds: [32182],
      classSlug: null,
      roles: ["DPS"],
      category: "BLOODLUST",
      raceSlugs: ["human"],
      availability: "BASELINE",
    });
    expect(isRedundantAddAgainstActiveCatalog(heroism, [bloodlust])).toBe(true);
    expect(isRedundantAddAgainstActiveCatalog(heroism, [])).toBe(false);
  });

  it("formats validation issues for operators", () => {
    expect(
      formatArtifactValidationIssue({
        code: "UNKNOWN_RACE_REF",
        canonicalKey: "shared.racial.holy-prism",
        message: "Rule references unknown race haranir",
      }),
    ).toBe("UNKNOWN_RACE_REF | shared.racial.holy-prism: Rule references unknown race haranir");
  });

  it("filterRaceSlugsForTopology returns undefined when all races are external", () => {
    expect(filterRaceSlugsForTopology(["haranir"], topology)).toBeUndefined();
  });
});
