/**
 * Performance unavailable provenance from frozen manifest acquisition outcomes.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import {
  adaptPerformanceComputeInput,
  performanceProvenanceFromManifest,
} from "./adapters.js";

function manifestWithPerformanceReason(
  reason: string,
): CharacterSeasonEvidenceManifestV2 {
  return {
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    characterId: "c1",
    seasonId: "s1",
    seasonSlug: "blizzard-season-17",
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
    refreshContractHash: "r1",
    evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    highKeyPolicyId: "hk1",
    activeDungeonSlugs: ["skyreach"],
    expectedSlotCount: 2,
    selectedSlotCount: 1,
    selectedAt: "2026-08-01T12:00:00.000Z",
    acquisitionPlanContentHash: "plan1",
    slots: [
      {
        slotId: "skyreach:0",
        dungeonSlug: "skyreach",
        slotIndex: 0,
        state: "SELECTED",
        identity: { reportCode: "rep1", fightId: 1, reportRevision: 1 },
        keyLevel: 12,
        timed: true,
        runScore: 400,
        completedAt: "2026-07-01T12:00:00.000Z",
        actorId: 1,
        dimensionValidity: {
          performance: "PARTIAL",
          survival: "VALID",
          utility: "VALID",
          reasons: [`PERFORMANCE:UNAVAILABLE:${reason}`],
        },
        selectedRank: 0,
        fallbackReason: null,
        datasetHashes: [],
        factSetHash: "facts-1",
      },
    ],
    rejectedCandidates: [],
    coverage: {
      state: "INSUFFICIENT",
      expectedSlotCount: 2,
      selectedSlotCount: 1,
      dungeonCount: 1,
      dungeonsRepresented: 1,
      slotFillRatio: 0.5,
      dungeonFillRatio: 1,
    },
    contentHash: "hash1",
    diagnostics: {
      candidatesConsidered: 1,
      candidatesEligible: 1,
      candidatesRejected: 0,
      rejectionReasonCounts: {},
      perDungeon: [],
    },
  };
}

describe("performanceProvenanceFromManifest", () => {
  it("maps RANKING_PARSE public API unavailable reasons", () => {
    const reasons = performanceProvenanceFromManifest(
      manifestWithPerformanceReason("RANKING_PARSE_PUBLIC_API_UNAVAILABLE"),
    );
    expect(reasons).toContain("ranking_parse_public_api_unavailable");
    expect(reasons.some((r) => r.includes("missing_extractor_family"))).toBe(false);
  });

  it("maps ranking row absent", () => {
    expect(
      performanceProvenanceFromManifest(
        manifestWithPerformanceReason("ranking_parse_row_absent"),
      ),
    ).toContain("ranking_parse_row_absent");
  });

  it("maps never-requested extractor", () => {
    expect(
      performanceProvenanceFromManifest(
        manifestWithPerformanceReason("ranking_parse_not_requested"),
      ),
    ).toContain("performance_extractor_not_requested");
  });
});

describe("adaptPerformanceComputeInput provenance", () => {
  it("surfaces acquisition RANKING_PARSE reason instead of missing_extractor_family alone", () => {
    const adapted = adaptPerformanceComputeInput({
      manifest: manifestWithPerformanceReason("RANKING_PARSE_PUBLIC_API_UNAVAILABLE"),
      factSets: [
        {
          extractorFamily: "survival",
          extractorVersion: "1",
          schemaVersion: "2.0.0",
          inputFingerprint: "fp",
          facts: { kind: "survival" },
          limitations: [],
        },
      ],
      computedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(adapted.ok).toBe(false);
    if (adapted.ok) return;
    expect(adapted.failureReasons).toContain("ranking_parse_public_api_unavailable");
    expect(
      adapted.failureReasons.some((r) => r === "missing_extractor_family:performance"),
    ).toBe(false);
  });
});
