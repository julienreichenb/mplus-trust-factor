import { describe, expect, it } from "vitest";
import {
  characterLacksBootstrapEvidence,
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

  it("detects incomplete bootstrap evidence", () => {
    expect(characterLacksBootstrapEvidence({ ...complete, level: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, blizzardCharacterId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, classId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, activeSpecId: null })).toBe(true);
    expect(characterLacksBootstrapEvidence({ ...complete, role: null })).toBe(true);
    expect(characterLacksBootstrapEvidence(complete)).toBe(false);
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

  it("does not repair ordinary complete characters", () => {
    expect(
      shouldRepairCharacterBootstrap({
        character: complete,
        latestJob: { status: "COMPLETED", error: null },
        forceRetry: false,
        missingSeasonMythicEvidence: false,
      }),
    ).toBe(false);

    expect(
      shouldRepairCharacterBootstrap({
        character: complete,
        latestJob: null,
        forceRetry: false,
        missingSeasonMythicEvidence: true,
      }),
    ).toBe(false);
  });

  it("allows forceRetry to refresh missing season Mythic+ evidence", () => {
    expect(
      shouldRepairCharacterBootstrap({
        character: complete,
        latestJob: null,
        forceRetry: true,
        missingSeasonMythicEvidence: true,
      }),
    ).toBe(true);
  });
});
