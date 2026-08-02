/**
 * Utility V2 Phase 1 — offline unit tests (no provider calls).
 */
import { describe, expect, it } from "vitest";
import {
  UTILITY_V2_ALGORITHM_VERSION,
  UTILITY_V2_DOMAIN_WEIGHTS,
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_MODEL_CONFIG,
  UTILITY_V2_SCORE_FLOOR,
  UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE,
  applyUnmatchedSpamCap,
  buildUtilityV2RunFactSet,
  classifyInterruptAttempts,
  computeUtilityV2,
  computeUtilityV2InputFingerprint,
  dedupeStrategicCc,
  emptyUtilityV2FactSet,
  exportUtilityV2Calibration,
  scoreSupportCredit,
  toUtilityV2ShadowDimensionPayload,
  type ClassifiedInterruptAttempt,
  type UtilityV2ComputeInput,
  type UtilityV2FrozenManifestRef,
  type UtilityV2RunFactSet,
} from "./index.js";

function attempt(
  id: string,
  ts: number,
  opts: Partial<{
    abilityGameId: number;
    sourceActorId: number;
    sourceKind: "PLAYER" | "OWNED_PET" | "OTHER";
    targetActorId: number | null;
  }> = {},
) {
  return {
    id,
    timestampMs: ts,
    abilityGameId: opts.abilityGameId ?? 2139,
    sourceActorId: opts.sourceActorId ?? 10,
    sourceKind: opts.sourceKind ?? ("PLAYER" as const),
    targetActorId: opts.targetActorId ?? 50,
  };
}

function selectedSlot(
  slotId: string,
  dungeonSlug: string,
  slotIndex: 0 | 1,
  identity: { reportCode: string; fightId: number; reportRevision: number },
) {
  return {
    slotId,
    dungeonSlug,
    slotIndex,
    state: "SELECTED",
    identity,
  };
}

function baseManifest(
  slots: UtilityV2FrozenManifestRef["slots"],
  overrides: Partial<UtilityV2FrozenManifestRef> = {},
): UtilityV2FrozenManifestRef {
  const selected = slots.filter((s) => s.state === "SELECTED" && s.identity != null);
  const dungeons = [...new Set(slots.map((s) => s.dungeonSlug))];
  return {
    contentHash: "manifest-hash-1",
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    expectedSlotCount: slots.length,
    selectedSlotCount: selected.length,
    activeDungeonSlugs: dungeons,
    slots,
    ...overrides,
  };
}

function boundFact(
  slotId: string,
  dungeonSlug: string,
  identity: { reportCode: string; fightId: number; reportRevision: number },
  partial: Partial<UtilityV2RunFactSet> = {},
): UtilityV2RunFactSet {
  return emptyUtilityV2FactSet({
    slotId,
    runId: `${identity.reportCode}:${identity.fightId}`,
    dungeonSlug,
    slotIndex: 0,
    reportCode: identity.reportCode,
    fightId: identity.fightId,
    reportRevision: identity.reportRevision,
    ...partial,
  });
}

function baseInput(
  overrides: Partial<UtilityV2ComputeInput> = {},
): UtilityV2ComputeInput {
  const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
  const slots = [selectedSlot("slot-a", "ara-kara", 0, identity)];
  const fact = boundFact("slot-a", "ara-kara", identity);
  return {
    manifest: baseManifest(slots, {
      expectedSlotCount: 1,
      selectedSlotCount: 1,
      activeDungeonSlugs: ["ara-kara"],
    }),
    factSets: [fact],
    ...overrides,
  };
}

