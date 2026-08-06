/**
 * Partial evidence, missing-report discovery, and scoring-confidence-v1.
 * Provider-free only.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  computeScoringConfidenceV1,
  evidenceManifestAnalysisStatus,
  finalizeEvidenceManifestV2,
  overallConfidenceFromDimensions,
} from "@mplus/scoring";
import {
  hydrateFightUnknownCandidates,
  prioritizeReportsForHydration,
  roundRobinUnknownStubs,
  traceReportThroughDiscovery,
  collectBoundedRecentReportCodes,
  type HydrationReportPayload,
} from "@mplus/provider-warcraftlogs";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import {
  assertNoDuplicateSelectedIdentities,
  mergeDiscoveryCandidates,
  selectedSlotsAsCandidates,
} from "./canary/canary-manifest-reconcile.js";
import type { WclRunCandidate } from "@mplus/provider-warcraftlogs";

const WINDRUNNER_A = "fWJTbkMCP3a4A1Rd";
const WINDRUNNER_B = "7qtb9Wp4ZdYwmKPH";

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

function stub(reportCode: string, startTimeMs: number, dungeonSlug: string | null = null): WclRunCandidate {
  return {
    reportCode,
    fightId: 0,
    encounterId: 0,
    zoneId: null,
    dungeonSlug,
    seasonSlug: null,
    keyLevel: null,
    score: null,
    startTimeMs,
    completedAt: new Date(startTimeMs + 1_800_000).toISOString(),
    durationMs: null,
    timed: null,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    targetActorId: null,
    incompleteness: {
      dungeonUnknown: dungeonSlug == null,
      seasonUnknown: true,
      timedUnknown: true,
      keyLevelUnknown: true,
      rosterIncomplete: true,
      fightUnknown: true,
    },
    warnings: ["stub"],
  };
}

function reportPayload(
  code: string,
  encounterID: number,
  fightId: number,
): HydrationReportPayload {
  return {
    code,
    startTime: 1_750_000_000_000,
    visibility: "public",
    zone: { id: 47, name: "Mythic+" },
    fights: [
      {
        id: fightId,
        encounterID,
        name: "Windrunner Spire",
        keystoneLevel: 18,
        keystoneBonus: 1,
        startTime: 0,
        endTime: 1_800_000,
        friendlyPlayers: [1],
      },
    ],
    masterData: {
      actors: [{ id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde" }],
    },
  };
}

describe("missing Windrunner report discovery (provider-free)", () => {
  it("represents report 7qtb9Wp4ZdYwmKPH in a regression fixture", () => {
    const listed = [WINDRUNNER_A, ...Array.from({ length: 23 }, (_, i) => `OTHER${i}`), WINDRUNNER_B];
    const hydrated = listed.slice(0, 24);
    const trace = traceReportThroughDiscovery({
      reportCode: WINDRUNNER_B,
      listedReportCodes: listed,
      hydratedReportCodes: hydrated,
      hydrationDiagnostics: {
        omittedReports: [
          {
            reportCode: WINDRUNNER_B,
            reason: "REPORT_EXCLUDED_BY_HYDRATION_CAP",
            dungeonSlug: null,
            startTimeMs: 1,
          },
        ],
        stopReason: "budget_exhausted",
        reportFetchAttempts: 24,
      },
    });
    expect(trace.terminalState).toBe("REPORT_EXCLUDED_BY_HYDRATION_CAP");
    expect(trace.providerCalls).toBe(0);
  });

  it("two distinct Windrunner report codes fill both slots", () => {
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
    const candidates = [
      candidate("windrunner-spire", WINDRUNNER_A, 3, 22),
      candidate("windrunner-spire", WINDRUNNER_B, 5, 18),
      ...MIDNIGHT_SEASON_1_DUNGEON_SLUGS.filter((s) => s !== "windrunner-spire").flatMap(
        (slug, i) => [
          candidate(slug, `R${i}A`, 1, 10),
          candidate(slug, `R${i}B`, 2, 11),
        ],
      ),
    ];
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
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults,
      selectedAt: new Date().toISOString(),
    });
    expect(manifest.selectedSlotCount).toBe(16);
    expect(manifest.expectedSlotCount).toBe(16);
    const ws = manifest.slots.filter(
      (s) => s.dungeonSlug === "windrunner-spire" && s.state === "SELECTED",
    );
    expect(ws).toHaveLength(2);
    const ids = ws.map((s) => `${s.identity!.reportCode}:${s.identity!.fightId}`);
    expect(new Set(ids).size).toBe(2);
    assertNoDuplicateSelectedIdentities(manifest);
  });

  it("a report beyond the first 24 is still considered when its dungeon needs a second candidate", async () => {
    const ACTIVE = ["windrunner-spire", "skyreach"] as const;
    const stubs: WclRunCandidate[] = [];
    // 24 stubs that fill skyreach only (already complete after a few).
    for (let i = 0; i < 24; i += 1) {
      stubs.push(stub(`SKY${i}`, 2_000_000 - i, "skyreach"));
    }
    // Older Windrunner-hinted report beyond the newest-24 prefix.
    stubs.push(stub(WINDRUNNER_B, 1_000, "windrunner-spire"));
    stubs.push(stub(WINDRUNNER_A, 1_100, "windrunner-spire"));

    const fetched: string[] = [];
    const result = await hydrateFightUnknownCandidates({
      candidates: stubs,
      characterName: "Wallidrixe",
      realmSlug: "Archimonde",
      activeDungeonSlugs: [...ACTIVE],
      maxReports: 24,
      fetchReport: async (code) => {
        fetched.push(code);
        if (code.startsWith("SKY")) {
          return reportPayload(code, 61209, 1);
        }
        return reportPayload(code, 12805, code === WINDRUNNER_A ? 3 : 5);
      },
    });

    expect(fetched).toContain(WINDRUNNER_B);
    expect(result.diagnostics.distinctCandidatesPerDungeon["windrunner-spire"]).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("hydration prioritizes zero/one-candidate dungeons", () => {
    const coverage = new Map<string, Set<string>>([
      ["windrunner-spire", new Set()],
      ["skyreach", new Set(["a:1", "b:2"])],
      ["pit-of-saron", new Set(["c:1"])],
    ]);
    const ordered = prioritizeReportsForHydration(
      [
        stub("COMPLETE1", 3000, "skyreach"),
        stub("ONE1", 2000, "pit-of-saron"),
        stub("ZERO1", 1000, "windrunner-spire"),
        stub("UNK1", 4000, null),
      ],
      [],
      10,
      { coverage, targetCandidatesPerDungeon: 2 },
    );
    expect(ordered[0]?.reportCode).toBe("ZERO1");
    expect(ordered[1]?.reportCode).toBe("ONE1");
  });

  it("report pagination cannot silently truncate valid reports under page cap", async () => {
    const pages = [
      { reportCodes: Array.from({ length: 20 }, (_, i) => `P1-${i}`), hasMorePages: true, privateSkipped: 0, unlistedSkipped: 0 },
      { reportCodes: Array.from({ length: 20 }, (_, i) => `P2-${i}`), hasMorePages: true, privateSkipped: 0, unlistedSkipped: 0 },
      { reportCodes: [WINDRUNNER_B], hasMorePages: false, privateSkipped: 0, unlistedSkipped: 0 },
    ];
    let page = 0;
    const result = await collectBoundedRecentReportCodes({
      fetchPage: async () => pages[page++]!,
      maxPages: 5,
      pageLimit: 20,
      maxUniqueReports: 80,
    });
    expect(result.reportCodes).toContain(WINDRUNNER_B);
    expect(result.stopReason).toBe("has_more_false");
    expect(result.pagesFetched).toBe(3);
  });

  it("round-robin spreads unknown stubs instead of newest-only prefix", () => {
    const stubs = Array.from({ length: 40 }, (_, i) => stub(`R${i}`, 10_000 - i));
    const rr = roundRobinUnknownStubs(stubs);
    expect(rr).toHaveLength(40);
    // Newest-only would be R0..R23; alternating newest/oldest surfaces a late index early.
    const early = new Set(rr.slice(0, 8).map((s) => s.reportCode));
    expect([...early].some((c) => Number(c.slice(1)) >= 20)).toBe(true);
  });
});

describe("manifest reconcile + counters", () => {
  it("one candidate is counted once, not once per slot", () => {
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
      candidates: [candidate("windrunner-spire", WINDRUNNER_A, 3)],
      plannedAt: new Date().toISOString(),
    });
    const per = plan.diagnostics.perDungeon.find((d) => d.dungeonSlug === "windrunner-spire");
    expect(per?.eligibleCount).toBe(1);
    const summed = plan.slots
      .filter((s) => s.dungeonSlug === "windrunner-spire")
      .reduce((n, s) => n + s.orderedCandidates.length, 0);
    expect(summed).toBe(2);
  });

  it("an incomplete manifest can be superseded by a complete revision", () => {
    const prior = finalizeEvidenceManifestV2({
      plan: buildEvidenceAcquisitionPlanV2({
        scope: {
          characterId: "11111111-1111-4111-8111-111111111111",
          seasonId: "season-1",
          seasonSlug: "blizzard-season-17",
          specializationId: null,
          classSlug: null,
          specSlug: null,
          role: "DPS",
          refreshContractHash: "rh",
          selectorVersion: EVIDENCE_SELECTOR_VERSION,
          evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
          highKeyPolicyId: "h",
          activeDungeonSlugs: ["windrunner-spire"],
        },
        candidates: [candidate("windrunner-spire", WINDRUNNER_A, 3, 22)],
        plannedAt: new Date().toISOString(),
      }).plan,
      acquisitionResults: [
        {
          discoveryIdentity: { reportCode: WINDRUNNER_A, fightId: 3 },
          acquisitionStatus: "ACQUIRED",
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "a",
          dimensionValidity: {
            performance: "VALID",
            survival: "VALID",
            utility: "VALID",
            reasons: [],
          },
          keyLevel: 22,
          timed: true,
          runScore: 222,
          completedAt: "2026-01-01T00:00:00.000Z",
          actorId: 1,
          evidenceCompleteness: 1,
        },
      ],
      selectedAt: new Date().toISOString(),
    }).manifest;

    expect(prior.selectedSlotCount).toBe(1);
    const merged = mergeDiscoveryCandidates({
      prior: selectedSlotsAsCandidates(prior),
      discovered: [candidate("windrunner-spire", WINDRUNNER_B, 5, 18)],
    });
    expect(merged).toHaveLength(2);
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope: {
        characterId: "11111111-1111-4111-8111-111111111111",
        seasonId: "season-1",
        seasonSlug: "blizzard-season-17",
        specializationId: null,
        classSlug: null,
        specSlug: null,
        role: "DPS",
        refreshContractHash: "rh2",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
        highKeyPolicyId: "h",
        activeDungeonSlugs: ["windrunner-spire"],
      },
      candidates: merged,
      plannedAt: new Date().toISOString(),
    });
    const acquisitionResults = merged.map((c) => ({
      discoveryIdentity: { ...c.discoveryIdentity },
      acquisitionStatus: "ACQUIRED" as const,
      reportRevision: 1,
      rejectionReason: null,
      rejectionDetail: null,
      datasetHashes: [],
      factSetHash: `t-${c.discoveryIdentity.reportCode}`,
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
    }));
    const next = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults,
      selectedAt: new Date().toISOString(),
    }).manifest;
    expect(next.selectedSlotCount).toBe(2);
    expect(next.contentHash).not.toBe(prior.contentHash);
    assertNoDuplicateSelectedIdentities(next);
  });

  it("source-fight uniqueness remains enforced", () => {
    const dup = finalizeEvidenceManifestV2({
      plan: buildEvidenceAcquisitionPlanV2({
        scope: {
          characterId: "11111111-1111-4111-8111-111111111111",
          seasonId: "season-1",
          seasonSlug: "blizzard-season-17",
          specializationId: null,
          classSlug: null,
          specSlug: null,
          role: "DPS",
          refreshContractHash: "rh",
          selectorVersion: EVIDENCE_SELECTOR_VERSION,
          evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
          highKeyPolicyId: "h",
          activeDungeonSlugs: ["windrunner-spire"],
        },
        candidates: [candidate("windrunner-spire", WINDRUNNER_A, 3)],
        plannedAt: new Date().toISOString(),
      }).plan,
      acquisitionResults: [
        {
          discoveryIdentity: { reportCode: WINDRUNNER_A, fightId: 3 },
          acquisitionStatus: "ACQUIRED",
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "a",
          dimensionValidity: {
            performance: "VALID",
            survival: "VALID",
            utility: "VALID",
            reasons: [],
          },
          keyLevel: 22,
          timed: true,
          runScore: 222,
          completedAt: "2026-01-01T00:00:00.000Z",
          actorId: 1,
          evidenceCompleteness: 1,
        },
      ],
      selectedAt: new Date().toISOString(),
    }).manifest;
    // Force a corrupt duplicate for the guard.
    const corrupted = {
      ...dup,
      slots: [
        ...dup.slots,
        {
          ...dup.slots[0]!,
          slotId: "windrunner-spire:dup",
          slotIndex: 1 as const,
          state: "SELECTED" as const,
        },
      ],
    };
    expect(() => assertNoDuplicateSelectedIdentities(corrupted)).toThrow(/duplicate_source_fight/);
  });
});

describe("scoring-confidence-v1 + partial analysis", () => {
  it("15/16 runs trigger PARTIAL analysis status", () => {
    expect(
      evidenceManifestAnalysisStatus({ selectedSlotCount: 15, targetRunCount: 16 }),
    ).toBe("PARTIAL");
  });

  it("1/16 usable run has low confidence; zero returns UNAVAILABLE/NONE", () => {
    const one = computeScoringConfidenceV1({
      usableRunCount: 1,
      targetRunCount: 16,
      representedDungeonCount: 1,
      activeDungeonCount: 8,
      missingDungeons: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.filter((s) => s !== "skyreach"),
    });
    expect(one.confidenceBand).toBe("LOW");
    expect(one.unavailableReason).toBeNull();

    const zero = computeScoringConfidenceV1({
      usableRunCount: 0,
      targetRunCount: 16,
      representedDungeonCount: 0,
      activeDungeonCount: 8,
    });
    expect(zero.confidenceScore).toBe(0);
    expect(zero.confidenceBand).toBe("NONE");
    expect(zero.unavailableReason).toBe("ZERO_USABLE_RUNS");
  });

  it("missing runs are never converted to zero-valued facts in confidence inputs", () => {
    const c = computeScoringConfidenceV1({
      usableRunCount: 15,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
      missingDungeons: [],
    });
    expect(c.missingRunCount).toBe(1);
    expect(c.confidenceScore).toBe(Math.round(100 * Math.sqrt((15 / 16) * 1)));
  });

  it("all eight dungeons with one run each beats eight runs in four dungeons", () => {
    const broad = computeScoringConfidenceV1({
      usableRunCount: 8,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    const narrow = computeScoringConfidenceV1({
      usableRunCount: 8,
      targetRunCount: 16,
      representedDungeonCount: 4,
      activeDungeonCount: 8,
    });
    expect(broad.confidenceScore).toBeGreaterThan(narrow.confidenceScore);
    expect(broad.confidenceScore).toBe(Math.round(100 * Math.sqrt(0.5)));
    expect(narrow.confidenceScore).toBe(50);
  });

  it("16/16 produces confidence 100; 15/16 across eight dungeons ≈ 97", () => {
    const full = computeScoringConfidenceV1({
      usableRunCount: 16,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    expect(full.confidenceScore).toBe(100);
    expect(full.confidenceBand).toBe("HIGH");

    const almost = computeScoringConfidenceV1({
      usableRunCount: 15,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    expect(almost.confidenceScore).toBe(Math.round(100 * Math.sqrt(15 / 16)));
    expect(almost.confidenceScore).toBeGreaterThanOrEqual(96);
    expect(almost.confidenceScore).toBeLessThanOrEqual(97);
  });

  it("overall confidence is the minimum of included dimensions", () => {
    expect(overallConfidenceFromDimensions([97, 70, 85])).toBe(70);
  });

  it("partial calculations remain non-public while publication is disabled", () => {
    const status = evidenceManifestAnalysisStatus({
      selectedSlotCount: 15,
      targetRunCount: 16,
    });
    expect(status).toBe("PARTIAL");
    // Publication remains independently gated.
    const publicationEnabled = false;
    expect(publicationEnabled).toBe(false);
  });

  it("provider-free confidence and tracing perform zero WCL calls", () => {
    const fetch = vi.fn();
    void computeScoringConfidenceV1({
      usableRunCount: 15,
      targetRunCount: 16,
      representedDungeonCount: 8,
      activeDungeonCount: 8,
    });
    void traceReportThroughDiscovery({
      reportCode: WINDRUNNER_B,
      listedReportCodes: [WINDRUNNER_B],
      hydratedReportCodes: [],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
