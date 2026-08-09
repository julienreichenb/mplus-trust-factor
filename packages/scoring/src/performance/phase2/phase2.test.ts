/**
 * Functional Performance Phase 2 specification tests (I–S).
 */
import { describe, expect, it } from "vitest";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import { projectOffensiveActivations } from "@mplus/abilities";
import { dimensionTagsForRule, getAllRegisteredRules } from "@mplus/abilities";
import {
  computeEndGraceMs,
  computeExpectedUses,
  usageRatioToScore,
  computeOffensiveCooldownDiscipline,
  computePerformancePhase2,
  combinePerformancePhase2Scores,
  resolveEligibleOffensiveCooldowns,
  scoreRunCooldownDiscipline,
  PERFORMANCE_PHASE2_ALGORITHM_VERSION,
  type PerformanceCooldownRunEvidence,
} from "./index.js";
import type {
  PerformanceRunParseFactV2,
  PerformanceV2ComputeInput,
  SeasonDifficultyPolicyV2,
} from "../v2/types.js";

const POLICY: SeasonDifficultyPolicyV2 = {
  id: "policy-manual-s1",
  seasonId: "season-1",
  region: "eu",
  role: "dps",
  specSlug: "fire",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  k50: 8,
  k90: 12,
  k99: 15,
  source: "MANUAL",
  sampleSize: 1000,
  confidence: 0.8,
  version: "sdp-v1",
};

const ACTIVE = [
  "dungeon-a",
  "dungeon-b",
  "dungeon-c",
  "dungeon-d",
  "dungeon-e",
  "dungeon-f",
  "dungeon-g",
  "dungeon-h",
];

function fact(
  overrides: Partial<PerformanceRunParseFactV2> &
    Pick<PerformanceRunParseFactV2, "slotId" | "dungeonSlug" | "keyLevel">,
): PerformanceRunParseFactV2 {
  return {
    parsePercentile: 70,
    semantic: "BRACKET_PERCENT",
    partition: 1,
    rawDps: 500_000,
    reportCode: "AbCdEfGh",
    fightId: 1,
    reportRevision: 1,
    ...overrides,
  };
}

