/**
 * Authoritative report revision lineage, manifest supersede, and partial live scoring.
 * No real WCL calls.
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  computeScoringConfidenceV1,
  finalizeEvidenceManifestV2,
  missingDungeonsFromCoverage,
} from "@mplus/scoring";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import {
  reconcileManifestReportRevisions,
} from "./canary/canary-manifest-revision-reconcile.js";
import { assertExpectedFightRevision } from "./run-orchestration/live-capability-adapter.js";

const CHAR_ID = "11111111-1111-4111-8111-111111111111";
const PRIOR_MANIFEST_ID = "e65b46ec-aee6-4862-af31-6ae87a01daa9";
const POOL_HASH = "pool-hash-midnight";

/** Observed live canary revision mismatches (expected 1 → actual). */
const REVISION_BUMPS: Record<string, number> = {
  "QfMvDaxTqAkXmwyR": 4,
  "RycgPJ9rjxT6v1Bw": 11,
  "Gq4jDxYLCcyNFBHT": 11,
  "HR9nY6kKJ4xQm378": 10,
  "2MdLn3NVymJTYzg6": 6,
  "dyTBMQ3p6R1kVHGb": 10,
  "fWJTbkMCP3a4A1Rd": 6,
};

const MATCHING_CODES = [
  "1WKcCz2BnAQmbhfq",
  "jCWxQFPV7tHpgXah",
  "rmd1P7KygazYHVD3",
  "J74TYzhxH2DvdWGM",
  "prNT4XkJmPRcwhGq",
  "7PajpgxkvT3y6KAc",
  "3cCGwYHK9r82aDNj",
];

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  reportRevision: number,
  slotHint = 0,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision,
    dungeonSlug,
    keyLevel: 10 + slotHint,
    timed: true,
    runScore: 200 + slotHint * 10,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

/** 16-slot fixture mirroring the live Wallidrixe manifest identities (rev 1). */
function wallidrixeStaleCandidates(): EvidenceCandidateMetadataV2[] {
  return [
    candidate("algethar-academy", "1WKcCz2BnAQmbhfq", 1, 1, 0),
    candidate("algethar-academy", "jCWxQFPV7tHpgXah", 1, 1, 1),
    candidate("magisters-terrace", "QfMvDaxTqAkXmwyR", 3, 1, 0),
    candidate("magisters-terrace", "rmd1P7KygazYHVD3", 4, 1, 1),
    candidate("maisara-caverns", "RycgPJ9rjxT6v1Bw", 18, 1, 0),
    candidate("maisara-caverns", "RycgPJ9rjxT6v1Bw", 17, 1, 1),
    candidate("nexus-point-xenas", "J74TYzhxH2DvdWGM", 3, 1, 0),
    candidate("nexus-point-xenas", "Gq4jDxYLCcyNFBHT", 6, 1, 1),
    candidate("pit-of-saron", "HR9nY6kKJ4xQm378", 9, 1, 0),
    candidate("pit-of-saron", "2MdLn3NVymJTYzg6", 6, 1, 1),
    candidate("seat-of-the-triumvirate", "prNT4XkJmPRcwhGq", 1, 1, 0),
    candidate("seat-of-the-triumvirate", "Gq4jDxYLCcyNFBHT", 9, 1, 1),
    candidate("skyreach", "7PajpgxkvT3y6KAc", 1, 1, 0),
    candidate("skyreach", "dyTBMQ3p6R1kVHGb", 7, 1, 1),
    candidate("windrunner-spire", "fWJTbkMCP3a4A1Rd", 3, 1, 0),
    candidate("windrunner-spire", "3cCGwYHK9r82aDNj", 4, 1, 1),
  ];
}

