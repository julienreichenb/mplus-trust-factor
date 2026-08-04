import { describe, expect, it } from "vitest";
import {
  FEATURE_REGISTRY_V2_VERSION,
  EVIDENCE_AUDIT_V2_SCHEMA_VERSION,
  scoringV2EvidenceAuditDocumentSchema,
  featureScoringRoleSchema,
} from "./evidence-audit-v2.js";

describe("evidence-audit-v2 contracts", () => {
  it("exports stable schema versions", () => {
    expect(EVIDENCE_AUDIT_V2_SCHEMA_VERSION).toBe("2.0.0");
    expect(FEATURE_REGISTRY_V2_VERSION).toBe("feature-registry-v2.0.0");
  });

  it("accepts scoring roles", () => {
    for (const role of ["SCORE", "CONFIDENCE", "AVAILABILITY", "EXPLAINABILITY_ONLY"]) {
      expect(featureScoringRoleSchema.parse(role)).toBe(role);
    }
  });

  it("rejects audit documents with raw event arrays shape misuse via schema bounds", () => {
    const parsed = scoringV2EvidenceAuditDocumentSchema.safeParse({
      schemaVersion: EVIDENCE_AUDIT_V2_SCHEMA_VERSION,
      featureRegistryVersion: FEATURE_REGISTRY_V2_VERSION,
      auditedAt: "2026-08-04T12:00:00.000Z",
      manifestId: "m1",
      characterId: "c1",
      seasonId: "s1",
      manifestContentHash: "hash",
      expectedSlotCount: 0,
      selectedSlotCount: 0,
      coverageState: "INSUFFICIENT",
      slots: [],
      featureRegistry: [],
      dimensionConsumption: [],
      matrix: [],
      replay: null,
      integrityFailures: [],
      providerCallCount: 0,
    });
    expect(parsed.success).toBe(true);
  });
});