function phase1Input(
  overrides: Partial<PerformanceV2ComputeInput> = {},
): PerformanceV2ComputeInput {
  return {
    manifest: {
      contentHash: "manifest-hash-1",
      schemaVersion: "2.0.0",
      selectorVersion: "evidence-selector-v2.0.0",
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "season-slug-1",
      specSlug: "fire",
      role: "DPS",
      highKeyPolicyId: "hk-1",
      activeDungeonSlugs: ACTIVE,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      evidenceCutoffAt: "2026-08-01T00:00:00.000Z",
    },
    runParseFacts: ACTIVE.flatMap((slug, di) => [
      fact({
        slotId: `${slug}:0`,
        dungeonSlug: slug,
        keyLevel: 12,
        parsePercentile: 80,
        fightId: di * 2 + 1,
      }),
      fact({
        slotId: `${slug}:1`,
        dungeonSlug: slug,
        keyLevel: 11,
        parsePercentile: 75,
        fightId: di * 2 + 2,
      }),
    ]),
    profileAggregate: {
      bestDpsPercentileAverage: 72,
      medianDpsPercentileAverage: 65,
      perDungeon: ACTIVE.map((slug) => ({
        dungeonSlug: slug,
        bestParsePercentile: 72,
        medianParsePercentile: 65,
        loggedRunCount: 4,
      })),
      partition: 1,
      zoneId: 42,
      totalLoggedRuns: 40,
      latestObservedAt: null,
    },
    difficultyPolicy: POLICY,
    expectedPartition: 1,
    logFreshness: 0.9,
    computedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function cooldownRun(
  overrides: Partial<PerformanceCooldownRunEvidence> &
    Pick<PerformanceCooldownRunEvidence, "slotId">,
): PerformanceCooldownRunEvidence {
  return {
    reportCode: "AbCdEfGh",
    fightId: 1,
    reportRevision: 1,
    participantActorId: 10,
    classSlug: "mage",
    specSlug: "fire",
    catalogVersion: CURRENT_CATALOG_VERSION_ID,
    activeCombatDurationMs: 180_000,
    offensiveActivations: [
      {
        activationId: "a1",
        canonicalKey: "mage.offensive.combustion",
        primarySpellId: 190319,
        timestampMs: 1000,
        rawMatchedEventCount: 1,
        contributingSpellIds: [190319],
        observedSpellIds: [190319],
      },
      {
        activationId: "a2",
        canonicalKey: "mage.offensive.combustion",
        primarySpellId: 190319,
        timestampMs: 70_000,
        rawMatchedEventCount: 1,
        contributingSpellIds: [190319],
        observedSpellIds: [190319],
      },
      {
        activationId: "a3",
        canonicalKey: "mage.offensive.combustion",
        primarySpellId: 190319,
        timestampMs: 130_000,
        rawMatchedEventCount: 1,
        contributingSpellIds: [190319],
        observedSpellIds: [190319],
      },
    ],
    ...overrides,
  };
}

describe("Performance Phase 2 expected uses (I–L)", () => {
  it("I — 180s duration / 60s cooldown → 3 expected uses", () => {
    const expected = computeExpectedUses({
      activeCombatDurationMs: 180_000,
      effectiveCooldownMs: 60_000,
    });
    expect(computeEndGraceMs(60_000)).toBe(15_000);
    expect(expected).toBe(3);
  });

  it("J — usage ratios convert to scores with cap at 100", () => {
    expect(usageRatioToScore(3, 3)).toBe(100);
    expect(usageRatioToScore(2, 3)).toBeCloseTo((2 / 3) * 100, 10);
    expect(usageRatioToScore(4, 3)).toBe(100);
  });

  it("K — end grace does not add another expected use", () => {
    // duration such that (duration - grace) / cd has no extra full window
    // 60s cd, grace 15s → need duration < 75s for expected = 1 only after initial
    // expected = 1 + floor((d - 15s)/60s); for d=74s → floor(59/60)=0 → 1
    expect(
      computeExpectedUses({
        activeCombatDurationMs: 74_000,
        effectiveCooldownMs: 60_000,
      }),
    ).toBe(1);
    // At exactly 75s: floor(60/60)=1 → 2
    expect(
      computeExpectedUses({
        activeCombatDurationMs: 75_000,
        effectiveCooldownMs: 60_000,
      }),
    ).toBe(2);
  });

  it("K2 — exact grace boundaries around cooldown + grace", () => {
    const cd = 60_000;
    const grace = computeEndGraceMs(cd); // 15_000
    expect(grace).toBe(15_000);
    // duration = cd + grace - 1 → still one expected use
    expect(
      computeExpectedUses({
        activeCombatDurationMs: cd + grace - 1,
        effectiveCooldownMs: cd,
      }),
    ).toBe(1);
    // duration = cd + grace → second use becomes available exactly at boundary
    expect(
      computeExpectedUses({
        activeCombatDurationMs: cd + grace,
        effectiveCooldownMs: cd,
      }),
    ).toBe(2);
    // duration = cd + grace + 1 → still two
    expect(
      computeExpectedUses({
        activeCombatDurationMs: cd + grace + 1,
        effectiveCooldownMs: cd,
      }),
    ).toBe(2);
  });

  it("L — very short run still expects the initially available use", () => {
    expect(
      computeExpectedUses({
        activeCombatDurationMs: 5_000,
        effectiveCooldownMs: 120_000,
      }),
    ).toBe(1);
  });

  it("charges — explicit multi-charge pool raises initial expected uses", () => {
    // 2 charges, 90s CD, 180s run, grace=min(30s, 22.5s)=22.5s
    // expected = 2 + floor((180000-22500)/90000) = 2 + 1 = 3
    expect(
      computeExpectedUses({
        activeCombatDurationMs: 180_000,
        effectiveCooldownMs: 90_000,
        charges: 2,
      }),
    ).toBe(3);
    // charges ≤ 1 behaves like the default initial pool of 1
    expect(
      computeExpectedUses({
        activeCombatDurationMs: 180_000,
        effectiveCooldownMs: 60_000,
        charges: 1,
      }),
    ).toBe(3);
  });
});

describe("Performance Phase 2 activation / eligibility (M–O)", () => {
  it("M — cast + buff projection counts as one activation (digest input)", () => {
    const combustion = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "mage.offensive.combustion",
    )!;
    expect(
      dimensionTagsForRule(combustion).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
    ).toBe(true);
    const projection = projectOffensiveActivations({
      rules: [combustion],
      events: [
        {
          eventId: "e1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 190319,
          canonicalKey: combustion.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "e2",
          timestampMs: 1050,
          eventType: "applybuff",
          spellId: 190319,
          canonicalKey: combustion.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("N — unsupported / talent ability is omitted, not scored zero", () => {
    const result = computeOffensiveCooldownDiscipline([
      cooldownRun({
        slotId: "s0",
        // Fire mage baseline abilities only; talent shifting-power must be skipped
        offensiveActivations: [],
      }),
    ]);
    expect(result.unsupportedAbilityIds.length).toBeGreaterThan(0);
    // Evaluated abilities with 0 observed still score 0 — but talent keys are unsupported
    expect(
      result.unsupportedAbilityIds.some((id) => id.includes("shifting-power")),
    ).toBe(true);
    const evaluatedKeys = result.runScores[0]!.evaluatedAbilities.map(
      (a) => a.canonicalKey,
    );
    expect(evaluatedKeys).not.toContain("mage.offensive.shifting-power");
  });

  it("N2 — shared racial cooldowns are skipped without race evidence (no zero penalty)", () => {
    const { eligible, skipped } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: "fire",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    });
    expect(
      eligible.some((e) => e.rule.canonicalKey.includes("racial")),
    ).toBe(false);
    expect(
      skipped.some(
        (s) =>
          s.canonicalKey.includes("racial") &&
          s.reason === "talent_availability_unknown",
      ),
    ).toBe(true);
    // Other-class abilities must not pollute skip diagnostics
    expect(
      skipped.some((s) => s.canonicalKey.startsWith("warlock.")),
    ).toBe(false);
  });

  it("N2b — observed use unlocks talent cooldown without loadout", () => {
    const shifting = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "mage.offensive.shifting-power",
    )!;
    const spellId = shifting.spellIds[0]!;
    const { eligible, skipped } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: "fire",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      availabilityEvidence: {
        loadoutEvidenceState: "ABSENT",
        loadoutTalentSpellIds: null,
        observedCanonicalKeys: new Set(["mage.offensive.shifting-power"]),
        observedSpellIds: new Set([spellId]),
        ownedPetActorIds: [],
      },
    });
    expect(
      eligible.some((e) => e.rule.canonicalKey === "mage.offensive.shifting-power"),
    ).toBe(true);
    expect(
      skipped.some((s) => s.canonicalKey === "mage.offensive.shifting-power"),
    ).toBe(false);
  });

  it("N2c — loadout PRESENT with empty spell IDs stays unresolved (node-only)", () => {
    const { skipped } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: "fire",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      availabilityEvidence: {
        loadoutEvidenceState: "PRESENT",
        loadoutTalentSpellIds: new Set(), // node IDs only — cannot spell-match
        observedCanonicalKeys: new Set(),
        observedSpellIds: new Set(),
        ownedPetActorIds: [],
      },
    });
    expect(
      skipped.some(
        (s) =>
          s.canonicalKey === "mage.offensive.shifting-power" &&
          s.reason === "talent_availability_unknown",
      ),
    ).toBe(true);
  });

  it("N2c2 — loadout PRESENT with unrelated spell IDs skips as conditional_not_selected", () => {
    const { skipped } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: "fire",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      availabilityEvidence: {
        loadoutEvidenceState: "PRESENT",
        loadoutTalentSpellIds: new Set([1]), // unrelated spell
        observedCanonicalKeys: new Set(),
        observedSpellIds: new Set(),
        ownedPetActorIds: [],
      },
    });
    expect(
      skipped.some(
        (s) =>
          s.canonicalKey === "mage.offensive.shifting-power" &&
          s.reason === "conditional_not_selected",
      ),
    ).toBe(true);
  });

  it("N2d — loadout PRESENT with talent spell unlocks shifting-power", () => {
    const shifting = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "mage.offensive.shifting-power",
    )!;
    const spellId = shifting.spellIds[0]!;
    const { eligible } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: "fire",
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      availabilityEvidence: {
        loadoutEvidenceState: "PRESENT",
        loadoutTalentSpellIds: new Set([spellId]),
        observedCanonicalKeys: new Set(),
        observedSpellIds: new Set(),
        ownedPetActorIds: [],
      },
    });
    const entry = eligible.find(
      (e) => e.rule.canonicalKey === "mage.offensive.shifting-power",
    );
    expect(entry?.availabilityReason).toBe("loadout_selected");
  });

  it("N2e — run diagnostics expose availability, expected, observed, contribution", () => {
    const result = scoreRunCooldownDiscipline(
      cooldownRun({
        slotId: "s0",
        activeCombatMethod: "hostile_cast_activity",
      }),
    );
    expect(result.activeCombatMethod).toBe("hostile_cast_activity");
    expect(result.evaluatedAbilities.length).toBeGreaterThan(0);
    for (const a of result.evaluatedAbilities) {
      expect(a.canonicalKey.length).toBeGreaterThan(0);
      expect(a.availabilityReason).toBeTruthy();
      expect(a.cooldownSeconds).toBeGreaterThan(0);
      expect(typeof a.observedActivationCount).toBe("number");
      expect(a.expectedUses).toBeGreaterThan(0);
      expect(typeof a.contribution).toBe("number");
    }
  });

  it("N3 — unknown spec skips spec-gated rules (no all-spec fail-open)", () => {
    const { eligible, skipped } = resolveEligibleOffensiveCooldowns({
      classSlug: "mage",
      specSlug: null,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    });
    expect(eligible.some((e) => e.rule.canonicalKey.includes("combustion"))).toBe(
      false,
    );
    expect(eligible.some((e) => e.rule.canonicalKey.includes("arcane-surge"))).toBe(
      false,
    );
    expect(eligible.some((e) => e.rule.canonicalKey.includes("icy-veins"))).toBe(
      false,
    );
    expect(
      skipped.some(
        (s) =>
          s.canonicalKey.includes("combustion") && s.reason === "spec_mismatch",
      ),
    ).toBe(true);
  });

  it("O — invalid duration omits run from cooldown discipline", () => {
    const result = computeOffensiveCooldownDiscipline([
      cooldownRun({
        slotId: "s0",
        activeCombatDurationMs: null,
      }),
      cooldownRun({
        slotId: "s1",
        fightId: 2,
        activeCombatDurationMs: 180_000,
      }),
    ]);
    expect(result.runsWithoutValidDuration).toEqual(["s0"]);
    expect(result.cooldownUsableRunCount).toBe(1);
  });
});

