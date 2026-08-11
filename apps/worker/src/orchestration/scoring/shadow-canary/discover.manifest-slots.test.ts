/**
 * Dungeon-first discovery manifest slot contract (no hydration fallback).
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateAcquisitionResult,
  type EvidenceCandidateMetadataV2,
  type EvidenceAcquisitionPlanV2,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "@mplus/scoring";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";

function baseScope(activeDungeonSlugs: readonly string[]) {
  return {
    characterId: CHAR_ID,
    seasonId: "season-1",
    seasonSlug: "midnight-season-1",
    specializationId: null,
    classSlug: "mage",
    specSlug: "fire",
    role: "DPS" as const,
    refreshContractHash: "hash",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "policy",
    activeDungeonSlugs: [...activeDungeonSlugs],
  };
}

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  keyLevel: number,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel,
    timed: true,
    runScore: keyLevel * 100,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "encounter_rankings",
  };
}

function acquireAllFromPlan(plan: EvidenceAcquisitionPlanV2): EvidenceCandidateAcquisitionResult[] {
  const seen = new Set<string>();
  const results: EvidenceCandidateAcquisitionResult[] = [];
  for (const slot of plan.slots) {
    for (const attempt of slot.orderedCandidates) {
      const key = `${attempt.discoveryIdentity.reportCode}:${attempt.discoveryIdentity.fightId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        discoveryIdentity: { ...attempt.discoveryIdentity },
        acquisitionStatus: "ACQUIRED",
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [{ dataset: "CASTS", contentHash: `casts-${key}` }],
        factSetHash: `facts-${key}`,
        dimensionValidity: {
          performance: "VALID",
          survival: "VALID",
          utility: "VALID",
          reasons: [],
        },
        keyLevel: attempt.keyLevel,
        timed: attempt.timed,
        runScore: attempt.runScore,
        completedAt: attempt.completedAt,
        actorId: attempt.actorId,
        evidenceCompleteness: attempt.evidenceCompleteness,
      });
    }
  }
  return results;
}

function manifestFor(
  activeDungeonSlugs: readonly string[],
  candidates: EvidenceCandidateMetadataV2[],
) {
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: baseScope(activeDungeonSlugs),
    candidates,
    plannedAt: "2026-01-01T00:00:00.000Z",
  });
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: acquireAllFromPlan(plan),
    selectedAt: "2026-01-01T01:00:00.000Z",
  });
  return manifest;
}

describe("dungeon-first manifest slot selection", () => {
  it("selects two slots when two valid public timed candidates exist", () => {
    const manifest = manifestFor(
      ["skyreach"],
      [
        candidate("skyreach", "SR-A", 1, 18),
        candidate("skyreach", "SR-B", 2, 17),
      ],
    );
    const sky = manifest.slots.filter((s) => s.dungeonSlug === "skyreach");
    expect(sky.filter((s) => s.state === "SELECTED")).toHaveLength(2);
    expect(sky.filter((s) => s.state !== "SELECTED")).toHaveLength(0);
  });

  it("selects one slot and leaves one missing when only one candidate exists", () => {
    const manifest = manifestFor(
      ["windrunner-spire"],
      [candidate("windrunner-spire", "WR-1", 3, 16)],
    );
    const wr = manifest.slots.filter((s) => s.dungeonSlug === "windrunner-spire");
    expect(wr.filter((s) => s.state === "SELECTED")).toHaveLength(1);
    expect(wr.filter((s) => s.state !== "SELECTED")).toHaveLength(1);
    expect(manifest.selectedSlotCount).toBe(1);
  });

  it("leaves both slots missing when no candidates exist for a dungeon", () => {
    const manifest = manifestFor(["pit-of-saron"], []);
    const pit = manifest.slots.filter((s) => s.dungeonSlug === "pit-of-saron");
    expect(pit.filter((s) => s.state === "SELECTED")).toHaveLength(0);
    expect(pit.filter((s) => s.state !== "SELECTED")).toHaveLength(2);
    expect(manifest.selectedSlotCount).toBe(0);
  });
});
