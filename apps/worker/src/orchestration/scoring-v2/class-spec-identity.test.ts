import { describe, expect, it } from "vitest";
import { getAbilityCatalog } from "@mplus/abilities";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceAcquisitionPlanV2,
} from "@mplus/contracts";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  HOSTILE_CAST_FILTER_EXPRESSION,
  UTILITY_EVIDENCE_CONSUMERS,
  type RankingParseEvidenceV2,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import { buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";
import {
  acquireCandidateWithFallback,
  buildFactSetFingerprint,
  resolveBatchDatasetRequirements,
} from "./acquisition.js";
import {
  resolveFrozenCharacterIdentity,
  resolveFrozenClassSpecIdentity,
} from "./class-spec-identity.js";
import { FixtureScoringV2EvidenceTransport } from "./evidence-transport.js";

function mageFrostPlan(overrides?: {
  classSlug?: string | null;
  specSlug?: string | null;
}): EvidenceAcquisitionPlanV2 {
  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope: {
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "season-tww",
      specializationId: null,
      classSlug: overrides?.classSlug === undefined ? "mage" : overrides.classSlug,
      specSlug: overrides?.specSlug === undefined ? "frost" : overrides.specSlug,
      role: "DPS",
      refreshContractHash: "contract",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: ["ara-kara"],
    },
    candidates: [
      {
        discoveryIdentity: { reportCode: "RepIdent1", fightId: 1 },
        reportRevision: null,
        dungeonSlug: "ara-kara",
        keyLevel: 12,
        timed: true,
        runScore: 200,
        evidenceCompleteness: 1,
        completedAt: "2026-07-01T12:00:00.000Z",
        fightDurationMs: 600_000,
        actorId: 10,
        accessState: "PUBLIC",
        identityResolution: "RESOLVED",
        fightAccessible: true,
        hardError: false,
        discoverySource: "test",
      },
    ],
    plannedAt: "2026-08-02T00:00:00.000Z",
  });
  return plan;
}

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

function completeBundle(input: {
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
                  timestamp: 5_000,
                  type: "cast",
                  sourceID: 10,
                  abilityGameID: 45438,
                },
              ]
            : [];
    bundle = attachDatasetToBundle(bundle, okDataset(key, events), { fromPersisted: true });
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
    env: {
      SCORING_V2_PUBLICATION_ENABLED: false,
      SCORING_V2_ENABLED: false,
      SCORING_V2_SELECTION_ENABLED: false,
      SCORING_V2_EVIDENCE_FETCH_ENABLED: false,
      SCORING_V2_PERFORMANCE_ENABLED: false,
      SCORING_V2_SURVIVAL_ENABLED: false,
      SCORING_V2_UTILITY_ENABLED: false,
    },
  } as never;
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

function mockEvidence() {
  return {
    upsertWclReportRevision: async () => undefined,
    createDataset: async (input: Record<string, unknown>) => input,
    createFactSet: async (input: Record<string, unknown>) => input,
    findFactSetByLogicalIdentity: async () => null,
    findDatasetByCompatibilityKey: async () => null,
  };
}

describe("resolveFrozenClassSpecIdentity", () => {
  it("resolves KNOWN from frozen plan metadata", () => {
    const id = resolveFrozenClassSpecIdentity({
      planClassSlug: "Mage",
      planSpecSlug: "Frost",
    });
    expect(id.state).toBe("KNOWN");
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
    expect(id.catalogDependentFailClosed).toBe(false);
  });

  it("resolves UNKNOWN without fabricating defaults", () => {
    const id = resolveFrozenClassSpecIdentity({
      planClassSlug: null,
      planSpecSlug: null,
    });
    expect(id.state).toBe("UNKNOWN");
    expect(id.classSlug).toBeNull();
    expect(id.specSlug).toBeNull();
    expect(id.limitations).toContain("class_spec_identity_unknown");
    expect(id.catalogDependentFailClosed).toBe(false);
  });

  it("fails closed on conflicting frozen vs persisted identity", () => {
    const id = resolveFrozenClassSpecIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
      persistedClassSlug: "warlock",
      persistedSpecSlug: "demonology",
    });
    expect(id.state).toBe("INCOMPATIBLE");
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
    expect(id.catalogDependentFailClosed).toBe(true);
    expect(id.limitations).toContain("class_spec_identity_incompatible");
  });

  it("does not silently switch frozen identity when persisted matches", () => {
    const id = resolveFrozenClassSpecIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
      persistedClassSlug: "mage",
      persistedSpecSlug: "frost",
    });
    expect(id.state).toBe("KNOWN");
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
  });
});