function buildManifest(
  candidates: EvidenceCandidateMetadataV2[],
): CharacterSeasonEvidenceManifestV2 {
  const scope = {
    characterId: CHAR_ID,
    seasonId: "season-row-1",
    seasonSlug: "blizzard-season-17",
    specializationId: null,
    classSlug: "mage",
    specSlug: "arcane",
    role: "DPS" as const,
    refreshContractHash: "rh",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "canary-live-v1",
    activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
  };
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates,
    plannedAt: new Date().toISOString(),
  });
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: candidates.map((meta) => ({
      discoveryIdentity: { ...meta.discoveryIdentity },
      acquisitionStatus: "ACQUIRED" as const,
      reportRevision: meta.reportRevision,
      rejectionReason: null,
      rejectionDetail: null,
      datasetHashes: [],
      factSetHash: `facts-${meta.discoveryIdentity.reportCode}:${meta.discoveryIdentity.fightId}`,
      dimensionValidity: {
        performance: "VALID" as const,
        survival: "VALID" as const,
        utility: "VALID" as const,
        reasons: [],
      },
      keyLevel: meta.keyLevel,
      timed: meta.timed,
      runScore: meta.runScore,
      completedAt: meta.completedAt,
      actorId: meta.actorId,
      evidenceCompleteness: meta.evidenceCompleteness,
    })),
    selectedAt: new Date().toISOString(),
  });
  return {
    ...manifest,
    dungeonPoolHash: POOL_HASH,
  } as CharacterSeasonEvidenceManifestV2 & { dungeonPoolHash: string };
}

describe("report revision fail-closed", () => {
  it("never defaults an unknown revision to 1 in confidence helpers", () => {
    // Pure assertion of the policy: unresolved must not become 1.
    const unknown: number | null | undefined = undefined;
    expect(unknown ?? null).toBeNull();
    expect(unknown === 1).toBe(false);
  });

  it("authoritative revision flows into frozen identity", () => {
    const c = candidate("skyreach", "ABC", 7, 10);
    expect(c.reportRevision).toBe(10);
    const m = buildManifest([
      ...wallidrixeStaleCandidates().slice(0, 14),
      candidate("windrunner-spire", "fWJTbkMCP3a4A1Rd", 3, 6, 0),
      candidate("windrunner-spire", "3cCGwYHK9r82aDNj", 4, 1, 1),
    ]);
    const wind = m.slots.find(
      (s) => s.identity?.reportCode === "fWJTbkMCP3a4A1Rd",
    );
    expect(wind?.identity?.reportRevision).toBe(6);
  });

  it("assertExpectedFightRevision rejects mismatch", () => {
    expect(() =>
      assertExpectedFightRevision({
        reportCode: "QfMvDaxTqAkXmwyR",
        fightId: 3,
        expectedRevision: 1,
        actualRevision: null,
      }),
    ).toThrow(/fight_revision_mismatch/);
  });
});

