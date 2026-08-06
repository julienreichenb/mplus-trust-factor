/**
 * Ranking lineage carry-forward across revision-reconciliation supersedes.
 * No real WCL calls.
 */
import { describe, expect, it, vi } from "vitest";
import { rankingParseCompatibilityKey } from "./run-orchestration/ranking-hydrate.js";
import {
  carryForwardRankingLineage,
  RANKING_PARSE_DATASET_KEY,
} from "./canary/canary-ranking-lineage.js";
import { computeScoringConfidenceV1 } from "@mplus/scoring";

const PRIOR_ID = "e65b46ec-aee6-4862-af31-6ae87a01daa9";
const NEW_ID = "84e9c5bb-f382-4b69-9fa9-9f021aca9b96";

function rankingRow(input: {
  id: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  fingerprint: string;
}) {
  return {
    id: input.id,
    datasetKey: RANKING_PARSE_DATASET_KEY,
    compatibilityKey: rankingParseCompatibilityKey(input),
    artifactId: `art-${input.id}`,
    schemaVersion: "1.0.0",
    providerContractVersion: "wcl-ranking-parse-v1",
    state: "READY",
    eventCount: 0,
    pageCount: 0,
    truncated: false,
    pointsConsumed: null,
    costSource: "discovery_zone_rankings",
    payloadFingerprint: input.fingerprint,
    fetchedAt: new Date("2026-08-05T20:00:00.000Z"),
  };
}