describe("resolveFrozenCharacterIdentity", () => {
  it("freezes coherent class/spec/role from Blizzard when Raider.IO is incomplete", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "Priest", specSlug: "Holy", role: "HEALER" },
      raiderIo: { classSlug: "mage" },
    });
    expect(id.state).toBe("KNOWN");
    expect(id.classSlug).toBe("priest");
    expect(id.specSlug).toBe("holy");
    expect(id.role).toBe("HEALER");
    expect(id.roleSource).toBe("canonical_spec");
  });

  it("prefers complete Blizzard over incomplete Raider.IO", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "warrior", specSlug: "protection", role: "TANK" },
      raiderIo: { role: "DPS" },
    });
    expect(id.classSlug).toBe("warrior");
    expect(id.specSlug).toBe("protection");
    expect(id.role).toBe("TANK");
  });

  it("does not silently default unknown role to DPS", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: null,
      raiderIo: null,
    });
    expect(id.role).toBe("UNKNOWN");
    expect(id.role).not.toBe("DPS");
    expect(id.roleSource).toBe("unknown");
    expect(id.limitations).toContain("role_identity_unknown");
  });

  it("fails closed when provider role conflicts with canonical spec role", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "priest", specSlug: "holy", role: "DPS" },
    });
    expect(id.state).toBe("INCOMPATIBLE");
    expect(id.role).toBe("UNKNOWN");
    expect(id.roleSource).toBe("incompatible");
    expect(id.limitations).toContain("role_identity_incompatible");
    expect(id.catalogDependentFailClosed).toBe(true);
  });

  it("reuses frozen plan identity on retries", () => {
    const id = resolveFrozenCharacterIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
      planRole: "DPS",
      // Conflicting live profiles must not override the frozen plan.
      blizzard: { classSlug: "warlock", specSlug: "affliction", role: "DPS" },
    });
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
    expect(id.role).toBe("DPS");
    expect(id.roleSource).toBe("plan");
  });

  it("never uses mutable Character.role — only provider/plan inputs", () => {
    // Simulate the refresh-pipeline call shape: Character.role is intentionally omitted.
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "monk", specSlug: "windwalker", role: "DPS" },
    });
    expect(id.role).toBe("DPS");
    expect(id.specSlug).toBe("windwalker");
  });

  it("prefers complete Raider.IO over role-only Blizzard", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { role: "DPS" },
      raiderIo: { classSlug: "mage", specSlug: "frost", role: "DPS" },
    });
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
    expect(id.role).toBe("DPS");
    expect(id.roleSource).toBe("canonical_spec");
  });

  it("prefers complete Raider.IO over class/spec-only Blizzard without role", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "warlock", specSlug: "affliction" },
      raiderIo: { classSlug: "mage", specSlug: "frost", role: "DPS" },
    });
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBe("frost");
    expect(id.role).toBe("DPS");
  });

  it("uses Blizzard when both providers complete with the same identity", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "priest", specSlug: "holy", role: "HEALER" },
      raiderIo: { classSlug: "priest", specSlug: "holy", role: "HEALER" },
    });
    expect(id.classSlug).toBe("priest");
    expect(id.specSlug).toBe("holy");
    expect(id.role).toBe("HEALER");
  });

  it("fails closed when both providers are complete but conflict", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "priest", specSlug: "holy", role: "HEALER" },
      raiderIo: { classSlug: "mage", specSlug: "frost", role: "DPS" },
    });
    expect(id.state).toBe("INCOMPATIBLE");
    expect(id.role).toBe("UNKNOWN");
    expect(id.role).not.toBe("DPS");
    expect(id.limitations).toContain("provider_identity_conflict");
  });

  it("preserves partial Blizzard when neither provider is complete", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { role: "DPS" },
      raiderIo: { classSlug: "mage" },
    });
    // Incomplete Blizzard (role-only) still outranks incomplete Rio when neither is a
    // complete tuple — class/spec stay unknown; provider role is preserved.
    expect(id.classSlug).toBeNull();
    expect(id.specSlug).toBeNull();
    expect(id.role).toBe("DPS");
    expect(id.roleSource).toBe("provider_profile");
  });

  it("returns UNKNOWN role with no provider identity", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: null,
      raiderIo: null,
    });
    expect(id.role).toBe("UNKNOWN");
    expect(id.role).not.toBe("DPS");
  });

  it("returns UNKNOWN role when partial providers lack playable role and canonical mapping", () => {
    const id = resolveFrozenCharacterIdentity({
      blizzard: { classSlug: "mage" },
      raiderIo: { classSlug: "warlock" },
    });
    expect(id.classSlug).toBe("mage");
    expect(id.specSlug).toBeNull();
    expect(id.role).toBe("UNKNOWN");
    expect(id.role).not.toBe("DPS");
  });
});

