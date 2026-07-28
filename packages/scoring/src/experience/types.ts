import type {
  ExperienceCharacterHistory,
  ExperienceHistoryMode,
  ExperienceLinkageSource,
  ExperienceSeasonFact,
  ExperienceSummaryDTO,
} from "@mplus/contracts";

export type {
  ExperienceCharacterHistory,
  ExperienceHistoryMode,
  ExperienceLinkageSource,
  ExperienceSeasonFact,
  ExperienceSummaryDTO,
};

export interface ComputeExperienceInput {
  /**
   * Public mode: exactly one unverified (or single) character history.
   * Verified mode: one or more characters with `verified: true`.
   */
  characters: ExperienceCharacterHistory[];
  /** Expected dungeon count for current-season breadth normalization (usually 8). */
  expectedDungeonCount: number;
  /**
   * When true and at least one verified character is present, mode becomes
   * VERIFIED_ACCOUNT_HISTORY. Public lookups must leave this false.
   */
  accountLinkageVerified: boolean;
  linkageSource?: ExperienceLinkageSource;
  /** Target active-season count that maps longevity toward 100. */
  longevityTargetSeasons?: number;
  nowMs?: number;
}

export interface ComputeExperienceResult {
  summary: ExperienceSummaryDTO;
  experienceScore: number | null;
  confidence: number;
  observations: {
    currentPeak: number | null;
    currentBreadth: number | null;
    historicalPeak: number | null;
    longevity: number | null;
  };
  /** Internal weights after removing unavailable contributors (renormalized). */
  effectiveWeights: {
    currentPeak: number;
    currentBreadth: number;
    historicalPeak: number;
    longevity: number;
  };
}
