import { describe, expect, it } from "vitest";
import {
  OWNED_CHARACTER_RELEVANCE_POLICY_V1,
  evaluateOwnedCharacterRelevanceV1,
} from "./owned-character-relevance-policy.js";
import { ACTIVE_EXPANSION_METADATA_V1 } from "./game-metadata.js";

describe("OWNED_CHARACTER_RELEVANCE_POLICY_V1", () => {
  it("centralizes V1 constants (not env-overridable)", () => {
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.version).toBe("v1");
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.minCurrentSeasonMythicRating).toBe(1000);
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel).toBe(
      ACTIVE_EXPANSION_METADATA_V1.maxCharacterLevel,
    );
    expect(OWNED_CHARACTER_RELEVANCE_POLICY_V1.maxCharacterLevel).toBe(80);
  });

  it("excludes non-CURRENT ownership", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "HISTORICAL",
      characterLevel: 80,
      currentSeasonMythicRating: 2500,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("HISTORICAL_OR_INACTIVE");
  });

  it("excludes non-max-level characters without rating requests implied", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 70,
      currentSeasonMythicRating: null,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("BELOW_MAX_LEVEL");
  });

  it("marks rating below threshold irrelevant", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 999,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("BELOW_RATING_THRESHOLD");
  });

  it("marks rating at threshold relevant", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 1000,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("MYTHIC_RATING_THRESHOLD");
  });

  it("keeps explicit primary relevant", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 0,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: true,
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("EXPLICIT_PRIMARY");
  });

  it("keeps characters with a public score relevant", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 100,
      hasValidPublicScore: true,
      hasActiveOrQueuedRefresh: false,
      isPrimary: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("EXISTING_PUBLIC_SCORE");
  });

  it("keeps queued/active refresh relevant", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 100,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: true,
      isPrimary: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain("ACTIVE_OR_QUEUED_REFRESH");
  });

  it("returns policy version in diagnostics", () => {
    const result = evaluateOwnedCharacterRelevanceV1({
      ownershipStatus: "CURRENT",
      characterLevel: 80,
      currentSeasonMythicRating: 1500,
      hasValidPublicScore: false,
      hasActiveOrQueuedRefresh: false,
      isPrimary: false,
    });
    expect(result.policyVersion).toBe("v1");
  });
});
