import { describe, expect, it } from "vitest";
import {
  evaluateUtilityPublicationEligibility,
  normalizeUtilityConfidence,
  readUtilityPublicationGatesFromModelConfig,
  MODEL_V6_UTILITY_PUBLICATION_GATES,
} from "./utility-publication-eligibility.js";

const GATES = { ...MODEL_V6_UTILITY_PUBLICATION_GATES };

describe("evaluateUtilityPublicationEligibility", () => {
  it("normalizes 0–100 confidence to 0–1", () => {
    expect(normalizeUtilityConfidence(70)).toBeCloseTo(0.7);
    expect(normalizeUtilityConfidence(0.45)).toBeCloseTo(0.45);
  });

  it("accepts eligible published shadow scores with model gates", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: GATES,
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
        missingMasterDataCount: 0,
        incompleteEvidenceCount: 0,
        evidenceAnalysisVersion: "wcl-run-evidence-v1",
        classSlug: "warlock",
        specSlug: "affliction",
      },
    });
    expect(result.eligible).toBe(true);
  });

  it("fails closed when model eligibility config is missing", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: null,
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("MODEL_ELIGIBILITY_CONFIG_MISSING");
  });

  it("fails closed when model eligibility config is invalid", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
      gates: { minAnalyzedRuns: 3, minConfidence: 2, minEvidenceCoverage: 0.5, minObservedDomains: 2 },
      coverage: {
        candidateRunCount: 15,
        compatibleEvidenceCount: 15,
        analyzedRunCount: 15,
        observedDomainCount: 3,
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("MODEL_ELIGIBILITY_CONFIG_INVALID");
  });

  it("rejects missing masterData", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 55,
      confidence: 60,
      gates: GATES,
      coverage: {
        candidateRunCount: 10,
        compatibleEvidenceCount: 10,
        analyzedRunCount: 10,
        observedDomainCount: 2,
        missingMasterDataCount: 1,
      },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("MISSING_MASTER_DATA");
  });

  it("reads gates from score model config and ignores env-shaped overrides", () => {
    process.env.UTILITY_MIN_ANALYZED_RUNS = "99";
    const gates = readUtilityPublicationGatesFromModelConfig({
      utilityPublicationEligibility: GATES,
    });
    expect(gates).toEqual(GATES);
    expect(gates?.minAnalyzedRuns).toBe(3);
    delete process.env.UTILITY_MIN_ANALYZED_RUNS;
  });
});