describe("classifyInterruptAttempts", () => {
  it("classifies confirmed success from matching interrupt event", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("a1", 5000)],
      confirmedInterrupts: [
        {
          timestampMs: 5050,
          sourceActorId: 10,
          sourceKind: "PLAYER",
          targetActorId: 50,
          abilityGameId: 2139,
          interruptedSpellId: 400001,
        },
      ],
      hostileWindows: [],
      hostileObservabilityPresent: true,
    });
    expect(classified).toHaveLength(1);
    expect(classified[0]!.classification).toBe("CONFIRMED_SUCCESS");
    expect(classified[0]!.credit).toBe(UTILITY_V2_INTERRUPT_CREDITS.CONFIRMED_SUCCESS);
  });

  it("classifies valid overlap when another player stops the cast", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("a1", 2000)],
      confirmedInterrupts: [],
      hostileWindows: [
        {
          startMs: 1000,
          endMs: 3000,
          sourceActorId: 50,
          abilityGameId: 400001,
          completed: false,
          interrupted: true,
          interruptedByActorId: 20,
          interruptedByKind: "OTHER",
        },
      ],
      hostileObservabilityPresent: true,
    });
    expect(classified[0]!.classification).toBe("VALID_OVERLAP");
    expect(classified[0]!.credit).toBe(0.5);
  });

  it("classifies matched failed when hostile cast completes", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("a1", 2000)],
      confirmedInterrupts: [],
      hostileWindows: [
        {
          startMs: 1000,
          endMs: 3000,
          sourceActorId: 50,
          abilityGameId: 400001,
          completed: true,
          interrupted: false,
          interruptedByActorId: null,
          interruptedByKind: null,
        },
      ],
      hostileObservabilityPresent: true,
    });
    expect(classified[0]!.classification).toBe("MATCHED_FAILED");
    expect(classified[0]!.credit).toBe(0.2);
  });

  it("classifies unmatched when hostile stream present but no window match", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("a1", 50_000)],
      confirmedInterrupts: [],
      hostileWindows: [
        {
          startMs: 1000,
          endMs: 2500,
          sourceActorId: 50,
          abilityGameId: 400001,
          completed: true,
          interrupted: false,
          interruptedByActorId: null,
          interruptedByKind: null,
        },
      ],
      hostileObservabilityPresent: true,
    });
    expect(classified[0]!.classification).toBe("UNMATCHED_ATTEMPT");
    expect(classified[0]!.credit).toBe(0.05);
  });

  it("classifies not observable when hostile stream absent", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("a1", 5000)],
      confirmedInterrupts: [],
      hostileWindows: [],
      hostileObservabilityPresent: false,
    });
    expect(classified[0]!.classification).toBe("NOT_OBSERVABLE");
    expect(classified[0]!.credit).toBe(0);
  });

  it("attributes owned-pet attempts", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("pet1", 5000, { sourceActorId: 99, sourceKind: "OWNED_PET" })],
      confirmedInterrupts: [
        {
          timestampMs: 5000,
          sourceActorId: 99,
          sourceKind: "OWNED_PET",
          targetActorId: 50,
          abilityGameId: 2139,
          interruptedSpellId: 1,
        },
      ],
      hostileWindows: [],
      hostileObservabilityPresent: true,
    });
    expect(classified[0]!.classification).toBe("CONFIRMED_SUCCESS");
    expect(classified[0]!.sourceKind).toBe("OWNED_PET");
  });

  it("ignores non-attributed attempt seeds", () => {
    const classified = classifyInterruptAttempts({
      attempts: [attempt("other", 5000, { sourceKind: "OTHER" })],
      confirmedInterrupts: [],
      hostileWindows: [],
      hostileObservabilityPresent: true,
    });
    expect(classified).toHaveLength(0);
  });
});

