import { describe, expect, it } from "vitest";
import { UTILITY_V2_AUDIT_CONFIG } from "./utility-v2-config.js";
import {
  auditUtilityV2Run,
  buildHostileCastWindows,
  domainDeltaFromEvidence,
  redistributeDomainWeights,
  scoreUtilityV2Run,
} from "./utility-v2-audit-logic.js";
import type { UtilityActorContext } from "./utility-probe-types.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";
import type { UtilityV2DomainEvidenceSummary, UtilityV2RunAudit } from "./utility-v2-types.js";

function baseRun(overrides: Partial<UtilityNormalizedRun> = {}): UtilityNormalizedRun {
  const datasets = {
    Interrupts: "OK",
    Casts: "OK",
    Buffs: "OK",
    Debuffs: "OK",
    Dispels: "OK",
    DamageDone: "OK",
    Deaths: "OK",
    CombatantInfo: "OK",
  } as UtilityNormalizedRun["datasetStates"];

  return {
    reportCode: "abc123",
    fightId: 1,
    dungeonSlug: "pit-of-saron",
    keyLevel: 12,
    durationMs: 3_600_000,
    playerActorId: 1,
    petActorIds: [2],
    specialization: "demonology",
    classSlug: "warlock",
    interruptEvents: [],
    ccEvents: [],
    dispelPurgeEvents: [],
    externalGroupUtilityEvents: [],
    classSpecificEvents: [],
    interruptOpportunities: [],
    dispelPurgeOpportunities: [],
    unmatchedAbilityIds: [],
    incompleteDatasets: [],
    datasetStates: datasets,
    truncatedDatasets: [],
    ...overrides,
  };
}

function actorCtx(): UtilityActorContext {
  return {
    playerActorId: 1,
    ownedPetActorIds: [2],
    friendlyPlayerIds: [3],
    actorsById: new Map([
      [1, { id: 1, name: "Player", type: "Player" }],
      [2, { id: 2, name: "Pet", type: "Pet", petOwner: 1 }],
      [10, { id: 10, name: "Caster", type: "NPC" }],
      [11, { id: 11, name: "Trash", type: "NPC" }],
    ]),
    hostileValidatedByDamage: new Set([10, 11]),
  };
}

