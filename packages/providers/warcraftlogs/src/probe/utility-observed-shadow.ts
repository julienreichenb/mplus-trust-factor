/**
 * OBSERVED_CONTRIBUTION orchestration for shadow + published modes.
 *
 * Call graph:
 *   refresh-pipeline
 *     ├── combat-facts Utility (legacy; stripped when published)
 *     ├── runUtilityObservedShadowPass  [compute score]
 *     │     off → OFF
 *     │     shadow|published → score when evidence present (SHADOW_SCORED)
 *     └── applyUtilityPublicationBoundary
 *           ├── shadow → diagnostics only; public Utility unchanged
 *           ├── published + eligible → emit utility.observed_contribution
 *           └── published + ineligible → Utility UNAVAILABLE (no fabricated score)
 */
import {
  getUtilityPublicationMode,
  isUtilityResearchAllowedInPublication,
  UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION,
  type UtilityPublicationMode,
} from "./utility-publication-mode.js";
import {
  scoreObservedContribution,
  type ObservedContributionResult,
} from "./utility-v3_2-observed-contribution.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityOpportunity } from "./utility-opportunity-types.js";
import type { UtilityV2RawRunBundle } from "./utility-v2-types.js";
import { UTILITY_OBSERVED_SCORE_SEMANTICS } from "./utility-observed-semantics.js";

export interface UtilityShadowPassInput {
  mode?: UtilityPublicationMode;
  runs: UtilityNormalizedRun[];
  rawByRunId: Map<string, UtilityV2RawRunBundle>;
  masterByReport: Map<
    string,
    {
      actors: Array<{
        id: number;
        name?: string;
        type: string;
        subType?: string | null;
        petOwner?: number | null;
      }>;
    }
  >;
  opportunities: UtilityOpportunity[];
  mechanicCatalogCoverageObserved?: number;
  hostileCastEventsByRun?: Map<string, Array<Record<string, unknown>>>;
  /** When false, skip scoring (shared evidence missing). */
  hasPersistedSharedEvidence: boolean;
  detailedWclEventCallsMade?: number;
}

export type UtilityShadowPassStatus =
  | "OFF"
  | "SHADOW_SCORED"
  | "SKIPPED_NO_PERSISTED_EVIDENCE"
  | "SKIPPED_EMPTY_RUNS"
  /** @deprecated Published mode now scores; eligibility is a separate gate. */
  | "BLOCKED_PUBLISHED_MODE";

export interface UtilityShadowPassResult {
  analysisVersion: typeof UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION;
  publicationMode: UtilityPublicationMode;
  status: UtilityShadowPassStatus;
  /** Always false here — publication boundary sets public mutation flags. */
  altersPublicUtility: false;
  altersPublicTrustScore: false;
  replacesLastKnownGoodUtility: false;
  detailedWclEventCallsMade: number;
  researchModeAllowedInPublication: false;
  semantics: typeof UTILITY_OBSERVED_SCORE_SEMANTICS;
  score: ObservedContributionResult | null;
  adminDiagnosticsOnly: boolean;
}

/**
 * Compute OBSERVED_CONTRIBUTION for shadow or published mode.
 * Does not mutate public Trust inputs — callers must apply publication eligibility.
 */
export function runUtilityObservedShadowPass(
  input: UtilityShadowPassInput,
): UtilityShadowPassResult {
  const mode = input.mode ?? getUtilityPublicationMode();
  const base: Omit<UtilityShadowPassResult, "status" | "score"> = {
    analysisVersion: UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION,
    publicationMode: mode,
    altersPublicUtility: false,
    altersPublicTrustScore: false,
    replacesLastKnownGoodUtility: false,
    detailedWclEventCallsMade: input.detailedWclEventCallsMade ?? 0,
    researchModeAllowedInPublication: false,
    semantics: UTILITY_OBSERVED_SCORE_SEMANTICS,
    adminDiagnosticsOnly: mode !== "published",
  };

  if (mode === "off") {
    return { ...base, status: "OFF", score: null };
  }

  if (isUtilityResearchAllowedInPublication()) {
    throw new Error("OPPORTUNITY_RESEARCH must never enter publication");
  }

  if (!input.hasPersistedSharedEvidence) {
    return { ...base, status: "SKIPPED_NO_PERSISTED_EVIDENCE", score: null };
  }

  if (input.runs.length === 0) {
    return { ...base, status: "SKIPPED_EMPTY_RUNS", score: null };
  }

  const score = scoreObservedContribution({
    runs: input.runs,
    rawByRunId: input.rawByRunId,
    masterByReport: input.masterByReport,
    opportunities: input.opportunities,
    mechanicCatalogCoverageObserved: input.mechanicCatalogCoverageObserved,
    hostileCastEventsByRun: input.hostileCastEventsByRun,
  });

  return {
    ...base,
    status: "SHADOW_SCORED",
    score,
  };
}

/**
 * Strip research/observed modes from public Utility unless explicitly publication-approved.
 */
export function filterOutObservedContributionFromPublicUtility<
  T extends { metricKey: string; context?: unknown },
>(observations: T[]): T[] {
  return observations.filter((o) => {
    const ctx =
      o.context && typeof o.context === "object"
        ? (o.context as Record<string, unknown>)
        : null;
    if (ctx?.utilityPublicationApproved === true) return true;
    const mode = ctx?.utilityScoringMode ?? ctx?.scoringMode;
    return mode !== "OBSERVED_CONTRIBUTION" && mode !== "OPPORTUNITY_RESEARCH";
  });
}

/** Remove all UTILITY-dimension observations (combat-facts + observed). */
export function stripAllUtilityObservations<T extends { dimension?: string; metricKey: string }>(
  observations: T[],
): T[] {
  return observations.filter((o) => {
    if (o.dimension === "UTILITY") return false;
    return !o.metricKey.startsWith("utility.");
  });
}