describe("availability and binding contracts", () => {
  it("empty factSets => null / 0 / UNAVAILABLE", () => {
    const result = computeUtilityV2({
      ...baseInput(),
      factSets: [],
    });
    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.availabilityState).toBe("UNAVAILABLE");
    expect(result.explanation.bindingReasons).toContain("no_fact_sets");
  });

  it("identity mismatch => null / 0 / UNAVAILABLE", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const result = computeUtilityV2({
      manifest: baseManifest([selectedSlot("slot-a", "ara-kara", 0, identity)], {
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
      }),
      factSets: [
        boundFact("slot-a", "ara-kara", {
          reportCode: "R1",
          fightId: 1,
          reportRevision: 99,
        }),
      ],
    });
    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.availabilityState).toBe("UNAVAILABLE");
    expect(result.explanation.bindingReasons.some((r) => r.includes("mismatch"))).toBe(
      true,
    );
  });

  it("extraction failure => UNAVAILABLE", () => {
    const result = computeUtilityV2({
      ...baseInput(),
      extractionFailed: true,
    });
    expect(result.score).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.availabilityState).toBe("UNAVAILABLE");
  });

  it("unbound facts missing reportRevision => UNAVAILABLE", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const fact = boundFact("slot-a", "ara-kara", identity, { reportRevision: null });
    const result = computeUtilityV2({
      manifest: baseManifest([selectedSlot("slot-a", "ara-kara", 0, identity)], {
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
      }),
      factSets: [fact],
    });
    expect(result.score).toBeNull();
    expect(result.availabilityState).toBe("UNAVAILABLE");
  });

  it("bound facts with zero actions => score 50", () => {
    const result = computeUtilityV2(baseInput());
    expect(result.score).toBe(UTILITY_V2_SCORE_FLOOR);
    expect(result.availabilityState).toBe("AVAILABLE");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.35);
    expect(result.explanation.confidenceReasons).toContain("zero_attributable_events");
  });

  it("partial manifest coverage => PARTIAL", () => {
    const idA = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const idB = { reportCode: "R2", fightId: 2, reportRevision: 1 };
    const result = computeUtilityV2({
      manifest: baseManifest(
        [
          selectedSlot("slot-a", "ara-kara", 0, idA),
          selectedSlot("slot-b", "ara-kara", 1, idB),
        ],
        {
          expectedSlotCount: 2,
          selectedSlotCount: 2,
          activeDungeonSlugs: ["ara-kara"],
        },
      ),
      factSets: [boundFact("slot-a", "ara-kara", idA)],
    });
    expect(result.score).toBe(50);
    expect(result.availabilityState).toBe("PARTIAL");
    expect(result.context.boundSelectedSlotCount).toBe(1);
  });

  it("complete manifest coverage => AVAILABLE", () => {
    const idA = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const idB = { reportCode: "R2", fightId: 2, reportRevision: 1 };
    const result = computeUtilityV2({
      manifest: baseManifest(
        [
          selectedSlot("slot-a", "ara-kara", 0, idA),
          selectedSlot("slot-b", "ara-kara", 1, idB),
        ],
        {
          expectedSlotCount: 2,
          selectedSlotCount: 2,
          activeDungeonSlugs: ["ara-kara"],
        },
      ),
      factSets: [
        boundFact("slot-a", "ara-kara", idA, { slotIndex: 0 }),
        boundFact("slot-b", "ara-kara", idB, { slotIndex: 1, runId: "R2:2" }),
      ],
    });
    expect(result.availabilityState).toBe("AVAILABLE");
    expect(result.score).toBe(50);
  });
});