describe("utility-v2-audit-logic", () => {
  it("uses neutral baseline 50 for empty evidence run", () => {
    const run = auditUtilityV2Run({
      normalized: baseRun(),
      raw: {
        runId: "abc123:1",
        reportCode: "abc123",
        fightId: 1,
        casts: [],
        buffs: [],
        debuffs: [],
        interrupts: [],
      },
      masterActors: [
        { id: 1, name: "Player", type: "Player" },
        { id: 2, name: "Pet", type: "Pet", petOwner: 1 },
      ],
    });
    expect(run.simulatedScore).toBe(UTILITY_V2_AUDIT_CONFIG.neutralBaseline);
    expect(run.deltaFromNeutral).toBe(0);
  });

  it("scores regular interrupt with interruptedSpellId as CONFIRMED_IMPACT cast stop", () => {
    const run = auditUtilityV2Run({
      normalized: baseRun({
        interruptEvents: [
          {
            timestamp: 1000,
            sourceID: 2,
            targetID: 10,
            abilityGameID: 347008,
            interruptedSpellId: 12345,
            sourceKind: "OWNED_PET",
            canonical: null,
            cooldownStateAtCast: "AVAILABLE",
            repeatedOnSameCast: false,
            unmatchedSpellId: false,
            event: {
              timestamp: 1000,
              sourceID: 2,
              targetID: 10,
              abilityGameID: 347008,
              extraAbilityGameID: 12345,
              type: "interrupt",
              hitType: null,
              fightId: 1,
              reportCode: "abc123",
              actorOwnership: "OWNED_PET",
              additionalFields: {},
              raw: {},
            },
          },
        ],
      }),
      raw: {
        runId: "abc123:1",
        reportCode: "abc123",
        fightId: 1,
        casts: [],
        buffs: [],
        debuffs: [],
        interrupts: [],
      },
      masterActors: [
        { id: 1, name: "Player", type: "Player" },
        { id: 2, name: "Pet", type: "Pet", petOwner: 1 },
        { id: 10, name: "Caster", type: "NPC" },
      ],
    });

    expect(run.domains.castStops.tierCounts.CONFIRMED_IMPACT).toBe(1);
    expect(run.simulatedScore).toBeGreaterThan(UTILITY_V2_AUDIT_CONFIG.neutralBaseline);
  });

  it("includes cross-stream CC from interrupt events in cast stops domain", () => {
    const run = auditUtilityV2Run({
      normalized: baseRun({
        interruptEvents: [
          {
            timestamp: 5000,
            sourceID: 1,
            targetID: 11,
            abilityGameID: 710,
            interruptedSpellId: null,
            sourceKind: "PLAYER",
            canonical: null,
            cooldownStateAtCast: "UNKNOWN",
            repeatedOnSameCast: false,
            unmatchedSpellId: true,
            event: {
              timestamp: 5000,
              sourceID: 1,
              targetID: 11,
              abilityGameID: 710,
              extraAbilityGameID: null,
              type: "applydebuff",
              hitType: null,
              fightId: 1,
              reportCode: "abc123",
              actorOwnership: "PLAYER",
              additionalFields: {},
              raw: {},
            },
          },
        ],
      }),
      raw: {
        runId: "abc123:1",
        reportCode: "abc123",
        fightId: 1,
        casts: [
          {
            timestamp: 4800,
            type: "begincast",
            source: { id: 11, type: "NPC", name: "Trash" },
            ability: { guid: 999, name: "Shadow Bolt" },
            interruptible: true,
          },
          {
            timestamp: 5100,
            type: "castfailed",
            source: { id: 11, type: "NPC", name: "Trash" },
            ability: { guid: 999, name: "Shadow Bolt" },
          },
        ],
        buffs: [],
        debuffs: [],
        interrupts: [],
      },
      masterActors: [
        { id: 1, name: "Player", type: "Player" },
        { id: 11, name: "Trash", type: "NPC" },
      ],
    });

    const castStopItems = run.domains.castStops.items;
    expect(castStopItems.some((i) => i.kind === "CROSS_STREAM_CAST_STOP")).toBe(true);
    expect(castStopItems.some((i) => i.tier === "CONFIRMED_IMPACT")).toBe(true);
  });

  it("gives partial credit for gateway cast-only evidence", () => {
    const run = auditUtilityV2Run({
      normalized: baseRun(),
      raw: {
        runId: "abc123:1",
        reportCode: "abc123",
        fightId: 1,
        casts: [
          {
            timestamp: 2000,
            type: "cast",
            source: { id: 1, type: "Warlock", name: "Player" },
            ability: { guid: 111771, name: "Demonic Gateway" },
          },
        ],
        buffs: [],
        debuffs: [],
        interrupts: [],
      },
      masterActors: [{ id: 1, name: "Player", type: "Player" }],
    });

    expect(run.domains.groupMobility.tierCounts.RAW_CAST).toBeGreaterThan(0);
    expect(run.domains.groupMobility.items[0]?.correlationNotes).toContain(
      "gateway_cast_placement_only_partial_credit",
    );
  });

  it("does not use Wallidrixe-calibrated caps in rubric config", () => {
    expect(UTILITY_V2_AUDIT_CONFIG.absoluteRubric.castStops).not.toHaveProperty("calibrationNote");
    expect(UTILITY_V2_AUDIT_CONFIG.absoluteRubric.castStops.maxDeltaAboveBaseline).toBe(18);
    expect(UTILITY_V2_AUDIT_CONFIG.notes.some((n) => n.includes("No caps or thresholds derived"))).toBe(
      true,
    );
  });

  it("redistributes domain weights proportionally when a domain is N/A", () => {
    const weights = redistributeDomainWeights(UTILITY_V2_AUDIT_CONFIG.domainWeights, {
      castStops: true,
      casterControl: false,
      strategicCc: true,
      mechanicAvoidance: true,
      groupMobility: true,
      support: true,
    });
    expect(weights.casterControl).toBe(0);
    expect(weights.castStops).toBeGreaterThan(UTILITY_V2_AUDIT_CONFIG.domainWeights.castStops);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("applies missed-opportunity penalty only when sensitivity scenario enables it", () => {
    const partial = {
      runId: "abc123:1",
      reportCode: "abc123",
      fightId: 1,
      dungeonSlug: "pit-of-saron",
      durationMs: 3_600_000,
      durationHours: 1,
      domains: Object.fromEntries(
        (Object.keys(UTILITY_V2_AUDIT_CONFIG.domainWeights) as Array<
          keyof typeof UTILITY_V2_AUDIT_CONFIG.domainWeights
        >).map((k) => [
          k,
          {
            domain: k,
            applicable: true,
            applicabilityReason: null,
            tierCounts: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
            items: [],
            normalizedRatesPerHour: { CONFIRMED_IMPACT: 0, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
            observability: "LIMITED" as const,
            confidence: "LOW" as const,
            missedOpportunityCount: 5,
          },
        ]),
      ) as UtilityV2RunAudit["domains"],
      missedInterruptOpportunities: 5,
    };

    const baseline = scoreUtilityV2Run(partial, {
      id: "baseline",
      label: "baseline",
      applyMissedOpportunityPenalty: false,
    });
    const penalized = scoreUtilityV2Run(partial, {
      id: "penalty",
      label: "penalty",
      applyMissedOpportunityPenalty: true,
    });

    expect(baseline.simulatedScore).toBe(50);
    expect(penalized.simulatedScore).toBeLessThan(50);
  });
});

describe("buildHostileCastWindows", () => {
  it("builds incomplete cast window from begincast + castfailed", () => {
    const ctx = actorCtx();
    const windows = buildHostileCastWindows(
      [
        {
          timestamp: 100,
          type: "begincast",
          source: { id: 10 },
          ability: { guid: 1 },
          interruptible: true,
        },
        {
          timestamp: 900,
          type: "castfailed",
          source: { id: 10 },
          ability: { guid: 1 },
        },
      ],
      ctx,
      1,
      "abc123",
    );
    expect(windows).toHaveLength(1);
    expect(windows[0]?.completed).toBe(false);
  });
});

describe("domainDeltaFromEvidence", () => {
  it("respects maxDeltaAboveBaseline cap", () => {
    const summary: UtilityV2DomainEvidenceSummary = {
      domain: "castStops",
      applicable: true,
      applicabilityReason: null,
      tierCounts: { CONFIRMED_IMPACT: 100, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      items: [],
      normalizedRatesPerHour: { CONFIRMED_IMPACT: 100, CONFIRMED_APPLICATION: 0, RAW_CAST: 0 },
      observability: "FULL",
      confidence: "HIGH",
      missedOpportunityCount: 0,
    };
    const delta = domainDeltaFromEvidence("castStops", summary);
    expect(delta).toBe(UTILITY_V2_AUDIT_CONFIG.absoluteRubric.castStops.maxDeltaAboveBaseline);
  });
});