describe("Performance Phase 2 character combine (P–S)", () => {
  it("P — character cooldown discipline equals mean of usable run scores", () => {
    const a = computeOffensiveCooldownDiscipline([
      cooldownRun({ slotId: "s0", fightId: 1 }),
    ]);
    const b = computeOffensiveCooldownDiscipline([
      cooldownRun({
        slotId: "s1",
        fightId: 2,
        offensiveActivations: [
          {
            activationId: "x1",
            canonicalKey: "mage.offensive.combustion",
            primarySpellId: 190319,
            timestampMs: 1000,
            rawMatchedEventCount: 1,
            contributingSpellIds: [190319],
        observedSpellIds: [190319],
          },
        ],
      }),
    ]);
    const both = computeOffensiveCooldownDiscipline([
      cooldownRun({ slotId: "s0", fightId: 1 }),
      cooldownRun({
        slotId: "s1",
        fightId: 2,
        offensiveActivations: [
          {
            activationId: "x1",
            canonicalKey: "mage.offensive.combustion",
            primarySpellId: 190319,
            timestampMs: 1000,
            rawMatchedEventCount: 1,
            contributingSpellIds: [190319],
        observedSpellIds: [190319],
          },
        ],
      }),
    ]);
    expect(a.score).not.toBeNull();
    expect(b.score).not.toBeNull();
    expect(both.score).toBeCloseTo((a.score! + b.score!) / 2, 10);
  });

  it("Q — no cooldown evidence → Phase 1 score with PARTIAL", () => {
    const result = computePerformancePhase2({
      phase1: phase1Input(),
      cooldownRuns: [
        cooldownRun({
          slotId: "s0",
          activeCombatDurationMs: null,
        }),
      ],
    });
    expect(result.phase1Score).not.toBeNull();
    expect(result.offensiveCooldownDiscipline).toBeNull();
    expect(result.score).toBe(result.phase1Score);
    expect(result.weightsApplied).toEqual({ phase1: 1, cooldown: 0 });
    expect(result.state).toBe("PARTIAL");
  });

  it("R — Phase1 80 + cooldown 50 → Performance Phase 2 score 74", () => {
    const combined = combinePerformancePhase2Scores({
      phase1Score: 80,
      cooldownScore: 50,
    });
    expect(combined.score).toBe(74);
    expect(combined.weightsApplied).toEqual({ phase1: 0.8, cooldown: 0.2 });
    expect(combined.state).toBe("AVAILABLE");

    const live = computePerformancePhase2({
      phase1: phase1Input(),
      cooldownRuns: [cooldownRun({ slotId: "s0" })],
    });
    expect(live.phase1Score).not.toBeNull();
    expect(live.offensiveCooldownDiscipline).not.toBeNull();
    expect(live.weightsApplied).toEqual({ phase1: 0.8, cooldown: 0.2 });
    expect(live.score).toBeCloseTo(
      live.phase1Score! * 0.8 + live.offensiveCooldownDiscipline! * 0.2,
      10,
    );
    expect(live.calculatorVersion).toBe(PERFORMANCE_PHASE2_ALGORITHM_VERSION);
    expect(live.explanation.phase3State).toBe("DEFERRED_CRITICAL_MASS");
  });

  it("S — cooldown alone cannot produce available Performance", () => {
    const result = computePerformancePhase2({
      phase1: phase1Input({
        runParseFacts: [],
        profileAggregate: null,
      }),
      cooldownRuns: [cooldownRun({ slotId: "s0" })],
    });
    expect(result.phase1Score).toBeNull();
    expect(result.offensiveCooldownDiscipline).not.toBeNull();
    expect(result.score).toBeNull();
    expect(result.state).toBe("UNAVAILABLE");
    expect(result.limitations).toContain("phase1_unavailable");
  });
});
