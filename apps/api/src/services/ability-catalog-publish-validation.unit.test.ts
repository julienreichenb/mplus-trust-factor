import { describe, expect, it } from "vitest";
import { formatArtifactValidationIssue } from "@mplus/abilities/release";

describe("publish validation visibility", () => {
  it("formats structured validation issues for publish failure responses", () => {
    const errors = [
      {
        severity: "error" as const,
        code: "DUPLICATE_SPELL_CONFLICT",
        canonicalKey: "shared.racial.heroism",
        message: "Spell 32182 conflicts between shaman.bloodlust.bloodlust and shared.racial.heroism",
      },
      {
        severity: "error" as const,
        code: "UNKNOWN_RACE_REF",
        canonicalKey: "shared.racial.holy-prism",
        message: "Rule references unknown race haranir",
      },
    ];
    expect(errors.map(formatArtifactValidationIssue)).toEqual([
      "DUPLICATE_SPELL_CONFLICT | shared.racial.heroism: Spell 32182 conflicts between shaman.bloodlust.bloodlust and shared.racial.heroism",
      "UNKNOWN_RACE_REF | shared.racial.holy-prism: Rule references unknown race haranir",
    ]);
  });
});
