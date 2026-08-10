import { describe, expect, it } from "vitest";
import { ACTIVE_EXPANSION_METADATA_V1 } from "./game-metadata.js";
import {
  CHARACTER_BELOW_MAX_LEVEL,
  CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE,
  CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1,
  CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN,
  MAX_CHARACTER_LEVEL_CONFIG_KEY,
  buildCharacterRefreshEligibilityPolicy,
  evaluateCharacterRefreshEligibility,
  getConfiguredMaxCharacterLevel,
  isCharacterRefreshEligibilityCode,
} from "./character-refresh-eligibility.js";

describe("character refresh eligibility", () => {
  it("centralizes max level via runtime helper (default from expansion metadata)", () => {
    expect(MAX_CHARACTER_LEVEL_CONFIG_KEY).toBe("MAX_CHARACTER_LEVEL");
    expect(getConfiguredMaxCharacterLevel()).toBe(ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel);
    expect(getConfiguredMaxCharacterLevel()).toBe(90);
    expect(CHARACTER_REFRESH_ELIGIBILITY_POLICY_V1.maxCharacterLevel).toBe(90);
    expect(buildCharacterRefreshEligibilityPolicy(91).maxCharacterLevel).toBe(91);
  });

  it("blocks level 89 when max level is 90", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 89,
      currentSeasonMythicScore: 2500,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_BELOW_MAX_LEVEL);
  });

  it("accepts level 90 when current-season score is present", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 90,
      currentSeasonMythicScore: 1200,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(true);
    expect(result.code).toBeNull();
  });

  it("blocks missing current-season score (confirmed absence)", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 90,
      currentSeasonMythicScore: null,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE);
  });

  it("treats unevaluated current-season score as UNKNOWN (repairable)", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 90,
      currentSeasonMythicScore: undefined,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN);
  });

  it("treats zero score as missing", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 90,
      currentSeasonMythicScore: 0,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_NO_CURRENT_SEASON_MYTHIC_SCORE);
  });

  it("fails closed when level is absent", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: null,
      currentSeasonMythicScore: 2500,
      authoritativeSeasonKnown: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN);
  });

  it("fails closed when season is unknown", () => {
    const result = evaluateCharacterRefreshEligibility({
      characterLevel: 90,
      currentSeasonMythicScore: 2500,
      authoritativeSeasonKnown: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.code).toBe(CHARACTER_REFRESH_ELIGIBILITY_UNKNOWN);
  });

  it("recognizes eligibility codes", () => {
    expect(isCharacterRefreshEligibilityCode(CHARACTER_BELOW_MAX_LEVEL)).toBe(true);
    expect(isCharacterRefreshEligibilityCode("REFRESH_CONTRACT_PREFLIGHT_MISMATCH")).toBe(false);
  });
});
