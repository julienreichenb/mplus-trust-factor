/**
 * Utility recalibration — product acceptance scenarios (provider-free).
 */
import { describe, expect, it } from "vitest";
import {
  UTILITY_V2_INTERRUPT_CREDITS,
  UTILITY_V2_MODEL_CONFIG,
  computeUtilityV2,
  computeUtilityV2InputFingerprint,
  emptyUtilityV2FactSet,
  parseUtilityV2ModelConfig,
  type UtilityV2ComputeInput,
  type UtilityV2FrozenManifestRef,
  type UtilityV2RunFactSet,
} from "./index.js";
import { emptyFamilyApplicability } from "./families.js";

function selectedSlot(
  slotId: string,
  dungeonSlug: string,
  identity: { reportCode: string; fightId: number; reportRevision: number },
) {
  return {
    slotId,
    dungeonSlug,
    slotIndex: 0 as const,
    state: "SELECTED",
    identity,
  };
}

function manifestFor(
  identity: { reportCode: string; fightId: number; reportRevision: number },
): UtilityV2FrozenManifestRef {
  return {
    contentHash: "accept-manifest",
    schemaVersion: "2.0.0",
    selectorVersion: "evidence-selector-v2.0.0",
    expectedSlotCount: 1,
    selectedSlotCount: 1,
    activeDungeonSlugs: ["ara-kara"],
    slots: [selectedSlot("slot-a", "ara-kara", identity)],
  };
}

function fact(
  identity: { reportCode: string; fightId: number; reportRevision: number },
  partial: Partial<UtilityV2RunFactSet> = {},
): UtilityV2RunFactSet {
  return emptyUtilityV2FactSet({
    slotId: "slot-a",
    runId: `${identity.reportCode}:${identity.fightId}`,
    dungeonSlug: "ara-kara",
    slotIndex: 0,
    reportCode: identity.reportCode,
    fightId: identity.fightId,
    reportRevision: identity.reportRevision,
    activeCombatHours: 1,
    activeCombatMs: 3_600_000,
    fightDurationMs: 3_600_000,
    hostileBegincastCount: 80,
    hostileObservability: "PRESENT",
    ...partial,
  });
}

function inputFor(fs: UtilityV2RunFactSet): UtilityV2ComputeInput {
  const identity = {
    reportCode: fs.reportCode!,
    fightId: fs.fightId!,
    reportRevision: fs.reportRevision!,
  };
  return { manifest: manifestFor(identity), factSets: [fs] };
}

function kicks(n: number, classification: "CONFIRMED_SUCCESS" | "VALID_OVERLAP" | "MATCHED_FAILED" | "UNMATCHED_ATTEMPT" = "CONFIRMED_SUCCESS") {
  return Array.from({ length: n }, (_, i) => ({
    id: `k${i}`,
    timestampMs: i * 1000,
    abilityGameId: 2139,
    sourceActorId: 10,
    sourceKind: "PLAYER" as const,
    targetActorId: 50,
    classification,
    credit: UTILITY_V2_INTERRUPT_CREDITS[classification],
    note: "test",
  }));
}

function cc(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    timestampMs: i * 2000,
    abilityGameId: 118,
    sourceActorId: 10,
    sourceKind: "PLAYER" as const,
    targetActorId: 100 + i,
    inActiveCombat: true,
  }));
}

function support(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    timestampMs: i * 1500,
    abilityGameId: 1022,
    abilityName: "Hand of Protection",
    sourceActorId: 10,
    sourceKind: "PLAYER" as const,
    targetActorId: 11,
    semantic: "REACTIVE_SUPPORT" as const,
    tier: "CONFIRMED_IMPACT" as const,
  }));
}

