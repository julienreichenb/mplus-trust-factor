/**
 * Utility publication eligibility gates (OBSERVED_CONTRIBUTION → public Trust).
 * Thresholds come from the active score model config (v6+), never from environment.
 */
export const UTILITY_PUBLICATION_METRIC_KEY = "utility.observed_contribution";

export interface UtilityPublicationGateConfig {
  minAnalyzedRuns: number;
  /** 0–1 scale (shadow confidence is stored 0–100 and normalized before compare). */
  minConfidence: number;
  /** compatibleEvidenceCount / max(candidateRunCount, 1). */
  minEvidenceCoverage: number;
  minObservedDomains: number;
}

/** Documented v6 defaults — used only when reading a complete model config object. */
export const MODEL_V6_UTILITY_PUBLICATION_GATES: UtilityPublicationGateConfig = {
  minAnalyzedRuns: 3,
  minConfidence: 0.45,
  minEvidenceCoverage: 0.5,
  minObservedDomains: 2,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalize shadow confidence (0–100 or 0–1) to 0–1. */
export function normalizeUtilityConfidence(confidence: number | null | undefined): number {
  if (confidence == null || !Number.isFinite(confidence)) return 0;
  return confidence > 1 ? clamp01(confidence / 100) : clamp01(confidence);
}

export type UtilityPublicationRejectionReason =
  | "PUBLICATION_MODE_OFF"
  | "PUBLICATION_MODE_SHADOW"
  | "MODEL_ELIGIBILITY_CONFIG_MISSING"
  | "MODEL_ELIGIBILITY_CONFIG_INVALID"
  | "SHADOW_STATUS_NOT_SCORED"
  | "NO_RELIABILITY_ADJUSTED_SCORE"
  | "INSUFFICIENT_ANALYZED_RUNS"
  | "INSUFFICIENT_CONFIDENCE"
  | "INSUFFICIENT_EVIDENCE_COVERAGE"
  | "INSUFFICIENT_OBSERVED_DOMAINS"
  | "MISSING_MASTER_DATA"
  | "INCOMPLETE_REQUIRED_DATASETS"
  | "ACTOR_ATTRIBUTION_FAILED"
  | "UNSUPPORTED_CLASS_SPEC"
  | "CRITICAL_PET_ATTRIBUTION_FAILURE"
  | "STALE_OR_MISMATCHED_REPORT_REVISION"
  | "INCOMPATIBLE_EVIDENCE_VERSION"
  | "NO_COMPATIBLE_EVIDENCE";

export interface UtilityPublicationCoverageInput {
  candidateRunCount?: number;
  compatibleEvidenceCount?: number;
  analyzedRunCount?: number;
  observedDomainCount?: number;
  applicableDomainCount?: number;
  incompleteEvidenceCount?: number;
  missingMasterDataCount?: number;
  skipReasons?: string[];
  notes?: string[];
  evidenceAnalysisVersion?: string | null;
  classSlug?: string | null;
  specSlug?: string | null;
}

export interface UtilityPublicationEligibilityInput {
  publicationMode: "off" | "shadow" | "published";
  shadowStatus: string;
  reliabilityAdjustedScore: number | null | undefined;
  confidence: number | null | undefined;
  coverage: UtilityPublicationCoverageInput;
  /**
   * Gates from ScoreModel.config.utilityPublicationEligibility.
   * Required for published mode — missing/invalid fails closed.
   */
  gates: UtilityPublicationGateConfig | null | undefined;
}

export interface UtilityPublicationEligibilityResult {
  eligible: boolean;
  reasons: UtilityPublicationRejectionReason[];
  gates: UtilityPublicationGateConfig | null;
  evidenceCoverage: number;
  confidence01: number;
  analyzedRunCount: number;
  observedDomainCount: number;
}

/**
 * Parse and validate utilityPublicationEligibility from a score model config JSON.
 * Returns null when missing or invalid (caller must fail closed).
 */
export function readUtilityPublicationGatesFromModelConfig(
  config: unknown,
): UtilityPublicationGateConfig | null {
  if (config == null || typeof config !== "object" || Array.isArray(config)) return null;
  const raw = (config as Record<string, unknown>).utilityPublicationEligibility;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const minAnalyzedRuns = Number(row.minAnalyzedRuns);
  const minConfidence = Number(row.minConfidence);
  const minEvidenceCoverage = Number(row.minEvidenceCoverage);
  const minObservedDomains = Number(row.minObservedDomains);
  if (
    !Number.isFinite(minAnalyzedRuns) ||
    minAnalyzedRuns < 0 ||
    !Number.isFinite(minConfidence) ||
    minConfidence < 0 ||
    minConfidence > 1 ||
    !Number.isFinite(minEvidenceCoverage) ||
    minEvidenceCoverage < 0 ||
    minEvidenceCoverage > 1 ||
    !Number.isFinite(minObservedDomains) ||
    minObservedDomains < 0
  ) {
    return null;
  }
  return {
    minAnalyzedRuns: Math.floor(minAnalyzedRuns),
    minConfidence,
    minEvidenceCoverage,
    minObservedDomains: Math.floor(minObservedDomains),
  };
}

export function evaluateUtilityPublicationEligibility(
  input: UtilityPublicationEligibilityInput,
): UtilityPublicationEligibilityResult {
  const reasons: UtilityPublicationRejectionReason[] = [];
  const coverage = input.coverage ?? {};

  if (input.publicationMode === "off") {
    reasons.push("PUBLICATION_MODE_OFF");
  } else if (input.publicationMode === "shadow") {
    reasons.push("PUBLICATION_MODE_SHADOW");
  }

  let gates: UtilityPublicationGateConfig | null = null;
  if (input.publicationMode === "published") {
    if (input.gates == null) {
      reasons.push("MODEL_ELIGIBILITY_CONFIG_MISSING");
    } else {
      const validated = readUtilityPublicationGatesFromModelConfig({
        utilityPublicationEligibility: input.gates,
      });
      if (!validated) {
        reasons.push("MODEL_ELIGIBILITY_CONFIG_INVALID");
      } else {
        gates = validated;
      }
    }
  } else if (input.gates != null) {
    gates = readUtilityPublicationGatesFromModelConfig({
      utilityPublicationEligibility: input.gates,
    });
  }

  if (input.shadowStatus !== "SHADOW_SCORED") {
    reasons.push("SHADOW_STATUS_NOT_SCORED");
  }

  if (
    input.reliabilityAdjustedScore == null ||
    !Number.isFinite(input.reliabilityAdjustedScore)
  ) {
    reasons.push("NO_RELIABILITY_ADJUSTED_SCORE");
  }

  const analyzedRunCount = coverage.analyzedRunCount ?? 0;
  const confidence01 = normalizeUtilityConfidence(input.confidence);
  const candidate = Math.max(coverage.candidateRunCount ?? 0, 1);
  const compatible = coverage.compatibleEvidenceCount ?? 0;
  const evidenceCoverage =
    (coverage.candidateRunCount ?? 0) === 0 ? 0 : compatible / candidate;
  const observedDomainCount = coverage.observedDomainCount ?? 0;

  if (gates) {
    if (analyzedRunCount < gates.minAnalyzedRuns) {
      reasons.push("INSUFFICIENT_ANALYZED_RUNS");
    }
    if (confidence01 < gates.minConfidence) {
      reasons.push("INSUFFICIENT_CONFIDENCE");
    }
    if (evidenceCoverage < gates.minEvidenceCoverage) {
      reasons.push("INSUFFICIENT_EVIDENCE_COVERAGE");
    }
    if (observedDomainCount < gates.minObservedDomains) {
      reasons.push("INSUFFICIENT_OBSERVED_DOMAINS");
    }
  }

  if ((coverage.missingMasterDataCount ?? 0) > 0) {
    reasons.push("MISSING_MASTER_DATA");
  }
  if ((coverage.incompleteEvidenceCount ?? 0) > 0) {
    reasons.push("INCOMPLETE_REQUIRED_DATASETS");
  }
  if ((coverage.compatibleEvidenceCount ?? 0) <= 0 && input.shadowStatus !== "SHADOW_SCORED") {
    reasons.push("NO_COMPATIBLE_EVIDENCE");
  }

  const skip = coverage.skipReasons ?? [];
  const notes = coverage.notes ?? [];
  const haystack = [...skip, ...notes].join(" ").toLowerCase();
  if (haystack.includes("actor_attribution_failed") || haystack.includes("missing_player_actor")) {
    reasons.push("ACTOR_ATTRIBUTION_FAILED");
  }
  if (haystack.includes("pet_attribution") || haystack.includes("critical_pet")) {
    reasons.push("CRITICAL_PET_ATTRIBUTION_FAILURE");
  }
  if (
    haystack.includes("revision_mismatch") ||
    haystack.includes("stale_revision") ||
    haystack.includes("refetch_revision_changed")
  ) {
    reasons.push("STALE_OR_MISMATCHED_REPORT_REVISION");
  }
  if (
    coverage.evidenceAnalysisVersion != null &&
    coverage.evidenceAnalysisVersion !== "" &&
    coverage.evidenceAnalysisVersion !== "wcl-run-evidence-v1"
  ) {
    reasons.push("INCOMPATIBLE_EVIDENCE_VERSION");
  }
  if (haystack.includes("unsupported_class") || haystack.includes("unsupported_spec")) {
    reasons.push("UNSUPPORTED_CLASS_SPEC");
  }

  const finalEligible = input.publicationMode === "published" && reasons.length === 0;

  return {
    eligible: finalEligible,
    reasons: [...new Set(reasons)],
    gates,
    evidenceCoverage,
    confidence01,
    analyzedRunCount,
    observedDomainCount,
  };
}
