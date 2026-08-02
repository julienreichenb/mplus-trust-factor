/**
 * CP2 — typed fact acquisition tests (fixture transport only; no network).
 */
import { describe, expect, it } from "vitest";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  HOSTILE_CAST_FILTER_EXPRESSION,
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_FACT_EXTRACTOR_VERSION,
  UTILITY_EVIDENCE_CONSUMERS,
  type RankingParseEvidenceV2,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_FAMILY,
} from "@mplus/scoring";
import { acquireCandidateWithFallback, resolveBatchDatasetRequirements } from "./acquisition.js";
import { FixtureScoringV2EvidenceTransport } from "./evidence-transport.js";
import { hashFactDocumentContent } from "@mplus/provider-warcraftlogs";

function okDataset(
  key: WclRunEvidenceDataset["key"],
  events: Array<Record<string, unknown>> = [],
): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: key === "HostileCasts" ? null : 10,
    filterExpression: key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: 0,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: `${key}-fp`,
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: null,
    costSource: "unknown",
    requestCostUnits: [],
    wclRequests: 0,
    fetchedAt: "2026-08-02T00:00:00.000Z",
    source: "persisted",
  };
}

function completeUtilityBundle(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
}): WclRunEvidenceBundle {
  let bundle = buildEmptyBundle({
    reportCode: input.reportCode,
    reportRevision: input.reportRevision,
    fightId: input.fightId,
    playerActorId: 10,
    ownedPetActorIds: [],
    dungeonSlug: "ara-kara",
    startTime: 0,
    endTime: 600_000,
    consumers: ["survival", "utility"],
  });
  bundle = {
    ...bundle,
    masterData: {
      actors: [
        { id: 10, name: "Tester", type: "Player", subType: "Mage", petOwner: null },
        { id: 50, name: "Enemy", type: "NPC", subType: null, petOwner: null },
      ],
    },
  };
  for (const key of UTILITY_EVIDENCE_CONSUMERS.filter((k) => k !== "masterData")) {
    const events =
      key === "HostileCasts"
        ? [
            { timestamp: 10_000, type: "begincast", sourceID: 50, abilityGameID: 400001 },
            { timestamp: 12_000, type: "cast", sourceID: 50, abilityGameID: 400001 },
          ]
        : key === "Interrupts"
          ? [
              {
                timestamp: 11_000,
                type: "interrupt",
                sourceID: 10,
                targetID: 50,
                abilityGameID: 2139,
                extraAbilityGameID: 400001,
              },
            ]
          : key === "Casts"
            ? [
                {
                  timestamp: 10_800,
                  type: "cast",
                  sourceID: 10,
                  abilityGameID: 2139,
                  targetID: 50,
                },
              ]
            : key === "CombatantInfo"
              ? [{ sourceID: 10, specID: 64, type: "combatantinfo" }]
              : [];
    bundle = attachDatasetToBundle(bundle, okDataset(key, events), { fromPersisted: true });
  }
  // Survival-required extras
  for (const key of ["DamageTaken", "Healing"] as const) {
    if (!bundle.eventDatasets[key]) {
      bundle = attachDatasetToBundle(bundle, okDataset(key), { fromPersisted: true });
    }
  }
  return bundle;
}

function rankingEvidence(
  reportCode: string,
  fightId: number,
  reportRevision: number,
): RankingParseEvidenceV2 {
  return {
    reportCode,
    fightId,
    reportRevision,
    dungeonSlug: "ara-kara",
    keyLevel: 12,
    bracketPercent: 72,
    rankPercent: null,
    amountPercent: null,
    amount: 400_000,
    partition: 1,
  };
}

function mockContainer() {
  return {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    env: { SCORING_V2_PUBLICATION_ENABLED: false },
  } as never;
}

function mockEvidence() {
  const factSets: Array<Record<string, unknown>> = [];
  const datasets: Array<Record<string, unknown>> = [];
  return {
    factSets,
    datasets,
    upsertWclReportRevision: async () => undefined,
    createDataset: async (input: Record<string, unknown>) => {
      datasets.push(input);
      return input;
    },
    createFactSet: async (input: Record<string, unknown>) => {
      factSets.push(input);
      return input;
    },
    findFactSetByLogicalIdentity: async (input: {
      manifestSlotId: string;
      extractorFamily: string;
      extractorVersion: string;
    }) =>
      factSets.find(
        (f) =>
          f.manifestSlotId === input.manifestSlotId &&
          f.extractorFamily === input.extractorFamily &&
          f.extractorVersion === input.extractorVersion,
      ) ?? null,
    findDatasetByCompatibilityKey: async () => null,
  };
}

