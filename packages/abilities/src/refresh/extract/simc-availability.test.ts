import { describe, expect, it } from "vitest";
import {
  deriveAvailabilityFromSimcMembership,
  membershipFromScope,
  mergeSimcMembership,
} from "./simc-availability.js";

describe("deriveAvailabilityFromSimcMembership", () => {
  it("maps racial race_spell membership to SHARED", () => {
    expect(
      deriveAvailabilityFromSimcMembership(membershipFromScope("race_spell"), "PLAYABLE_RACE"),
    ).toBe("SHARED");
  });

  it("maps talent_spell membership to TALENT", () => {
    expect(
      deriveAvailabilityFromSimcMembership(membershipFromScope("talent_spell"), "PLAYABLE_PLAYER"),
    ).toBe("TALENT");
  });

  it("maps class/spec membership to BASELINE", () => {
    expect(
      deriveAvailabilityFromSimcMembership(
        mergeSimcMembership(membershipFromScope("class_spell"), membershipFromScope("spec_spell")),
        "PLAYABLE_PLAYER",
      ),
    ).toBe("BASELINE");
  });

  it("prefers TALENT over BASELINE when both class_spell and talent_spell apply", () => {
    expect(
      deriveAvailabilityFromSimcMembership(
        mergeSimcMembership(membershipFromScope("class_spell"), membershipFromScope("talent_spell")),
        "PLAYABLE_PLAYER",
      ),
    ).toBe("TALENT");
  });

  it("prefers SHARED over TALENT when race_spell is present", () => {
    expect(
      deriveAvailabilityFromSimcMembership(
        mergeSimcMembership(membershipFromScope("race_spell"), membershipFromScope("talent_spell")),
        "PLAYABLE_RACE",
      ),
    ).toBe("SHARED");
  });

  it("maps pet talent tree ownership to PET_DEPENDENT", () => {
    expect(
      deriveAvailabilityFromSimcMembership(membershipFromScope("spec_spell"), "PET_TALENT_TREE"),
    ).toBe("PET_DEPENDENT");
  });

  it("derives BASELINE for Flying Serpent Kick pinned SimC membership (101545)", () => {
    const membership = mergeSimcMembership(
      membershipFromScope("class_spell"),
      membershipFromScope("spec_spell"),
    );
    expect(deriveAvailabilityFromSimcMembership(membership, "PLAYABLE_PLAYER")).toBe("BASELINE");
  });

  it("returns null when no membership flags are set", () => {
    expect(deriveAvailabilityFromSimcMembership(
      { classSpell: false, specSpell: false, raceSpell: false, talentSpell: false },
      "PLAYABLE_PLAYER",
    )).toBeNull();
  });
});
