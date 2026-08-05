/**
 * Incomplete-dungeon / counter diagnostics (provider-free).
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type CharacterSeasonEvidenceManifestV2,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "@mplus/scoring";
import { prioritizeReportsForHydration } from "@mplus/provider-warcraftlogs";
import {
  diagnoseIncompleteDungeonFromPersisted,
  isEligibleCounterDoubleCounted,
} from "./canary/canary-incomplete-dungeon-diag.js";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";

function candidate(
  dungeonSlug: string,
  reportCode: string,
  fightId: number,
  keyLevel = 12,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel,
    timed: true,
    runScore: 200 + keyLevel,
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

function finalizeFromCandidates(
  candidates: EvidenceCandidateMetadataV2[],
): CharacterSeasonEvidenceManifestV2 {
  const scope = {
    characterId: "11111111-1111-4111-8111-111111111111",
    seasonId: "season-1",
    seasonSlug: "blizzard-season-17",
    specializationId: null,
    classSlug: null,
    specSlug: null,
    role: "DPS" as const,
    refreshContractHash: "rh",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
    highKeyPolicyId: "h",
    activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
  };
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates,
    plannedAt: new Date().toISOString(),
  });
  const seen = new Set<string>();
  const acquisitionResults = [];
  for (const slot of plan.slots) {
    for (const c of slot.orderedCandidates) {
      const k = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      acquisitionResults.push({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED" as const,
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [],
        factSetHash: `t-${k}`,
        dimensionValidity: {
          performance: "VALID" as const,
          survival: "VALID" as const,
          utility: "VALID" as const,
          reasons: [] as string[],
        },
        keyLevel: c.keyLevel,
        timed: c.timed,
        runScore: c.runScore,
        completedAt: c.completedAt,
        actorId: c.actorId,
        evidenceCompleteness: c.evidenceCompleteness,
      });
    }
  }
  return finalizeEvidenceManifestV2({
    plan,
    acquisitionResults,
    selectedAt: new Date().toISOString(),
  }).manifest;
}

describe("incomplete dungeon diagnostics (provider-free)", () => {
  it("two slots require two distinct reportCode/fightId identities", () => {
    const one = finalizeFromCandidates([
      candidate("windrunner-spire", "AAA", 1, 22),
    ]);
    const ws = one.slots.filter((s) => s.dungeonSlug === "windrunner-spire");
    expect(ws.filter((s) => s.state === "SELECTED")).toHaveLength(1);
    expect(ws.some((s) => s.state === "MISSING_NO_CANDIDATE")).toBe(true);

    const two = finalizeFromCandidates([
      candidate("windrunner-spire", "AAA", 1, 22),
      candidate("windrunner-spire", "BBB", 2, 20),
    ]);
    const ws2 = two.slots.filter((s) => s.dungeonSlug === "windrunner-spire");
    const selected = ws2.filter((s) => s.state === "SELECTED");
    expect(selected).toHaveLength(2);
    const ids = selected.map(
      (s) => `${s.identity!.reportCode}:${s.identity!.fightId}`,
    );
    expect(new Set(ids).size).toBe(2);
  });

  it("one candidate cannot count twice toward two slots", () => {
    const manifest = finalizeFromCandidates([
      candidate("windrunner-spire", "SAME", 3, 22),
    ]);
    const diag = diagnoseIncompleteDungeonFromPersisted({
      dungeonSlug: "windrunner-spire",
      manifest,
    });
    expect(diag.providerCalls).toBe(0);
    expect(diag.uniqueCandidateIdentities).toBe(1);
    expect(diag.classification).toBe("ONLY_ONE_DISTINCT_CHARACTER_RUN_EXISTS");
    expect(diag.fights.every((f) => f.dedupeIdentity === "SAME:3" || f.sameSourceFightAsSelected)).toBe(
      true,
    );
  });

  it("missing-dungeon hydration is prioritized over covered dungeons", () => {
    const stubs = [
      {
        reportCode: "COVERED1",
        fightId: 0,
        encounterId: 1,
        zoneId: 47,
        dungeonSlug: "pit-of-saron",
        startTimeMs: 2_000,
        incompleteness: {
          dungeonUnknown: false,
          seasonUnknown: true,
          timedUnknown: true,
          keyLevelUnknown: true,
          rosterIncomplete: true,
          fightUnknown: true,
        },
      },
      {
        reportCode: "SHORT1",
        fightId: 0,
        encounterId: 2,
        zoneId: 47,
        dungeonSlug: "windrunner-spire",
        startTimeMs: 1_000,
        incompleteness: {
          dungeonUnknown: false,
          seasonUnknown: true,
          timedUnknown: true,
          keyLevelUnknown: true,
          rosterIncomplete: true,
          fightUnknown: true,
        },
      },
    ];
    const ordered = prioritizeReportsForHydration(stubs as never, [], 10, {
      underCoveredDungeonSlugs: new Set(["windrunner-spire"]),
    });
    expect(ordered[0]?.reportCode).toBe("SHORT1");
  });

  it("a real one-run dungeon remains explicitly incomplete", () => {
    const manifest = finalizeFromCandidates([
      candidate("windrunner-spire", "ONLY", 7, 18),
      // Fill other dungeons so coverage is not globally empty.
      ...MIDNIGHT_SEASON_1_DUNGEON_SLUGS.filter((s) => s !== "windrunner-spire").flatMap(
        (slug, i) => [
          candidate(slug, `R${i}A`, 1, 10),
          candidate(slug, `R${i}B`, 2, 11),
        ],
      ),
    ]);
    expect(manifest.selectedSlotCount).toBe(15);
    expect(manifest.expectedSlotCount).toBe(16);
    const missing = manifest.slots.find(
      (s) => s.slotId === "windrunner-spire:1",
    );
    expect(missing?.state).toBe("MISSING_NO_CANDIDATE");
  });

  it("candidate vs eligible counters have unambiguous definitions", () => {
    expect(
      isEligibleCounterDoubleCounted({
        candidateCount: 1,
        eligibleCount: 2,
      }),
    ).toBe(true);
    expect(
      isEligibleCounterDoubleCounted({
        candidateCount: 1,
        eligibleCount: 1,
      }),
    ).toBe(false);

    const candidates = [candidate("windrunner-spire", "A", 1)];
    const scope = {
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "season-1",
      seasonSlug: "blizzard-season-17",
      specializationId: null,
      classSlug: null,
      specSlug: null,
      role: "DPS" as const,
      refreshContractHash: "rh",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "h",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    };
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates,
      plannedAt: new Date().toISOString(),
    });
    const perDungeon = plan.diagnostics.perDungeon.find(
      (d) => d.dungeonSlug === "windrunner-spire",
    );
    // Unique eligible identities (correct definition).
    expect(perDungeon?.eligibleCount).toBe(1);
    // Shared chain appears on both slots — summing would falsely yield 2.
    const summed = plan.slots
      .filter((s) => s.dungeonSlug === "windrunner-spire")
      .reduce((n, s) => n + s.orderedCandidates.length, 0);
    expect(summed).toBe(2);
    expect(isEligibleCounterDoubleCounted({ candidateCount: 1, eligibleCount: summed })).toBe(
      true,
    );
  });

  it("provider-free diagnostics perform zero provider calls", () => {
    const manifest = finalizeFromCandidates([
      candidate("windrunner-spire", "fWJTbkMCP3a4A1Rd", 3, 22),
    ]);
    const diag = diagnoseIncompleteDungeonFromPersisted({
      dungeonSlug: "windrunner-spire",
      manifest,
    });
    expect(diag.providerCalls).toBe(0);
    expect(diag.classification).toBe("ONLY_ONE_DISTINCT_CHARACTER_RUN_EXISTS");
  });
});