describe("fingerprint", () => {
  it("produces deterministic lowercase SHA-256 hex", () => {
    const a = computeUtilityV2(baseInput());
    const b = computeUtilityV2(baseInput());
    expect(a.inputFingerprint).toBe(b.inputFingerprint);
    expect(a.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(computeUtilityV2InputFingerprint(baseInput())).toBe(a.inputFingerprint);
  });

  it("changes when fact content changes", () => {
    const base = baseInput();
    const withAction = baseInput({
      factSets: [
        boundFact("slot-a", "ara-kara", { reportCode: "R1", fightId: 1, reportRevision: 1 }, {
          interruptAttempts: [
            {
              id: "s1",
              timestampMs: 1000,
              abilityGameId: 2139,
              sourceActorId: 10,
              sourceKind: "PLAYER",
              targetActorId: 50,
              classification: "CONFIRMED_SUCCESS",
              credit: 1,
              note: "ok",
            },
          ],
        }),
      ],
    });
    expect(computeUtilityV2InputFingerprint(base)).not.toBe(
      computeUtilityV2InputFingerprint(withAction),
    );
  });

  it("changes when slot identity changes", () => {
    const a = baseInput();
    const b = baseInput({
      factSets: [
        boundFact("slot-a", "ara-kara", { reportCode: "R1", fightId: 1, reportRevision: 2 }),
      ],
      manifest: baseManifest(
        [
          selectedSlot("slot-a", "ara-kara", 0, {
            reportCode: "R1",
            fightId: 1,
            reportRevision: 2,
          }),
        ],
        {
          expectedSlotCount: 1,
          selectedSlotCount: 1,
          activeDungeonSlugs: ["ara-kara"],
          contentHash: "manifest-hash-1",
        },
      ),
    });
    expect(computeUtilityV2InputFingerprint(a)).not.toBe(computeUtilityV2InputFingerprint(b));
  });

  it("does not fingerprint only event counts — equal counts different content differ", () => {
    const mk = (classification: "CONFIRMED_SUCCESS" | "VALID_OVERLAP") =>
      baseInput({
        factSets: [
          boundFact("slot-a", "ara-kara", { reportCode: "R1", fightId: 1, reportRevision: 1 }, {
            interruptAttempts: [
              {
                id: "s1",
                timestampMs: 1000,
                abilityGameId: 2139,
                sourceActorId: 10,
                sourceKind: "PLAYER",
                targetActorId: 50,
                classification,
                credit: classification === "CONFIRMED_SUCCESS" ? 1 : 0.5,
                note: "x",
              },
            ],
          }),
        ],
      });
    expect(computeUtilityV2InputFingerprint(mk("CONFIRMED_SUCCESS"))).not.toBe(
      computeUtilityV2InputFingerprint(mk("VALID_OVERLAP")),
    );
  });
});

describe("shadow payload and calibration export", () => {
  it("builds shadow DimensionComputation payload with availabilityState", () => {
    const result = computeUtilityV2(baseInput());
    const payload = toUtilityV2ShadowDimensionPayload({
      characterId: "char-1",
      seasonId: "season-1",
      manifestId: "manifest-1",
      scoreModelId: "model-1",
      result,
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(payload.dimension).toBe("UTILITY");
    expect(payload.state).toBe("SHADOW");
    expect(payload.metrics.publicationBlocked).toBe(true);
    expect(payload.metrics.availabilityState).toBe("AVAILABLE");
    expect(payload.score).toBe(50);
    expect(payload.inputFingerprint).toBe(result.inputFingerprint);
    expect(payload.explanation.publicationBlocked).toBe(true);
  });

  it("shadow payload preserves null score when UNAVAILABLE", () => {
    const result = computeUtilityV2({ ...baseInput(), factSets: [] });
    const payload = toUtilityV2ShadowDimensionPayload({
      characterId: "c",
      seasonId: "s",
      manifestId: "m",
      scoreModelId: "sm",
      result,
      computedAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    expect(payload.score).toBeNull();
    expect(payload.confidence).toBe(0);
    expect(payload.metrics.availabilityState).toBe("UNAVAILABLE");
  });

  it("exports deterministic calibration payload", () => {
    const a = exportUtilityV2Calibration(baseInput());
    const b = exportUtilityV2Calibration(baseInput());
    expect(a).toEqual(b);
    expect(a.schemaVersion).toBe("utility-v2-facts");
    expect(a.modelConfig).toEqual(UTILITY_V2_MODEL_CONFIG);
    expect(a.contributors).toEqual(a.result ? computeUtilityV2(a.input).domainBreakdown : []);
    const replay = computeUtilityV2(a.input);
    expect(replay.score).toBe(a.result.score);
    expect(replay.confidence).toBe(a.result.confidence);
    expect(replay.inputFingerprint).toBe(a.result.inputFingerprint);
  });
});

describe("spam caps", () => {
  it("caps unmatched spam so it cannot dominate credited total", () => {
    const attempts: ClassifiedInterruptAttempt[] = [
      {
        id: "s1",
        timestampMs: 1,
        abilityGameId: 1,
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 1,
        classification: "CONFIRMED_SUCCESS",
        credit: 1,
        note: "",
      },
      ...Array.from({ length: 200 }, (_, i) => ({
        id: `u${i}`,
        timestampMs: i,
        abilityGameId: 1,
        sourceActorId: 10,
        sourceKind: "PLAYER" as const,
        targetActorId: 1,
        classification: "UNMATCHED_ATTEMPT" as const,
        credit: 0.05,
        note: "",
      })),
    ];
    const capped = applyUnmatchedSpamCap(attempts);
    expect(capped.capApplied).toBe(true);
    expect(capped.unmatchedAfter).toBeLessThan(capped.unmatchedBefore);
    expect(capped.unmatchedAfter / capped.creditedTotal).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it("unmatched-only cannot produce elite domain score", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const spam = boundFact("slot-a", "ara-kara", identity, {
      hostileBegincastCount: 80,
      hostileObservability: "PRESENT",
      interruptAttempts: Array.from({ length: 400 }, (_, i) => ({
        id: `u${i}`,
        timestampMs: i * 100,
        abilityGameId: 2139,
        sourceActorId: 10,
        sourceKind: "PLAYER" as const,
        targetActorId: null,
        classification: "UNMATCHED_ATTEMPT" as const,
        credit: 0.05,
        note: "spam",
      })),
    });
    const result = computeUtilityV2({
      manifest: baseManifest([selectedSlot("slot-a", "ara-kara", 0, identity)], {
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
      }),
      factSets: [spam],
    });
    const castStops = result.domainBreakdown.find((d) => d.domain === "castStops")!;
    expect(castStops.rawScore).toBeLessThanOrEqual(UTILITY_V2_UNMATCHED_ONLY_MAX_DOMAIN_SCORE);
    expect(result.score!).toBeLessThan(80);
  });
});

describe("computeUtilityV2 safety", () => {
  it("excludes toolkit-inapplicable domains and renormalizes weights", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const fs = boundFact("slot-a", "ara-kara", identity, {
      toolkit: { hasInterrupt: true, hasSupport: false, hasStrategicCc: false },
      hostileBegincastCount: 40,
      activeCombatHours: 0.05,
      activeCombatMs: 0.05 * 3_600_000,
      interruptAttempts: [
        {
          id: "s1",
          timestampMs: 1000,
          abilityGameId: 2139,
          sourceActorId: 10,
          sourceKind: "PLAYER",
          targetActorId: 50,
          classification: "CONFIRMED_SUCCESS",
          credit: 1,
          note: "ok",
        },
      ],
    });
    const result = computeUtilityV2({
      manifest: baseManifest([selectedSlot("slot-a", "ara-kara", 0, identity)], {
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        activeDungeonSlugs: ["ara-kara"],
      }),
      factSets: [fs],
    });
    const cast = result.domainBreakdown.find((d) => d.domain === "castStops")!;
    const support = result.domainBreakdown.find((d) => d.domain === "support")!;
    const cc = result.domainBreakdown.find((d) => d.domain === "strategicCc")!;
    expect(cast.applicable).toBe(true);
    expect(support.applicable).toBe(false);
    expect(cc.applicable).toBe(false);
    expect(cast.weightShare).toBe(1);
  });

  it("never scores below neutral floor when AVAILABLE/PARTIAL", () => {
    const result = computeUtilityV2(baseInput());
    expect(result.score).toBeGreaterThanOrEqual(UTILITY_V2_SCORE_FLOOR);
    for (const d of result.domainBreakdown) {
      if (d.rawScore != null) expect(d.rawScore).toBeGreaterThanOrEqual(UTILITY_V2_SCORE_FLOOR);
      expect(d.cappedContribution).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives zero/negligible credit to passive and rotational support", () => {
    const scored = scoreSupportCredit([
      {
        id: "p1",
        timestampMs: 1,
        abilityGameId: 1,
        abilityName: "Passive Aura",
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 10,
        semantic: "PASSIVE_SUPPORT",
        tier: "CONFIRMED_IMPACT",
      },
      {
        id: "r1",
        timestampMs: 2,
        abilityGameId: 2,
        abilityName: "Rotational",
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 11,
        semantic: "ROUTINE_ROTATIONAL_SUPPORT",
        tier: "CONFIRMED_IMPACT",
      },
      {
        id: "m1",
        timestampMs: 3,
        abilityGameId: 3,
        abilityName: "Shimmer",
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 10,
        semantic: "PERSONAL_MOBILITY",
        tier: "CONFIRMED_IMPACT",
      },
      {
        id: "e1",
        timestampMs: 4,
        abilityGameId: 4,
        abilityName: "Life Cocoon",
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 11,
        semantic: "EMERGENCY_SUPPORT",
        tier: "CONFIRMED_IMPACT",
      },
    ]);
    expect(scored.bySemantic.PASSIVE_SUPPORT).toBe(0);
    expect(scored.bySemantic.PERSONAL_MOBILITY).toBe(0);
    expect(scored.bySemantic.ROUTINE_ROTATIONAL_SUPPORT).toBe(0.05);
    expect(scored.bySemantic.EMERGENCY_SUPPORT).toBe(1);
    expect(scored.passiveOrRotationalIgnored).toBe(2);
    expect(scored.rawCredit).toBeCloseTo(1.05, 5);
  });

  it("dedupes strategic CC spam on same target", () => {
    const deduped = dedupeStrategicCc([
      {
        id: "1",
        timestampMs: 1000,
        abilityGameId: 118,
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 50,
        inActiveCombat: true,
      },
      {
        id: "2",
        timestampMs: 1500,
        abilityGameId: 118,
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 50,
        inActiveCombat: true,
      },
      {
        id: "3",
        timestampMs: 10_000,
        abilityGameId: 118,
        sourceActorId: 10,
        sourceKind: "PLAYER",
        targetActorId: 50,
        inActiveCombat: true,
      },
    ]);
    expect(deduped).toHaveLength(2);
  });

  it("aggregates two-run manifest fact sets without reseeding selection", () => {
    const idA = { reportCode: "reportA", fightId: 1, reportRevision: 1 };
    const idB = { reportCode: "reportB", fightId: 2, reportRevision: 1 };
    const runA = buildUtilityV2RunFactSet({
      slotId: "slot-a",
      runId: "reportA:1",
      dungeonSlug: "ara-kara",
      slotIndex: 0,
      reportCode: idA.reportCode,
      fightId: idA.fightId,
      reportRevision: idA.reportRevision,
      fightDurationMs: 600_000,
      attemptSeeds: [attempt("a1", 2000)],
      confirmedInterrupts: [
        {
          timestampMs: 2000,
          sourceActorId: 10,
          sourceKind: "PLAYER",
          targetActorId: 50,
          abilityGameId: 2139,
          interruptedSpellId: 1,
        },
      ],
      hostileWindows: [
        {
          startMs: 1000,
          endMs: 3000,
          sourceActorId: 50,
          abilityGameId: 1,
          completed: false,
          interrupted: true,
          interruptedByActorId: 10,
          interruptedByKind: "PLAYER",
        },
      ],
      toolkit: { hasInterrupt: true, hasSupport: false, hasStrategicCc: false },
    });
    const runB = buildUtilityV2RunFactSet({
      slotId: "slot-b",
      runId: "reportB:2",
      dungeonSlug: "ara-kara",
      slotIndex: 1,
      reportCode: idB.reportCode,
      fightId: idB.fightId,
      reportRevision: idB.reportRevision,
      fightDurationMs: 600_000,
      attemptSeeds: [attempt("b1", 2000)],
      confirmedInterrupts: [
        {
          timestampMs: 2000,
          sourceActorId: 10,
          sourceKind: "PLAYER",
          targetActorId: 50,
          abilityGameId: 2139,
          interruptedSpellId: 1,
        },
      ],
      hostileWindows: [
        {
          startMs: 1000,
          endMs: 3000,
          sourceActorId: 50,
          abilityGameId: 1,
          completed: false,
          interrupted: true,
          interruptedByActorId: 10,
          interruptedByKind: "PLAYER",
        },
      ],
      toolkit: { hasInterrupt: true, hasSupport: false, hasStrategicCc: false },
    });

    const manifest = baseManifest(
      [
        selectedSlot("slot-a", "ara-kara", 0, idA),
        selectedSlot("slot-b", "ara-kara", 1, idB),
      ],
      {
        expectedSlotCount: 2,
        selectedSlotCount: 2,
        activeDungeonSlugs: ["ara-kara"],
        contentHash: "manifest-two-slot",
      },
    );

    const one = computeUtilityV2({ manifest, factSets: [runA] });
    const two = computeUtilityV2({ manifest, factSets: [runA, runB] });

    expect(two.context.runCount).toBe(2);
    expect(two.interruptCounts.CONFIRMED_SUCCESS).toBe(2);
    expect(two.availabilityState).toBe("AVAILABLE");
    expect(one.availabilityState).toBe("PARTIAL");
    expect(two.interruptCounts.creditedTotal).toBeGreaterThan(one.interruptCounts.creditedTotal);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeUtilityV2(baseInput());
    const b = computeUtilityV2(structuredClone(baseInput()));
    expect(a).toEqual(b);
    expect(a.algorithmVersion).toBe(UTILITY_V2_ALGORITHM_VERSION);
    expect(a.explanation.publicationBlocked).toBe(true);
    expect(a.explanation.domainWeights).toEqual({ ...UTILITY_V2_DOMAIN_WEIGHTS });
  });

  it("writes detailed counts/rates/caps/catalog coverage in explanation", () => {
    const result = computeUtilityV2(baseInput());
    expect(result.explanation.interruptClassification).toBeDefined();
    expect(result.explanation.caps.domainContributionCap).toBeGreaterThan(0);
    expect(result.metrics.domainBreakdown).toBeDefined();
  });
});