describe("carryForwardRankingLineage", () => {
  it("carries 7 unchanged identities and refuses to copy 9 incompatible revisions", async () => {
    const unchanged = [
      { code: "1WKcCz2BnAQmbhfq", fightId: 1, rev: 1, slug: "algethar-academy", idx: 0 },
      { code: "jCWxQFPV7tHpgXah", fightId: 1, rev: 1, slug: "algethar-academy", idx: 1 },
      { code: "rmd1P7KygazYHVD3", fightId: 4, rev: 1, slug: "magisters-terrace", idx: 1 },
      { code: "J74TYzhxH2DvdWGM", fightId: 3, rev: 1, slug: "nexus-point-xenas", idx: 0 },
      { code: "prNT4XkJmPRcwhGq", fightId: 1, rev: 1, slug: "seat-of-the-triumvirate", idx: 0 },
      { code: "7PajpgxkvT3y6KAc", fightId: 1, rev: 1, slug: "skyreach", idx: 0 },
      { code: "3cCGwYHK9r82aDNj", fightId: 4, rev: 1, slug: "windrunner-spire", idx: 1 },
    ];
    const changed = [
      { code: "QfMvDaxTqAkXmwyR", fightId: 3, from: 1, to: 4, slug: "magisters-terrace", idx: 0 },
      { code: "RycgPJ9rjxT6v1Bw", fightId: 18, from: 1, to: 11, slug: "maisara-caverns", idx: 0 },
      { code: "RycgPJ9rjxT6v1Bw", fightId: 17, from: 1, to: 11, slug: "maisara-caverns", idx: 1 },
      { code: "Gq4jDxYLCcyNFBHT", fightId: 6, from: 1, to: 11, slug: "nexus-point-xenas", idx: 1 },
      { code: "HR9nY6kKJ4xQm378", fightId: 9, from: 1, to: 10, slug: "pit-of-saron", idx: 0 },
      { code: "2MdLn3NVymJTYzg6", fightId: 6, from: 1, to: 6, slug: "pit-of-saron", idx: 1 },
      { code: "Gq4jDxYLCcyNFBHT", fightId: 9, from: 1, to: 11, slug: "seat-of-the-triumvirate", idx: 1 },
      { code: "dyTBMQ3p6R1kVHGb", fightId: 7, from: 1, to: 10, slug: "skyreach", idx: 1 },
      { code: "fWJTbkMCP3a4A1Rd", fightId: 3, from: 1, to: 6, slug: "windrunner-spire", idx: 0 },
    ];

    const priorSlots = [
      ...unchanged.map((u, i) => ({
        id: `prior-u-${i}`,
        manifestId: PRIOR_ID,
        dungeonId: `d-${u.slug}`,
        slotIndex: u.idx,
        state: "SELECTED",
        reportCode: u.code,
        fightId: u.fightId,
        reportRevision: u.rev,
        dungeon: { slug: u.slug },
        datasets: [
          rankingRow({
            id: `rank-u-${i}`,
            reportCode: u.code,
            fightId: u.fightId,
            reportRevision: u.rev,
            fingerprint: `fp-u-${i}`,
          }),
        ],
      })),
      ...changed.map((c, i) => ({
        id: `prior-c-${i}`,
        manifestId: PRIOR_ID,
        dungeonId: `d-${c.slug}`,
        slotIndex: c.idx,
        state: "SELECTED",
        reportCode: c.code,
        fightId: c.fightId,
        reportRevision: c.from,
        dungeon: { slug: c.slug },
        datasets: [
          rankingRow({
            id: `rank-c-${i}`,
            reportCode: c.code,
            fightId: c.fightId,
            reportRevision: c.from,
            fingerprint: `fp-c-${i}`,
          }),
        ],
      })),
    ];

    const newSlots = [
      ...unchanged.map((u, i) => ({
        id: `new-u-${i}`,
        manifestId: NEW_ID,
        dungeonId: `d-${u.slug}`,
        slotIndex: u.idx,
        state: "SELECTED",
        reportCode: u.code,
        fightId: u.fightId,
        reportRevision: u.rev,
        dungeon: { slug: u.slug },
        datasets: [] as ReturnType<typeof rankingRow>[],
      })),
      ...changed.map((c, i) => ({
        id: `new-c-${i}`,
        manifestId: NEW_ID,
        dungeonId: `d-${c.slug}`,
        slotIndex: c.idx,
        state: "SELECTED",
        reportCode: c.code,
        fightId: c.fightId,
        reportRevision: c.to,
        dungeon: { slug: c.slug },
        datasets: [] as ReturnType<typeof rankingRow>[],
      })),
    ];

    expect(priorSlots).toHaveLength(16);
    expect(newSlots).toHaveLength(16);

    const created: Array<{
      manifestSlotId: string;
      compatibilityKey: string;
      payloadFingerprint: string | null;
    }> = [];

    const prisma = {
      evidenceManifestSlot: {
        findMany: vi.fn(async ({ where }: { where: { manifestId: string } }) => {
          if (where.manifestId === PRIOR_ID) return priorSlots;
          if (where.manifestId === NEW_ID) return newSlots;
          return [];
        }),
      },
    };

    const evidence = {
      findDatasetByCompatibilityKey: vi.fn(async (key: string) => {
        // New revision keys have no ranking yet.
        if (changed.some((c) => key.startsWith(`${c.code}:${c.fightId}:${c.to}:`))) {
          return null;
        }
        const hit = priorSlots
          .flatMap((s) => s.datasets)
          .find((d) => d.compatibilityKey === key);
        return hit ?? null;
      }),
      findDatasetBySlotAndKey: vi.fn(async () => null),
      createDataset: vi.fn(async (input: {
        manifestSlotId: string;
        compatibilityKey: string;
        payloadFingerprint?: string | null;
      }) => {
        created.push({
          manifestSlotId: input.manifestSlotId,
          compatibilityKey: input.compatibilityKey,
          payloadFingerprint: input.payloadFingerprint ?? null,
        });
        return {
          id: `created-${created.length}`,
          payloadFingerprint: input.payloadFingerprint ?? null,
        };
      }),
    };

    const first = await carryForwardRankingLineage({
      prisma: prisma as never,
      evidence,
      sourceManifestId: PRIOR_ID,
      targetManifestId: NEW_ID,
    });

    expect(first.carriedForward).toBe(7);
    expect(first.skippedIncompatibleRevision).toBe(9);
    expect(first.missing).toBe(0);
    expect(created).toHaveLength(7);
    for (const row of created) {
      expect(row.compatibilityKey).toMatch(/:1:RANKING_PARSE:/);
    }
    for (const d of first.diagnostics.filter((x) => x.revisionChanged)) {
      expect(d.outcome).toBe("SKIPPED_INCOMPATIBLE_REVISION");
      expect(d.newRankingDatasetId).toBeNull();
    }

    // Idempotent: already-bound rows on second pass.
    for (const slot of newSlots) {
      const made = created.find((c) => c.manifestSlotId === slot.id);
      if (made) {
        slot.datasets.push(
          rankingRow({
            id: `bound-${slot.id}`,
            reportCode: slot.reportCode!,
            fightId: slot.fightId!,
            reportRevision: slot.reportRevision!,
            fingerprint: made.payloadFingerprint ?? "fp",
          }),
        );
      }
    }
    const second = await carryForwardRankingLineage({
      prisma: prisma as never,
      evidence,
      sourceManifestId: PRIOR_ID,
      targetManifestId: NEW_ID,
    });
    expect(second.alreadyBound).toBe(7);
    expect(second.carriedForward).toBe(0);
    expect(created).toHaveLength(7);
  });

  it("does not mutate prior ranking descriptors when binding to a new slot", async () => {
    const priorDataset = rankingRow({
      id: "rank-1",
      reportCode: "ABC",
      fightId: 1,
      reportRevision: 1,
      fingerprint: "fp-1",
    });
    const priorSlots = [
      {
        id: "prior-slot",
        manifestId: PRIOR_ID,
        dungeonId: "d-1",
        slotIndex: 0,
        state: "SELECTED",
        reportCode: "ABC",
        fightId: 1,
        reportRevision: 1,
        dungeon: { slug: "algethar-academy" },
        datasets: [priorDataset],
      },
    ];
    const newSlots = [
      {
        id: "new-slot",
        manifestId: NEW_ID,
        dungeonId: "d-1",
        slotIndex: 0,
        state: "SELECTED",
        reportCode: "ABC",
        fightId: 1,
        reportRevision: 1,
        dungeon: { slug: "algethar-academy" },
        datasets: [] as typeof priorSlots[0]["datasets"],
      },
    ];
    const prisma = {
      evidenceManifestSlot: {
        findMany: vi.fn(async ({ where }: { where: { manifestId: string } }) =>
          where.manifestId === PRIOR_ID ? priorSlots : newSlots,
        ),
      },
    };
    const evidence = {
      findDatasetByCompatibilityKey: vi.fn(async () => priorDataset),
      findDatasetBySlotAndKey: vi.fn(async () => null),
      createDataset: vi.fn(async () => ({
        id: "new-rank",
        payloadFingerprint: "fp-1",
      })),
    };
    await carryForwardRankingLineage({
      prisma: prisma as never,
      evidence,
      sourceManifestId: PRIOR_ID,
      targetManifestId: NEW_ID,
    });
    expect(priorDataset.id).toBe("rank-1");
    expect(priorDataset.payloadFingerprint).toBe("fp-1");
    expect(evidence.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestSlotId: "new-slot",
        artifactId: "art-rank-1",
        payloadFingerprint: "fp-1",
      }),
    );
  });
});

describe("preflight rankingFactsMissing semantics", () => {
  it("keeps confidence math unchanged for 7/16 coverage", () => {
    const conf = computeScoringConfidenceV1({
      usableRunCount: 7,
      targetRunCount: 16,
      representedDungeonCount: 6,
      activeDungeonCount: 8,
    });
    expect(conf.confidenceScore).toBe(57);
  });
});
