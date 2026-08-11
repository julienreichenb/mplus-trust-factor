import { describe, expect, it } from "vitest";
import {
  characterLacksBootstrapEvidence,
  eligibilityConflictNeedsBootstrapRepair,
  isBootstrapRepairRequired,
  shouldRepairCharacterBootstrap,
} from "./character-bootstrap-repair.js";

describe("character bootstrap repair triggers", () => {
  const complete = {
    level: 90,
    blizzardCharacterId: 123n,
    classId: "class-1",
    activeSpecId: "spec-1",
    role: "DPS" as const,
  };

  /** Myzouth production shape: shell row with null bootstrap fields. */
  const myzouthShape = {
    level: null as number | null,
    blizzardCharacterId: null as bigint | null,
    classId: null as string | null,
    activeSpecId: null as string | null,
    role: null as "DPS" | null,
  };

  it("detects Agent 11 incomplete shape: class/spec present but role null", () => {
    const agent11Shape = {
      level: 90,
      blizzardCharacterId: 999n,
      classId: "class-1",
      activeSpecId: "spec-1",
      role: null as "DPS" | null,
    };
    expect(characterLacksBootstrapEvidence(agent11Shape)).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...agent11Shape, role: "HEALER" })).toBe(false);
  });

  it("detects incomplete bootstrap evidence", () => {
    expect(characterLacksBootstrapEvidence({ ...complete, level: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, blizzardCharacterId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, classId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, activeSpecId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, role: null })).toBe(true);
    expect(characterLacksBootstrapEvidence(complete)).toBe(false);
    expect(characterLacksBootstrapEvidence(myzouthShape)).toBe(true);
  });

  it("flags Myzouth-shaped rows as repair-required even without a job", () => {
    expect(isBootstrapRepairRequired({ character: myzouthShape, latestJob: null })).toBe(true);
    expect(
      isBootstrapRepairRequired({
        character: myzouthShape,
        latestJob: {
          status: "FAILED",
          error: {
            code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
            message: "Character level is missing — refusing refresh (fail closed)",
          },
        },
      }),
    ).toBe(true);
    expect(isBootstrapRepairRequired({ character: complete, latestJob: null })).toBe(false);
  });

  it("repairs incomplete shells and prior UNKNOWN failures", () => {
    expect(
      shouldRepairCharacterBootstrap({
        character: { ...complete, level: null },
        latestJob: null,
        forceRetry: false,
        missingSeasonMythicEvidence: true,
      }),
    ).toBe(true);

    expect(
      shouldRepairCharacterBootstrap({
        character: complete,
        latestJob: {
          status: "FAILED",
          error: { code: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN" },
        },
        forceRetry: false,
        missingSeasonMythicEvidence: false,
      }),
    ).toBe(true);
  });

  it("does not repair ordinary complete characters with season score present", () => {
    expect(
      shouldRepairCharacterBootstrap({
        character: complete,
        latestJob: { status: "COMPLETED", error: null },
        forceRetry: false,
        missingSeasonMythicEvidence: false,
      }),
    ).toBe(false);
  });

  it("maps refresh conflicts to repair when bootstrap incomplete or UNKNOWN", () => {
    expect(
      eligibilityConflictNeedsBootstrapRepair({
        character: myzouthShape,
        eligibilityCode: "CHARACTER_BELOW_MAX_LEVEL",
      }),
    ).toBe(true);
    expect(
      eligibilityConflictNeedsBootstrapRepair({
        character: complete,
        eligibilityCode: "CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN",
      }),
    ).toBe(true);
    expect(
      eligibilityConflictNeedsBootstrapRepair({
        character: complete,
        eligibilityCode: "CHARACTER_BELOW_MAX_LEVEL",
      }),
    ).toBe(false);
  });

  /**
   * Agent 02 acceptance — missing current-season Mythic+ score fetches on normal resolve.
   */
  describe("scoring-stabilization: complete shell + missing season Mythic evidence", () => {
    it("fetches when season Mythic score is missing without forceRetry", () => {
      expect(
        shouldRepairCharacterBootstrap({
          character: complete,
          latestJob: null,
          forceRetry: false,
          missingSeasonMythicEvidence: true,
        }),
      ).toBe(true);
    });

    it("does not fetch when season Mythic score is already present", () => {
      expect(
        shouldRepairCharacterBootstrap({
          character: complete,
          latestJob: { status: "COMPLETED", error: null },
          forceRetry: false,
          missingSeasonMythicEvidence: false,
        }),
      ).toBe(false);
    });

    it("keeps bootstrapRepairRequired=false for NO_CURRENT_SEASON_MYTHIC_SCORE jobs", () => {
      expect(
        isBootstrapRepairRequired({
          character: complete,
          latestJob: {
            status: "FAILED",
            error: { code: "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE" },
          },
        }),
      ).toBe(false);
    });

    it("does not advertise bootstrap repair for NO_CURRENT_SEASON_MYTHIC_SCORE conflicts", () => {
      expect(
        eligibilityConflictNeedsBootstrapRepair({
          character: complete,
          eligibilityCode: "CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE",
        }),
      ).toBe(false);
    });
  });
});
