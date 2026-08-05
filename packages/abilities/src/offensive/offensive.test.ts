import { describe, expect, it } from "vitest";
import { dimensionTagsForRule } from "../catalog/rule.js";
import {
  classifyActivationSignal,
  projectOffensiveActivations,
} from "../offensive/activation.js";
import { buildOffensiveCandidateCatalog } from "../offensive/build.js";
import { buildOffensiveCoverageMatrix } from "../offensive/coverage.js";
import { validateOffensiveCatalog } from "../offensive/validate.js";
import { getAllRegisteredRules } from "../registry.js";

function offensiveRules() {
  return getAllRegisteredRules().filter((r) =>
    dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
  );
}

describe("offensive activation projection", () => {
  const tyrant = offensiveRules().find(
    (r) => r.canonicalKey === "warlock.offensive.demonic-tyrant",
  )!;

  it("dedups begincast + cast into one activation", () => {
    const projection = projectOffensiveActivations({
      rules: [tyrant],
      events: [
        {
          eventId: "e1",
          timestampMs: 1000,
          eventType: "begincast",
          spellId: 265187,
          canonicalKey: tyrant.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "e2",
          timestampMs: 1200,
          eventType: "cast",
          spellId: 265187,
          canonicalKey: tyrant.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.rawRetainedEventCount).toBe(2);
    expect(projection.deduplicatedActivationCount).toBe(1);
    expect(projection.canonicalCooldownCount).toBe(1);
    expect(projection.activations[0]?.timestampMs).toBe(1200);
    expect(projection.activations[0]?.contributingEventIds).toEqual(["e1", "e2"]);
  });

  it("dedups cast + applybuff into one activation", () => {
    const pillar = offensiveRules().find(
      (r) => r.canonicalKey === "death-knight.offensive.pillar-of-frost",
    )!;
    const projection = projectOffensiveActivations({
      rules: [pillar],
      events: [
        {
          eventId: "e1",
          timestampMs: 2000,
          eventType: "cast",
          spellId: 51271,
          canonicalKey: pillar.canonicalKey,
          sourceOwnerPlayerActorId: 11,
          sourceActorId: 11,
        },
        {
          eventId: "e2",
          timestampMs: 2050,
          eventType: "applybuff",
          spellId: 51271,
          canonicalKey: pillar.canonicalKey,
          sourceOwnerPlayerActorId: 11,
          sourceActorId: 11,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("does not count refreshbuff/removebuff as extra uses", () => {
    const sef = offensiveRules().find(
      (r) => r.canonicalKey === "monk.offensive.storm-earth-and-fire",
    )!;
    const projection = projectOffensiveActivations({
      rules: [sef],
      events: [
        {
          eventId: "e1",
          timestampMs: 3000,
          eventType: "applybuff",
          spellId: 137639,
          canonicalKey: sef.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
        },
        {
          eventId: "e2",
          timestampMs: 4000,
          eventType: "refreshbuff",
          spellId: 137639,
          canonicalKey: sef.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
        },
        {
          eventId: "e3",
          timestampMs: 5000,
          eventType: "removebuff",
          spellId: 137639,
          canonicalKey: sef.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
        },
      ],
    });
    expect(projection.rawRetainedEventCount).toBe(3);
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("attributes triggered child spell IDs to the parent activation", () => {
    const parent = {
      ...tyrant,
      triggeredEffectIds: [999001],
    };
    const projection = projectOffensiveActivations({
      rules: [parent],
      events: [
        {
          eventId: "e1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 265187,
          canonicalKey: parent.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "e2",
          timestampMs: 1100,
          eventType: "cast",
          spellId: 999001,
          canonicalKey: parent.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 20,
          sourceKind: "OWNED_PET_OR_GUARDIAN",
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
    expect(projection.activations[0]?.contributingSpellIds).toEqual([265187, 999001]);
  });

  it("does not open activations from orphan triggered child events", () => {
    const parent = {
      ...tyrant,
      triggeredEffectIds: [999001],
    };
    const projection = projectOffensiveActivations({
      rules: [parent],
      events: [
        {
          eventId: "e1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 999001,
          canonicalKey: parent.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 20,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(0);
  });

  it("attributes pet casts via owning player and retains external recipient", () => {
    const pi = getAllRegisteredRules().find(
      (r) => r.canonicalKey === "priest.group-utility.power-infusion",
    )!;
    const projection = projectOffensiveActivations({
      rules: [pi],
      events: [
        {
          eventId: "e1",
          timestampMs: 8000,
          eventType: "cast",
          spellId: 10060,
          canonicalKey: pi.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
          targetPlayerActorId: 10,
        },
      ],
    });
    expect(projection.activations[0]?.sourceOwnerPlayerActorId).toBe(12);
    expect(projection.activations[0]?.targetPlayerActorId).toBe(10);
  });

  it("merges empowerstart + cast + empowerend into one empowered activation", () => {
    const fireBreath = offensiveRules().find(
      (r) => r.canonicalKey === "evoker.offensive.fire-breath",
    )!;
    const projection = projectOffensiveActivations({
      rules: [fireBreath],
      events: [
        {
          eventId: "e1",
          timestampMs: 10_000,
          eventType: "applybuff",
          spellId: 357208,
          canonicalKey: fireBreath.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
          dataset: "Buffs",
        },
        {
          eventId: "e2",
          timestampMs: 10_001,
          eventType: "empowerstart",
          spellId: 357208,
          canonicalKey: fireBreath.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
          dataset: "Casts",
        },
        {
          eventId: "e3",
          timestampMs: 10_003,
          eventType: "cast",
          spellId: 357208,
          canonicalKey: fireBreath.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
          dataset: "Casts",
        },
        {
          eventId: "e4",
          timestampMs: 11_540,
          eventType: "empowerend",
          spellId: 357208,
          canonicalKey: fireBreath.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
          dataset: "Casts",
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
    expect(projection.activations[0]?.timestampMs).toBe(11_540);
    expect(projection.activations[0]?.contributingEventIds).toHaveLength(4);
  });

  it("collapses Abomination Limb pulse casts into one activation per effect window", () => {
    const limb = offensiveRules().find(
      (r) => r.canonicalKey === "death-knight.offensive.abomination-limb",
    )!;
    // Anonymized reduced sample from fight 1WKcCz2BnAQmbhfq / Missmygrip.
    const pulseTs = [
      363_044, 364_703, 366_275, 367_878, 370_232, 373_337, 374_861, 378_179,
      380_626, 384_217,
    ];
    const secondUseTs = [761_247, 764_364, 766_275];
    const projection = projectOffensiveActivations({
      rules: [limb],
      events: [...pulseTs, ...secondUseTs].map((timestampMs, index) => ({
        eventId: `limb-${index}`,
        timestampMs,
        eventType: "cast",
        spellId: 383269,
        canonicalKey: limb.canonicalKey,
        sourceOwnerPlayerActorId: 39,
        sourceActorId: 39,
        dataset: "Casts" as const,
      })),
    });
    expect(limb.activationEffectDurationMs).toBe(30_000);
    expect(projection.deduplicatedActivationCount).toBe(2);
  });

  it("keeps two genuine uses separated in time as two activations", () => {
    const tip = offensiveRules().find(
      (r) => r.canonicalKey === "evoker.offensive.tip-the-scales",
    )!;
    const projection = projectOffensiveActivations({
      rules: [tip],
      events: [
        {
          eventId: "e1",
          timestampMs: 100_000,
          eventType: "cast",
          spellId: 370553,
          canonicalKey: tip.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
        },
        {
          eventId: "e2",
          timestampMs: 100_020,
          eventType: "applybuff",
          spellId: 370553,
          canonicalKey: tip.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
        },
        {
          eventId: "e3",
          timestampMs: 250_000,
          eventType: "cast",
          spellId: 370553,
          canonicalKey: tip.canonicalKey,
          sourceOwnerPlayerActorId: 1,
          sourceActorId: 1,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(2);
  });

  it("classifies cast-primary vs buff-primary opening signals", () => {
    const limb = offensiveRules().find(
      (r) => r.canonicalKey === "death-knight.offensive.abomination-limb",
    )!;
    const sef = offensiveRules().find(
      (r) => r.canonicalKey === "monk.offensive.storm-earth-and-fire",
    )!;
    expect(
      classifyActivationSignal({
        rule: limb,
        eventType: "cast",
        spellId: 383269,
      }),
    ).toBe("OPEN");
    expect(
      classifyActivationSignal({
        rule: limb,
        eventType: "applybuff",
        spellId: 383269,
      }),
    ).toBe("CORRELATE");
    expect(
      classifyActivationSignal({
        rule: sef,
        eventType: "applybuff",
        spellId: 137639,
      }),
    ).toBe("OPEN");
    expect(
      classifyActivationSignal({
        rule: sef,
        eventType: "refreshbuff",
        spellId: 137639,
      }),
    ).toBe("CORRELATE");
  });
});

describe("offensive catalog builder + validator", () => {
  it("builds deterministic candidates without inventing reviewed overwrites", async () => {
    const a = await buildOffensiveCandidateCatalog({
      nowIso: "2026-08-05T12:00:00.000Z",
    });
    const b = await buildOffensiveCandidateCatalog({
      nowIso: "2026-08-05T12:00:00.000Z",
    });
    expect(a.catalog.candidates.map((c) => c.proposedCanonicalKey)).toEqual(
      b.catalog.candidates.map((c) => c.proposedCanonicalKey),
    );
    expect(a.review.notes.some((n) => n.includes("never overwritten"))).toBe(true);
    expect(a.catalog.stats.matchedReviewedCount).toBeGreaterThan(0);
  });

  it("requires reviewed offensive coverage for every Blizzard playable specialization", () => {
    const report = validateOffensiveCatalog({ nowIso: "2026-08-05T12:00:00.000Z" });
    expect(report.valid).toBe(true);
    expect(report.totals.uncoveredSpecializations).toBe(0);
    expect(report.totals.playableClasses).toBe(13);
    expect(report.totals.playableSpecializations).toBe(40);
    expect(report.totals.coveredSpecializations + report.totals.exemptSpecializations).toBe(40);
    expect(report.scopes.sameFightObservedValidation.partyClassSlugs).toHaveLength(5);
    expect(report.scopes.classesSpecsNotInFivePlayerTestParty.length).toBeGreaterThan(5);
    expect(
      offensiveRules().every((r) =>
        dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
      ),
    ).toBe(true);
  });

  it("builds a coverage matrix with Blizzard IDs for every Retail specialization", () => {
    const matrix = buildOffensiveCoverageMatrix({ nowIso: "2026-08-05T12:00:00.000Z" });
    expect(matrix.specs).toHaveLength(40);
    expect(matrix.specs.every((s) => s.blizzardClassId > 0 && s.blizzardSpecId > 0)).toBe(true);
    expect(matrix.totals.uncoveredSpecializations).toBe(0);
    const devourer = matrix.specs.find((s) => s.classSlug === "demon-hunter" && s.specSlug === "devourer");
    expect(devourer?.coverageStatus).toBe("COVERED");
    expect(devourer?.exemptionStatus).toBe("NONE");
    const restoShaman = matrix.specs.find((s) => s.classSlug === "shaman" && s.specSlug === "restoration");
    expect(restoShaman?.coverageStatus).toBe("EXEMPT");
  });

  it("fails when a reviewed offensive entry has no activation signal", () => {
    const seed = offensiveRules()[0]!;
    const broken = {
      ...seed,
      canonicalKey: "test.offensive.broken",
      spellIds: [],
      aliases: undefined,
      activationSpellIds: [],
      activationBuffIds: [],
    };
    const report = validateOffensiveCatalog({
      rules: [...offensiveRules(), broken],
    });
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "OFFENSIVE_MISSING_ACTIVATION")).toBe(true);
  });
});
