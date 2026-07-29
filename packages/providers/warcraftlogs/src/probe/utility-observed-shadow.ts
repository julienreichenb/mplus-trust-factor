/**
 * Shadow-mode OBSERVED_CONTRIBUTION orchestration (production-safe boundary).
 *
 * Call graph (UTILITY_PUBLICATION_MODE=shadow):
 *
 *   refresh-pipeline
 *     ├── legacy combat-facts → UTILITY metrics (UNCHANGED public path)
 *     ├── calculateScore(mergedObservations) → public Trust (UNCHANGED)
 *     └── runUtilityObservedShadowPass  [diagnostics only]
 *           ├── assertUtilityPublicationNotEnabled()  // published → throw
 *           ├── load shared evidence from RunAnalysis / store (0 WCL if cached)
 *           ├── if incomplete → status SKIPPED_NO_PERSISTED_EVIDENCE
 *           ├── else scoreObservedContribution(...)
 *           └── persist summary under utility-observed-shadow-v1
 *                 (never merges into UTILITY observations / Trust)
 *
 * UTILITY_PUBLICATION_MODE=off → no-op
 * UTILITY_PUBLICATION_MODE=published → safety guard only (not implemented)
 */
import {
  assertUtilityPublicationNotEnabled,
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
  | "BLOCKED_PUBLISHED_MODE";

export interface UtilityShadowPassResult {
  analysisVersion: typeof UTILITY_OBSERVED_SHADOW_ANALYSIS_VERSION;
  publicationMode: UtilityPublicationMode;
  status: UtilityShadowPassStatus;
  altersPublicUtility: false;
  altersPublicTrustScore: false;
  replacesLastKnownGoodUtility: false;
  detailedWclEventCallsMade: number;
  researchModeAllowedInPublication: false;
  semantics: typeof UTILITY_OBSERVED_SCORE_SEMANTICS;
  score: ObservedContributionResult | null;
  adminDiagnosticsOnly: true;
}

/**
 * Compute shadow OBSERVED_CONTRIBUTION. Never mutates public Trust inputs.
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
    adminDiagnosticsOnly: true,
  };

  if (mode === "off") {
    return { ...base, status: "OFF", score: null };
  }

  if (mode === "published") {
    return { ...base, status: "BLOCKED_PUBLISHED_MODE", score: null };
  }

  // mode === "shadow"
  assertUtilityPublicationNotEnabled(mode);

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
 * Guard used by refresh: OBSERVED_CONTRIBUTION must not appear in public UTILITY observations.
 */
export function filterOutObservedContributionFromPublicUtility<
  T extends { metricKey: string; context?: unknown },
>(observations: T[]): T[] {
  return observations.filter((o) => {
    const ctx =
      o.context && typeof o.context === "object"
        ? (o.context as Record<string, unknown>)
        : null;
    const mode = ctx?.utilityScoringMode ?? ctx?.scoringMode;
    return mode !== "OBSERVED_CONTRIBUTION" && mode !== "OPPORTUNITY_RESEARCH";
  });
}