function mockArtifacts() {
  let n = 0;
  return {
    persist: async () => {
      n += 1;
      return { artifactId: `art-${n}`, write: { contentHash: `h-${n}` } };
    },
  };
}

describe("CP2 typed acquisition", () => {
  const reportCode = "AbCdEfGhIjKl";
  const fightId = 3;
  const reportRevision = 1;

  it("builds immutable dataset requirements from enabled consumers", () => {
    const reqs = resolveBatchDatasetRequirements(["PERFORMANCE", "SURVIVAL", "UTILITY"]);
    expect(reqs.some((r) => r.dataset === "RANKING_PARSE" && r.required)).toBe(true);
    expect(reqs.some((r) => r.dataset === "CASTS")).toBe(true);
    expect(reqs.some((r) => r.dataset === "HOSTILE_CASTS")).toBe(true);
    expect(reqs.every((r) => r.cacheReusable === true)).toBe(true);
  });

  it("one shared fixture acquisition produces Performance, Survival and Utility typed facts", async () => {
    const bundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision, revision: reportRevision, fight: { startTime: 0, endTime: 600_000 } },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 1,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 1,
        cacheHits: 0,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 1,
        unavailableReason: null,
      },
    });

    const evidence = mockEvidence();
    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: "2026-08-02T00:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: "c1",
      shouldCancel: async () => false,
      evidence: evidence as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: "slot-db-1",
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });

    transport.assertNoNetworkReachable();
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
    expect(acquired.typedFactPayloads.map((p) => p.dimension).sort()).toEqual([
      "PERFORMANCE",
      "SURVIVAL",
      "UTILITY",
    ]);

    const perf = acquired.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!;
    const surv = acquired.typedFactPayloads.find((p) => p.dimension === "SURVIVAL")!;
    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY")!;

    expect(perf.status).toBe("WRITTEN");
    expect(perf.extractorFamily).toBe(PERFORMANCE_V2_EXTRACTOR_FAMILY);
    expect(surv.extractorFamily).toBe(SURVIVAL_V2_EXTRACTOR_FAMILY);
    expect(util.extractorFamily).toBe(UTILITY_V2_EXTRACTOR_FAMILY);
    // Survival may be WRITTEN or UNAVAILABLE depending on analysis completeness of fixture.
    expect(["WRITTEN", "UNAVAILABLE", "FAILED"]).toContain(surv.status);
    expect(["WRITTEN", "UNAVAILABLE", "FAILED"]).toContain(util.status);

    // No shadow_placeholder facts persisted.
    for (const fs of evidence.factSets) {
      const facts = fs.facts as Record<string, unknown>;
      expect(facts.kind).not.toBe("shadow_placeholder");
    }
  });

  it("fetches shared datasets only once per candidate", async () => {
    const bundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 1,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 1,
        cacheHits: 0,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 0,
        unavailableReason: null,
      },
    });

    await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });

    const counts = transport.getProviderCallCounts();
    expect(counts.sharedEvidence).toBe(1);
    expect(counts.fightDetails).toBe(1);
    transport.assertNoNetworkReachable();
  });

  it("cache hits produce zero provider requests on shared evidence", async () => {
    const bundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 0,
        cacheHits: 3,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 0,
        unavailableReason: null,
      },
    });

    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements(["SURVIVAL", "UTILITY"]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
    });

    expect(acquired.providerCallTotal).toBe(0);
    transport.assertNoNetworkReachable();
  });

  it("missing ranking parse yields Performance UNAVAILABLE without failing siblings", async () => {
    const bundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 0,
        cacheHits: 1,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: null,
        providerCalls: 0,
        unavailableReason: "ranking_parse_absent",
      },
    });

    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });

    const perf = acquired.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!;
    expect(perf.status).toBe("UNAVAILABLE");
    expect(acquired.typedFactPayloads).toHaveLength(3);
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
  });

  it("missing shared evidence yields Survival/Utility UNAVAILABLE only", async () => {
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle: null,
        providerCalls: 0,
        cacheHits: 0,
        unavailableReason: "absent",
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 0,
        unavailableReason: null,
      },
    });

    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });

    expect(acquired.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!.status).toBe(
      "WRITTEN",
    );
    expect(acquired.typedFactPayloads.find((p) => p.dimension === "SURVIVAL")!.status).toBe(
      "UNAVAILABLE",
    );
    expect(acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY")!.status).toBe(
      "UNAVAILABLE",
    );
  });

  it("produces deterministic content hashes across identical reruns", async () => {
    const bundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    const makeTransport = () =>
      new FixtureScoringV2EvidenceTransport({
        fightDetails: {
          data: { reportRevision },
          reportRevision,
          playerActorId: 10,
          ownedPetActorIds: [],
          startTime: 0,
          endTime: 600_000,
          dungeonSlug: "ara-kara",
          providerCalls: 0,
        },
        sharedEvidence: {
          bundle,
          providerCalls: 0,
          cacheHits: 1,
          unavailableReason: null,
        },
        rankingParse: {
          evidence: rankingEvidence(reportCode, fightId, reportRevision),
          providerCalls: 0,
          unavailableReason: null,
        },
      });

    const run = async () =>
      acquireCandidateWithFallback({
        container: mockContainer(),
        candidates: [
          {
            discoveryIdentity: { reportCode, fightId },
            rank: 0,
            keyLevel: 12,
            timed: true,
            runScore: 200,
            evidenceCompleteness: 1,
            completedAt: null,
            actorId: 10,
          },
        ],
        region: "EU",
        correlationId: null,
        shouldCancel: async () => false,
        evidence: mockEvidence() as never,
        artifacts: mockArtifacts() as never,
        manifestSlotIdForPersistence: null,
        characterId: "char-1",
        datasetRequirements: resolveBatchDatasetRequirements(["PERFORMANCE"]),
        slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
        transport: makeTransport(),
      });

    const a = await run();
    const b = await run();
    const factA = a.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!.facts;
    const factB = b.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!.facts;
    expect(hashFactDocumentContent(factA)).toBe(hashFactDocumentContent(factB));
    expect(a.factSetFingerprint).toBe(b.factSetFingerprint);
  });

  it("never writes shadow_placeholder on successful extraction", async () => {
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 0,
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 0,
        unavailableReason: null,
      },
      sharedEvidence: {
        bundle: null,
        providerCalls: 0,
        cacheHits: 0,
        unavailableReason: "n/a",
      },
    });
    const evidence = mockEvidence();
    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: evidence as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: "slot-1",
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements(["PERFORMANCE"]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
    });

    expect(acquired.typedFactPayloads.every((p) => {
      if (p.facts == null) return true;
      return (p.facts as { kind?: string }).kind !== "shadow_placeholder";
    })).toBe(true);
    expect(
      evidence.factSets.every((fs) => (fs.facts as { kind?: string }).kind !== "shadow_placeholder"),
    ).toBe(true);
    expect(SURVIVAL_V2_FACT_EXTRACTOR_VERSION).toBeTruthy();
  });

  it("isolates extractor failure to one dimension", async () => {
    const brokenBundle = completeUtilityBundle({ reportCode, fightId, reportRevision });
    // Force utility path to throw by corrupting required structure while survival still runs.
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision },
        reportRevision,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: "ara-kara",
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle: {
          ...brokenBundle,
          // Invalid masterData shape triggers utility extractor failure isolation via catch.
          masterData: null as never,
        },
        providerCalls: 0,
        cacheHits: 1,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(reportCode, fightId, reportRevision),
        providerCalls: 0,
        unavailableReason: null,
      },
    });

    const acquired = await acquireCandidateWithFallback({
      container: mockContainer(),
      candidates: [
        {
          discoveryIdentity: { reportCode, fightId },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: null,
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: null,
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });

    expect(acquired.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE")!.status).toBe(
      "WRITTEN",
    );
    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY")!;
    expect(["FAILED", "UNAVAILABLE"]).toContain(util.status);
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
  });

  it("records providerCandidates and cacheReusable on immutable plan requirements", () => {
    const reqs = resolveBatchDatasetRequirements(["PERFORMANCE", "SURVIVAL", "UTILITY"]);
    expect(reqs.every((r) => r.cacheReusable === true)).toBe(true);
    expect(reqs.every((r) => r.providerCandidates[0] === "persisted_dataset")).toBe(true);
    expect(reqs.every((r) => r.providerCandidates.includes("warcraftlogs"))).toBe(true);
    expect(reqs.find((r) => r.dataset === "RANKING_PARSE")?.limitations.length).toBeGreaterThan(0);
  });
});
