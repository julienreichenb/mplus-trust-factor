import { describe, expect, it } from "vitest";
import {
  discoveryIdentityKey,
  evidenceAcquisitionPlanV2Schema,
  evidenceCandidateAcquisitionResultSchema,
  evidenceCandidateFrozenIdentitySchema,
  evidenceCandidateMetadataV2Schema,
  expectedEvidenceSlotCount,
  frozenIdentityKey,
  sumEvidenceCostEstimates,
} from "./evidence-v2.js";

describe("evidence-v2 contracts", () => {
  it("derives expected slot count from dungeon count (no hardcoded eight)", () => {
    expect(expectedEvidenceSlotCount(0)).toBe(0);
    expect(expectedEvidenceSlotCount(5)).toBe(10);
    expect(expectedEvidenceSlotCount(8)).toBe(16);
  });

  it("distinguishes discovery and frozen identity keys", () => {
    expect(discoveryIdentityKey({ reportCode: "abc", fightId: 3 })).toBe("abc:3");
    expect(frozenIdentityKey({ reportCode: "abc", fightId: 3, reportRevision: 2 })).toBe(
      "abc:3:2",
    );
  });

  it("treats unknown cost as distinct from zero", () => {
    expect(sumEvidenceCostEstimates([{ kind: "ZERO_CACHE_HIT" }])).toEqual({
      kind: "ZERO_CACHE_HIT",
    });
    expect(sumEvidenceCostEstimates([{ kind: "KNOWN", points: 0 }])).toEqual({
      kind: "KNOWN",
      points: 0,
    });
    expect(
      sumEvidenceCostEstimates([
        { kind: "KNOWN", points: 2 },
        { kind: "UNKNOWN" },
      ]),
    ).toEqual({ kind: "UNKNOWN" });
  });

  it("parses plan, acquisition result, and frozen identity schemas", () => {
    const metadata = evidenceCandidateMetadataV2Schema.parse({
      discoveryIdentity: { reportCode: "r1", fightId: 1 },
      reportRevision: null,
      dungeonSlug: "skyreach",
      keyLevel: 12,
      timed: null,
      runScore: null,
      evidenceCompleteness: 0.8,
      completedAt: "2026-07-01T12:00:00.000Z",
      fightDurationMs: 1000,
      actorId: 5,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
    });
    expect(metadata.reportRevision).toBeNull();

    const plan = evidenceAcquisitionPlanV2Schema.parse({
      schemaVersion: "2.0.0",
      selectorVersion: "evidence-selector-v2.0.0",
      characterId: "c1",
      seasonId: "s1",
      seasonSlug: "season",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      refreshContractHash: "h",
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "hk",
      activeDungeonSlugs: ["skyreach"],
      expectedSlotCount: 2,
      plannedAt: "2026-08-01T12:00:00.000Z",
      slots: [
        {
          slotId: "skyreach:0",
          dungeonSlug: "skyreach",
          slotIndex: 0,
          orderedCandidates: [
            {
              discoveryIdentity: { reportCode: "r1", fightId: 1 },
              rank: 0,
              keyLevel: 12,
              timed: true,
              runScore: 1,
              evidenceCompleteness: 1,
              completedAt: "2026-07-01T12:00:00.000Z",
              actorId: 5,
            },
          ],
          provisionalMissingState: null,
        },
      ],
      rejectedCandidates: [],
      diagnostics: {
        candidatesConsidered: 1,
        candidatesEligible: 1,
        candidatesRejected: 0,
        rejectionReasonCounts: {},
        perDungeon: [
          {
            dungeonSlug: "skyreach",
            eligibleCount: 1,
            plannedAttemptCount: 1,
            provisionalMissingStates: [],
          },
        ],
      },
      contentHash: "abc",
    });
    expect(plan.slots[0]!.orderedCandidates[0]!.discoveryIdentity.reportCode).toBe("r1");
    expect(plan).not.toHaveProperty("manifestContentHash");

    const acquired = evidenceCandidateAcquisitionResultSchema.parse({
      discoveryIdentity: { reportCode: "r1", fightId: 1 },
      acquisitionStatus: "ACQUIRED",
      reportRevision: 4,
      rejectionReason: null,
      rejectionDetail: null,
      datasetHashes: [{ dataset: "DEATHS", contentHash: "d1" }],
      factSetHash: "f1",
      dimensionValidity: {
        performance: "VALID",
        survival: "PARTIAL",
        utility: "VALID",
        reasons: ["partial-survival"],
      },
    });
    expect(acquired.reportRevision).toBe(4);

    const frozen = evidenceCandidateFrozenIdentitySchema.parse({
      reportCode: "r1",
      fightId: 1,
      reportRevision: 4,
    });
    expect(frozen.reportRevision).toBe(4);
  });
});