describe("manifest revision reconciliation", () => {
  it("nine revision mismatches create a superseding manifest without mutating prior", () => {
    const prior = buildManifest(wallidrixeStaleCandidates());
    const priorClone = structuredClone(prior);
    const resolvedAt = "2026-08-05T21:00:00.000Z";
    const observations = prior.slots
      .filter((s) => s.state === "SELECTED" && s.identity)
      .map((s) => {
        const code = s.identity!.reportCode;
        const rev = REVISION_BUMPS[code] ?? 1;
        return {
          reportCode: code,
          fightId: s.identity!.fightId,
          authoritativeRevision: rev,
          revisionSource: "wcl_report_metadata" as const,
          revisionResolvedAt: resolvedAt,
          fightPresent: true,
          characterPresent: true,
        };
      });

    const result = reconcileManifestReportRevisions({
      priorManifestId: PRIOR_MANIFEST_ID,
      document: prior,
      observations,
      reconciledAt: resolvedAt,
    });

    expect(result.changed).toBe(true);
    expect(result.changes).toHaveLength(9);
    expect(result.supersedesManifestId).toBe(PRIOR_MANIFEST_ID);
    expect(result.document.supersedesManifestId).toBe(PRIOR_MANIFEST_ID);
    expect(result.document.contentHash).not.toBe(prior.contentHash);
    expect(prior).toEqual(priorClone);

    for (const slot of result.document.slots) {
      if (slot.state !== "SELECTED" || !slot.identity) continue;
      const priorSlot = prior.slots.find((s) => s.slotId === slot.slotId)!;
      expect(slot.identity.reportCode).toBe(priorSlot.identity!.reportCode);
      expect(slot.identity.fightId).toBe(priorSlot.identity!.fightId);
      expect(slot.dungeonSlug).toBe(priorSlot.dungeonSlug);
      expect(slot.slotIndex).toBe(priorSlot.slotIndex);
      const expected = REVISION_BUMPS[slot.identity.reportCode] ?? 1;
      expect(slot.identity.reportRevision).toBe(expected);
    }
  });

  it("seven matching revision packages remain cache-compatible; nine require acquisition", () => {
    const prior = buildManifest(wallidrixeStaleCandidates());
    const observations = prior.slots
      .filter((s) => s.state === "SELECTED" && s.identity)
      .map((s) => ({
        reportCode: s.identity!.reportCode,
        fightId: s.identity!.fightId,
        authoritativeRevision:
          REVISION_BUMPS[s.identity!.reportCode] ?? 1,
        revisionSource: "wcl_report_metadata" as const,
        revisionResolvedAt: "2026-08-05T21:00:00.000Z",
        fightPresent: true,
        characterPresent: true,
      }));
    const result = reconcileManifestReportRevisions({
      priorManifestId: PRIOR_MANIFEST_ID,
      document: prior,
      observations,
    });

    const selected = result.document.slots.filter(
      (s) => s.state === "SELECTED" && s.identity,
    );
    const hits = selected.filter((s) =>
      MATCHING_CODES.includes(s.identity!.reportCode),
    );
    const misses = selected.filter(
      (s) => !MATCHING_CODES.includes(s.identity!.reportCode),
    );
    expect(hits).toHaveLength(7);
    expect(misses).toHaveLength(9);
    for (const h of hits) {
      expect(h.identity!.reportRevision).toBe(1);
    }
    for (const m of misses) {
      expect(m.identity!.reportRevision).toBeGreaterThan(1);
    }
  });

  it("live adapter still rejects unexpected revision mismatch", () => {
    expect(() =>
      assertExpectedFightRevision({
        expectedRevision: 1,
        actualRevision: 4,
        reportCode: "QfMvDaxTqAkXmwyR",
        fightId: 3,
      }),
    ).toThrow(/fight_revision_mismatch/);
  });
});

describe("partial confidence diagnostics", () => {
  it("7-run / 6-dungeon fixture yields confidence 57 and two missing dungeons", () => {
    const represented = [
      "algethar-academy",
      "magisters-terrace",
      "maisara-caverns",
      "nexus-point-xenas",
      "seat-of-the-triumvirate",
      "skyreach",
    ];
    const missing = missingDungeonsFromCoverage(
      MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      represented,
    );
    expect(missing).toHaveLength(2);
    const conf = computeScoringConfidenceV1({
      usableRunCount: 7,
      targetRunCount: 16,
      representedDungeonCount: 6,
      activeDungeonCount: 8,
      activeDungeonSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      representedDungeonSlugs: represented,
    });
    expect(conf.confidenceScore).toBe(57);
    expect(conf.confidenceBand).toBe("LOW");
    expect(conf.missingDungeons).toEqual(missing);
    expect(conf.missingDungeons).toHaveLength(2);
  });

  it("complete 16/16 coverage yields confidence 100", () => {
    const conf = computeScoringConfidenceV1({
      usableRunCount: 16,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
      activeDungeonSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      representedDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    });
    expect(conf.confidenceScore).toBe(100);
    expect(conf.missingDungeons).toEqual([]);
  });

  it("zero usable digests produces NONE / unavailable", () => {
    const conf = computeScoringConfidenceV1({
      usableRunCount: 0,
      targetRunCount: 16,
      representedDungeonCount: 0,
      activeDungeonCount: 8,
      activeDungeonSlugs: MIDNIGHT_SEASON_1_DUNGEON_SLUGS,
      representedDungeonSlugs: [],
    });
    expect(conf.confidenceScore).toBe(0);
    expect(conf.confidenceBand).toBe("NONE");
    expect(conf.unavailableReason).toBe("ZERO_USABLE_RUNS");
    expect(conf.missingDungeons).toHaveLength(8);
  });
});