describe("utility toolkit recalibration acceptance", () => {
  it("1. no-use player with applicable toolkit scores clearly below 50 and can approach 0", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const result = computeUtilityV2(inputFor(fact(identity)));
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeLessThan(50);
    expect(result.score!).toBeLessThanOrEqual(5);
    expect(result.explanation.unusedDomains.length).toBeGreaterThan(0);
  });

  it("2. strong-use player reaches 80+", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("not_applicable");
    families.interrupt = { state: "applicable" };
    families.crowdControl = { state: "applicable" };
    families.dispelPurge = { state: "applicable" };
    families.groupSupport = { state: "applicable" };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: true,
            hasStrategicCc: true,
            families,
          },
          interruptAttempts: kicks(24),
          ccActions: cc(12),
          supportActions: support(16),
          dispelPurgeSuccessCount: 16,
        }),
      ),
    );
    expect(result.score!).toBeGreaterThanOrEqual(80);
  });

  it("3. exceptional synthetic case can reach/approach 100 without cooldown-max spam", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("applicable");
    families.combatRes = { state: "optional", reason: "optional_group_expectation" };
    families.bloodlust = { state: "optional", reason: "optional_group_expectation" };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: true,
            hasStrategicCc: true,
            families,
          },
          interruptAttempts: kicks(40),
          ccActions: cc(16),
          supportActions: [
            ...support(28),
            ...Array.from({ length: 40 }, (_, i) => ({
              id: `m${i}`,
              timestampMs: i * 400,
              abilityGameId: 1953,
              abilityName: "Blink",
              sourceActorId: 10,
              sourceKind: "PLAYER" as const,
              targetActorId: 10,
              semantic: "PERSONAL_MOBILITY" as const,
              tier: "CONFIRMED_IMPACT" as const,
            })),
          ],
          dispelPurgeSuccessCount: 28,
        }),
      ),
    );
    expect(result.score!).toBeGreaterThanOrEqual(95);
  });

  it("4. limited toolkit can still score very high by using those families well", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("not_applicable");
    families.interrupt = { state: "applicable" };
    families.crowdControl = { state: "applicable" };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: false,
            hasStrategicCc: true,
            families,
          },
          interruptAttempts: kicks(30),
          ccActions: cc(16),
        }),
      ),
    );
    expect(result.score!).toBeGreaterThanOrEqual(90);
    expect(result.domainBreakdown.find((d) => d.domain === "dispelPurge")?.applicable).toBe(
      false,
    );
  });

  it("5. broad toolkit underuse scores materially lower than a smaller toolkit used well", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const limitedFamilies = emptyFamilyApplicability("not_applicable");
    limitedFamilies.interrupt = { state: "applicable" };
    limitedFamilies.crowdControl = { state: "applicable" };
    const mage = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: false,
            hasStrategicCc: true,
            families: limitedFamilies,
          },
          interruptAttempts: kicks(30),
          ccActions: cc(16),
        }),
      ),
    );

    const paladinFamilies = emptyFamilyApplicability("not_applicable");
    paladinFamilies.interrupt = { state: "applicable" };
    paladinFamilies.crowdControl = { state: "applicable" };
    paladinFamilies.dispelPurge = { state: "applicable" };
    paladinFamilies.groupSupport = { state: "applicable" };
    paladinFamilies.combatRes = { state: "optional", reason: "optional_group_expectation" };
    const paladin = computeUtilityV2(
      inputFor(
        fact(
          { reportCode: "R2", fightId: 1, reportRevision: 1 },
          {
            toolkit: {
              hasInterrupt: true,
              hasSupport: true,
              hasStrategicCc: true,
              families: paladinFamilies,
            },
            dispelPurgeSuccessCount: 20,
          },
        ),
      ),
    );

    expect(mage.score!).toBeGreaterThan(paladin.score! + 25);
    expect(paladin.score!).toBeLessThan(50);
  });

  it("6. confirmed interrupt is full credit; legitimate non-landed attempt is only slightly lower", () => {
    expect(UTILITY_V2_INTERRUPT_CREDITS.VALID_OVERLAP).toBeGreaterThanOrEqual(0.85);
    expect(UTILITY_V2_INTERRUPT_CREDITS.MATCHED_FAILED).toBeGreaterThanOrEqual(0.75);
    expect(UTILITY_V2_INTERRUPT_CREDITS.CONFIRMED_SUCCESS).toBe(1);
    expect(
      UTILITY_V2_INTERRUPT_CREDITS.CONFIRMED_SUCCESS -
        UTILITY_V2_INTERRUPT_CREDITS.VALID_OVERLAP,
    ).toBeLessThanOrEqual(0.15);
  });

  it("7. duplicate unmatched attempts cannot trivially saturate Interrupt", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("not_applicable");
    families.interrupt = { state: "applicable" };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: false,
            hasStrategicCc: false,
            families,
          },
          interruptAttempts: [
            ...kicks(2, "CONFIRMED_SUCCESS"),
            ...kicks(400, "UNMATCHED_ATTEMPT"),
          ],
        }),
      ),
    );
    const interrupt = result.domainBreakdown.find((d) => d.domain === "interrupt")!;
    expect(result.interruptCounts.unmatchedCapApplied).toBe(true);
    expect(interrupt.rawScore!).toBeLessThan(90);
  });

  it("8. absent category for spec does not depress score", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("not_applicable");
    families.interrupt = { state: "applicable" };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: false,
            hasStrategicCc: false,
            families,
          },
          interruptAttempts: kicks(30),
        }),
      ),
    );
    expect(result.domainBreakdown.find((d) => d.domain === "dispelPurge")?.applicable).toBe(
      false,
    );
    expect(result.score!).toBeGreaterThanOrEqual(90);
  });

  it("9. missing talent info does not silently become unused-toolkit zero", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const families = emptyFamilyApplicability("uncertain", "talent_data_unavailable");
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          toolkit: {
            hasInterrupt: true,
            hasSupport: true,
            hasStrategicCc: true,
            families,
          },
          limitations: ["talent_data_unavailable"],
        }),
      ),
    );
    expect(result.score).toBeNull();
    expect(result.explanation.uncertainDomains.length).toBeGreaterThan(0);
    expect(result.explanation.confidenceReasons).toContain("applicability_uncertain");
  });

  it("10. provider-free replay is deterministic for frozen inputs/config", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const payload = inputFor(fact(identity, { interruptAttempts: kicks(8) }));
    const a = computeUtilityV2(payload);
    const b = computeUtilityV2(structuredClone(payload));
    expect(a).toEqual(b);
    expect(a.inputFingerprint).toBe(computeUtilityV2InputFingerprint(payload));
  });

  it("11. DRAFT Utility coefficient override changes replay without activation", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const payload = inputFor(fact(identity, { interruptAttempts: kicks(8) }));
    const baseline = computeUtilityV2(payload);
    const draft = parseUtilityV2ModelConfig({
      ...UTILITY_V2_MODEL_CONFIG,
      interruptCredits: {
        ...UTILITY_V2_MODEL_CONFIG.interruptCredits,
        CONFIRMED_SUCCESS: 0.2,
      },
    });
    const overridden = computeUtilityV2(payload, { modelConfig: draft });
    expect(overridden.score).not.toBe(baseline.score);
    expect(overridden.modelConfigFingerprint).not.toBe(baseline.modelConfigFingerprint);
    expect(overridden.inputFingerprint).not.toBe(baseline.inputFingerprint);
  });

  it("12. explanation matches family scores and does not treat confidence gaps as weaknesses", () => {
    const identity = { reportCode: "R1", fightId: 1, reportRevision: 1 };
    const result = computeUtilityV2(
      inputFor(
        fact(identity, {
          interruptAttempts: kicks(10),
          limitations: ["talent_data_unavailable"],
        }),
      ),
    );
    expect(result.explanation.applicableDomains).toContain("interrupt");
    expect(result.explanation.familyWeights.interrupt).toBeGreaterThan(0);
    expect(result.explanation.interruptCredits.CONFIRMED_SUCCESS).toBe(1);
    const interrupt = result.domainBreakdown.find((d) => d.domain === "interrupt")!;
    expect(interrupt.rawScore).not.toBeNull();
    expect(result.explanation.confidenceReasons).not.toContain("zero_attributable_events");
  });
});