describe("production-style class/spec identity propagation", () => {
  const reportCode = "RepIdent1";
  const fightId = 1;
  const reportRevision = 1;

  it("freezes known class/spec on the acquisition plan (production path)", () => {
    const plan = mageFrostPlan();
    expect(plan.classSlug).toBe("mage");
    expect(plan.specSlug).toBe("frost");
    const frozen = resolveFrozenClassSpecIdentity({
      planClassSlug: plan.classSlug,
      planSpecSlug: plan.specSlug,
    });
    expect(frozen.state).toBe("KNOWN");
  });

  it("propagates known class/spec into Survival/Utility extractors", async () => {
    const plan = mageFrostPlan();
    const frozen = resolveFrozenClassSpecIdentity({
      planClassSlug: plan.classSlug,
      planSpecSlug: plan.specSlug,
    });
    const bundle = completeBundle({ reportCode, fightId, reportRevision });
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
          completedAt: "2026-08-02T00:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: "c1",
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
      classSlug: frozen.classSlug,
      specSlug: frozen.specSlug,
      classSpecIdentity: frozen,
    });

    transport.assertNoNetworkReachable();
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
    expect(acquired.typedFactPayloads.map((p) => p.dimension)).toEqual(
      expect.arrayContaining(["PERFORMANCE", "SURVIVAL", "UTILITY"]),
    );

    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY");
    expect(util).toBeDefined();
    expect(util!.status).toBe("WRITTEN");
    expect(util!.limitations).not.toContain("class_spec_identity_unknown");
    const utilFacts = util!.facts as {
      toolkit: { hasInterrupt: boolean };
      catalogCoverage: { abilityCatalogCoverage: number };
    };
    // Mage frost has Counterspell — toolkit must not look empty/unknown.
    expect(utilFacts.toolkit.hasInterrupt).toBe(true);
    expect(utilFacts.catalogCoverage.abilityCatalogCoverage).toBeGreaterThan(0);

    const surv = acquired.typedFactPayloads.find((p) => p.dimension === "SURVIVAL");
    expect(surv).toBeDefined();
    expect(["WRITTEN", "UNAVAILABLE", "FAILED"]).toContain(surv!.status);
    if (surv!.status === "WRITTEN") {
      expect(surv!.coverage).toMatchObject({ abilityCatalogSupported: true });
    }
  });

  it("Survival resolves the correct defensive toolkit for known identity", () => {
    const catalog = getAbilityCatalog({ classSlug: "mage", specSlug: "frost" });
    expect(catalog.supported).toBe(true);
    expect(catalog.classSlug).toBe("mage");
    expect(catalog.specSlug).toBe("frost");
    expect(
      catalog.rules.some(
        (r) =>
          r.category === "DEFENSIVE_MAJOR" ||
          r.category === "DEFENSIVE_MINOR" ||
          r.category === "IMMUNITY",
      ),
    ).toBe(true);
  });

  it("Utility resolves the correct catalog/toolkit for known identity", () => {
    const catalog = getAbilityCatalog({
      classSlug: "mage",
      specSlug: "frost",
      includeRacials: true,
    });
    expect(catalog.supported).toBe(true);
    expect(catalog.unsupportedReason).toBeUndefined();
    expect(catalog.rules.length).toBeGreaterThan(0);
  });

  it("fixture and production-style paths share the same identity behavior", () => {
    const fixtureIdentity = resolveFrozenClassSpecIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
    });
    const productionIdentity = resolveFrozenClassSpecIdentity({
      planClassSlug: mageFrostPlan().classSlug,
      planSpecSlug: mageFrostPlan().specSlug,
    });
    expect(fixtureIdentity).toEqual(productionIdentity);
    expect(fixtureIdentity.state).toBe("KNOWN");
  });

  it("unknown class/spec does not fabricate a confirmed-complete empty toolkit", async () => {
    const catalog = getAbilityCatalog({ classSlug: null, specSlug: null });
    expect(catalog.supported).toBe(false);
    expect(catalog.unsupportedReason).toBe("CLASS_SPEC_UNKNOWN");
    expect(catalog.rules.every((r) => r.classSlug == null)).toBe(true);

    const unknown = resolveFrozenClassSpecIdentity({
      planClassSlug: null,
      planSpecSlug: null,
    });
    const bundle = completeBundle({ reportCode, fightId, reportRevision });
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
          completedAt: "2026-08-02T00:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: "c1",
      shouldCancel: async () => false,
      evidence: mockEvidence() as never,
      artifacts: mockArtifacts() as never,
      manifestSlotIdForPersistence: null,
      characterId: "char-1",
      datasetRequirements: resolveBatchDatasetRequirements(["UTILITY"]),
      slotContext: { slotId: "ara-kara:0", dungeonSlug: "ara-kara", slotIndex: 0 },
      transport,
      classSlug: null,
      specSlug: null,
      classSpecIdentity: unknown,
    });

    transport.assertNoNetworkReachable();
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY")!;
    expect(util.status).toBe("WRITTEN");
    expect(util.limitations).toContain("class_spec_identity_unknown");
    expect(util.limitations).toContain("toolkit_coverage_unconfirmed");
    const facts = util.facts as {
      catalogCoverage: { abilityCatalogCoverage: number };
      toolkit: { hasInterrupt: boolean; hasSupport: boolean; hasStrategicCc: boolean };
    };
    expect(facts.catalogCoverage.abilityCatalogCoverage).toBe(0);
    // Empty booleans are unconfirmed coverage, not a confirmed "no toolkit" score penalty.
    expect(facts.toolkit).toEqual({
      hasInterrupt: false,
      hasSupport: false,
      hasStrategicCc: false,
    });
  });

  it("unknown identity degrades availability/confidence without score penalty", () => {
    const unknown = resolveFrozenClassSpecIdentity({
      planClassSlug: null,
      planSpecSlug: null,
    });
    expect(unknown.state).toBe("UNKNOWN");
    expect(unknown.catalogDependentFailClosed).toBe(false);
    expect(unknown.limitations.every((l) => !l.includes("player_failure"))).toBe(true);
    expect(unknown.limitations.every((l) => !l.includes("score_penalty"))).toBe(true);
  });

  it("conflicting frozen and persisted identity fails closed for Survival/Utility", async () => {
    const incompatible = resolveFrozenClassSpecIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
      persistedClassSlug: "warlock",
      persistedSpecSlug: "demonology",
    });
    expect(incompatible.catalogDependentFailClosed).toBe(true);

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
        bundle: completeBundle({ reportCode, fightId, reportRevision }),
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
          completedAt: "2026-08-02T00:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      correlationId: "c1",
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
      classSpecIdentity: incompatible,
    });

    transport.assertNoNetworkReachable();
    expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
    const surv = acquired.typedFactPayloads.find((p) => p.dimension === "SURVIVAL");
    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY");
    const perf = acquired.typedFactPayloads.find((p) => p.dimension === "PERFORMANCE");
    expect(surv?.status).toBe("UNAVAILABLE");
    expect(util?.status).toBe("UNAVAILABLE");
    expect(surv?.reason).toBe("class_spec_identity_incompatible");
    expect(util?.reason).toBe("class_spec_identity_incompatible");
    // Performance does not require class/spec — sibling recoverability preserved.
    expect(perf?.status).toBe("WRITTEN");
  });

  it("retry/redelivery preserves identical identity and hashes", () => {
    const parts = {
      reportCode: "R1",
      fightId: 1,
      reportRevision: 2,
      extractorFamily: "utility-v2",
      extractorVersion: "1.0.0",
      classSlug: "mage" as string | null,
      specSlug: "frost" as string | null,
    };
    expect(buildFactSetFingerprint(parts)).toBe(buildFactSetFingerprint(parts));
    const identity = resolveFrozenClassSpecIdentity({
      planClassSlug: "mage",
      planSpecSlug: "frost",
    });
    expect(
      resolveFrozenClassSpecIdentity({
        planClassSlug: "mage",
        planSpecSlug: "frost",
      }),
    ).toEqual(identity);
  });

  it("class/spec change changes fact fingerprint when catalog identity changes", () => {
    const frost = buildFactSetFingerprint({
      reportCode: "R1",
      fightId: 1,
      reportRevision: 2,
      extractorFamily: "utility-v2",
      extractorVersion: "1.0.0",
      classSlug: "mage",
      specSlug: "frost",
    });
    const fire = buildFactSetFingerprint({
      reportCode: "R1",
      fightId: 1,
      reportRevision: 2,
      extractorFamily: "utility-v2",
      extractorVersion: "1.0.0",
      classSlug: "mage",
      specSlug: "fire",
    });
    expect(frost).not.toBe(fire);
  });

  it("feature flags remain false by default and publication stays blocked", () => {
    const env = mockContainer().env as Record<string, unknown>;
    expect(env.SCORING_V2_ENABLED).toBe(false);
    expect(env.SCORING_V2_SELECTION_ENABLED).toBe(false);
    expect(env.SCORING_V2_EVIDENCE_FETCH_ENABLED).toBe(false);
    expect(env.SCORING_V2_PERFORMANCE_ENABLED).toBe(false);
    expect(env.SCORING_V2_SURVIVAL_ENABLED).toBe(false);
    expect(env.SCORING_V2_UTILITY_ENABLED).toBe(false);
    expect(env.SCORING_V2_PUBLICATION_ENABLED).toBe(false);
  });
});
