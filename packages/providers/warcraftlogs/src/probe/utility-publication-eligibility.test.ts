import { describe, expect, it } from "vitest";
import {
  evaluateUtilityPublicationEligibility,
  normalizeUtilityConfidence,
} from "./utility-publication-eligibility.js";

describe("evaluateUtilityPublicationEligibility", () => {
  it("normalizes 0–100 confidence to 0–1", () => {
    expect(normalizeUtilityConfidence(70)).toBeCloseTo(0.7);
    expect(normalizeUtilityConfidence(0.45)).toBeCloseTo(0.45);
  });

  it("accepts eligible published shadow scores", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 61.91,
      confidence: 70,
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

  it("rejects missing masterData", () => {
    const result = evaluateUtilityPublicationEligibility({
      publicationMode: "published",
      shadowStatus: "SHADOW_SCORED",
      reliabilityAdjustedScore: 55,
      confidence: 60,
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
});
