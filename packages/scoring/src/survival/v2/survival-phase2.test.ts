/**
 * Survival V2 Phase 2 — contextual defensive / recovery / availability tests.
 */
import { describe, expect, it } from "vitest";
import {
  SURVIVAL_V2_PHASE2,
  classifyDefensiveResponse,
  classifyRecoveryResponse,
  scoreDefensiveResponseClass,
  scoreRecoveryResponseClass,
  scoreSurvivalV2Defensive,
  scoreSurvivalV2EmergencyRecovery,
  scoreSurvivalV2Outcome,
  toolAvailabilityAt,
  type SurvivalV2CatalogTool,
  type SurvivalFactDocumentV2,
  scoreSurvivalV2Run,
} from "./index.js";

const baselineTool = (
  overrides: Partial<SurvivalV2CatalogTool> = {},
): SurvivalV2CatalogTool => ({
  spellId: 104773,
  category: "DEFENSIVE_MAJOR",
  cooldownMs: 180_000,
  charges: 1,
  availability: "BASELINE",
  canonicalKey: "warlock.defensive.unending-resolve",
  ...overrides,
});

describe("Survival Phase 2 defensive classification ordering", () => {
  it("scores anticipated > reactive > no response with available tool", () => {
    const anticipated = scoreDefensiveResponseClass("ANTICIPATED")!;
    const reactive = scoreDefensiveResponseClass("REACTIVE")!;
    const noResponse = scoreDefensiveResponseClass("NO_RESPONSE_AVAILABLE")!;
    expect(anticipated).toBeGreaterThan(reactive);
    expect(reactive).toBeGreaterThan(noResponse);
    expect(scoreDefensiveResponseClass("NO_TOOL_AVAILABLE")).toBeNull();
    expect(scoreDefensiveResponseClass("NOT_OBSERVABLE")).toBeNull();
  });

  it("classifies before-damage as anticipated and after-start as reactive", () => {
    expect(
      classifyDefensiveResponse({
        defensivesBefore: ["a1"],
        defensivesDuring: [],
        timingObservable: true,
        tools: [baselineTool()],
        activations: [],
        dangerStartMs: 10_000,
      }),
    ).toBe("ANTICIPATED");
    expect(
      classifyDefensiveResponse({
        defensivesBefore: [],
        defensivesDuring: ["a2"],
        timingObservable: true,
        tools: [baselineTool()],
        activations: [],
        dangerStartMs: 10_000,
      }),
    ).toBe("REACTIVE");
  });

  it("penalizes no response only when a baseline tool is available", () => {
    expect(
      classifyDefensiveResponse({
        defensivesBefore: [],
        defensivesDuring: [],
        timingObservable: true,
        tools: [baselineTool()],
        activations: [],
        dangerStartMs: 10_000,
      }),
    ).toBe("NO_RESPONSE_AVAILABLE");
  });

  it("does not penalize when tool is still on cooldown", () => {
    expect(
      classifyDefensiveResponse({
        defensivesBefore: [],
        defensivesDuring: [],
        timingObservable: true,
        tools: [baselineTool({ cooldownMs: 180_000 })],
        activations: [{ abilityGameId: 104773, timestampMs: 5_000 }],
        dangerStartMs: 10_000,
      }),
    ).toBe("NO_TOOL_AVAILABLE");
  });

  it("treats cooldown ending exactly at danger timestamp as available", () => {
    expect(
      toolAvailabilityAt(
        baselineTool({ cooldownMs: 5_000 }),
        [{ abilityGameId: 104773, timestampMs: 5_000 }],
        10_000,
      ),
    ).toBe("AVAILABLE");
  });

  it("supports explicit multi-charge tools", () => {
    const tool = baselineTool({ charges: 2, cooldownMs: 30_000 });
    expect(
      toolAvailabilityAt(
        tool,
        [
          { abilityGameId: 104773, timestampMs: 1_000 },
          { abilityGameId: 104773, timestampMs: 2_000 },
        ],
        10_000,
      ),
    ).toBe("ON_COOLDOWN");
    expect(
      toolAvailabilityAt(
        tool,
        [{ abilityGameId: 104773, timestampMs: 1_000 }],
        10_000,
      ),
    ).toBe("AVAILABLE");
  });

  it("does not treat talent-gated unknown tools as available failure", () => {
    expect(
      classifyDefensiveResponse({
        defensivesBefore: [],
        defensivesDuring: [],
        timingObservable: true,
        tools: [baselineTool({ availability: "TALENT" })],
        activations: [],
        dangerStartMs: 10_000,
      }),
    ).toBe("NO_TOOL_AVAILABLE");
  });

  it("marks missing timing evidence as not observable", () => {
    expect(
      classifyDefensiveResponse({
        defensivesBefore: [],
        defensivesDuring: [],
        timingObservable: false,
        tools: [baselineTool()],
        activations: [],
        dangerStartMs: 10_000,
      }),
    ).toBe("NOT_OBSERVABLE");
  });

  it("scores contextual windows with anticipated > reactive > no-response", () => {
    const anticipated = scoreSurvivalV2Defensive({
      activations: {
        byCategory: {},
        toolkit: [{ category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" }],
        catalogCoverage: 1,
      },
      activeCombatDurationMs: 1_800_000,
      dangerWindows: [
        {
          startMs: 1,
          endMs: 2,
          triggerTypes: ["SUSTAINED_PRESSURE"],
          hpEvidenceQuality: "PARTIAL",
          defensiveResponseClass: "ANTICIPATED",
        },
      ],
    });
    const reactive = scoreSurvivalV2Defensive({
      activations: {
        byCategory: {},
        toolkit: [{ category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" }],
        catalogCoverage: 1,
      },
      activeCombatDurationMs: 1_800_000,
      dangerWindows: [
        {
          startMs: 1,
          endMs: 2,
          triggerTypes: ["SUSTAINED_PRESSURE"],
          hpEvidenceQuality: "PARTIAL",
          defensiveResponseClass: "REACTIVE",
        },
      ],
    });
    const noResponse = scoreSurvivalV2Defensive({
      activations: {
        byCategory: {},
        toolkit: [{ category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" }],
        catalogCoverage: 1,
      },
      activeCombatDurationMs: 1_800_000,
      dangerWindows: [
        {
          startMs: 1,
          endMs: 2,
          triggerTypes: ["SUSTAINED_PRESSURE"],
          hpEvidenceQuality: "PARTIAL",
          defensiveResponseClass: "NO_RESPONSE_AVAILABLE",
        },
      ],
    });
    expect(anticipated.score!).toBeGreaterThan(reactive.score!);
    expect(reactive.score!).toBeGreaterThan(noResponse.score!);
    expect(anticipated.score).toBe(SURVIVAL_V2_PHASE2.defensiveClassScores.ANTICIPATED);
  });
});

describe("Survival Phase 2 recovery classification", () => {
  it("scores timely > late > no recovery with available self-heal", () => {
    expect(scoreRecoveryResponseClass("TIMELY_RECOVERY")!).toBeGreaterThan(
      scoreRecoveryResponseClass("LATE_RECOVERY")!,
    );
    expect(scoreRecoveryResponseClass("LATE_RECOVERY")!).toBeGreaterThan(
      scoreRecoveryResponseClass("NO_RECOVERY_AVAILABLE")!,
    );
    expect(scoreRecoveryResponseClass("NO_SELF_HEAL_AVAILABLE")).toBeNull();
  });

  it("classifies timely vs late from recovery timestamps", () => {
    const recoveryById = new Map([
      [
        "r-late",
        {
          id: "r-late",
          timestampMs: 20_000,
          abilityGameId: 6262,
          category: "CONSUMABLE" as const,
        },
      ],
    ]);
    expect(
      classifyRecoveryResponse({
        recoveryActivationIds: ["r-late"],
        recoveryById,
        dangerEndMs: 10_000,
        timingObservable: true,
        tools: [
          baselineTool({
            spellId: 6262,
            category: "CONSUMABLE",
            cooldownMs: 60_000,
          }),
        ],
        activations: [],
      }),
    ).toBe("LATE_RECOVERY");

    recoveryById.set("r-timely", {
      id: "r-timely",
      timestampMs: 11_000,
      abilityGameId: 6262,
      category: "CONSUMABLE",
    });
    expect(
      classifyRecoveryResponse({
        recoveryActivationIds: ["r-timely"],
        recoveryById,
        dangerEndMs: 10_000,
        timingObservable: true,
        tools: [
          baselineTool({
            spellId: 6262,
            category: "CONSUMABLE",
            cooldownMs: 60_000,
          }),
        ],
        activations: [],
      }),
    ).toBe("TIMELY_RECOVERY");
  });

  it("omits recovery when no self-heal toolkit applies", () => {
    expect(
      classifyRecoveryResponse({
        recoveryActivationIds: [],
        recoveryById: new Map(),
        dangerEndMs: 10_000,
        timingObservable: true,
        tools: [],
        activations: [],
      }),
    ).toBe("NO_SELF_HEAL_AVAILABLE");

    const scored = scoreSurvivalV2EmergencyRecovery({
      clusters: [
        {
          startMs: 1,
          endMs: 2,
          triggerTypes: ["SUSTAINED_PRESSURE"],
          hpEvidenceQuality: "PARTIAL",
          recoveryResponseClass: "NO_SELF_HEAL_AVAILABLE",
        },
      ],
    });
    expect(scored.state).toBe("NOT_APPLICABLE");
  });

  it("does not treat routine healing outside danger as emergency recovery", () => {
    // No recoveryAfter on the window → no emergency credit; tool still available.
    expect(
      classifyRecoveryResponse({
        recoveryActivationIds: [],
        recoveryById: new Map(),
        dangerEndMs: 10_000,
        timingObservable: true,
        tools: [
          baselineTool({
            spellId: 6262,
            category: "CONSUMABLE",
            cooldownMs: 60_000,
          }),
        ],
        // Prior use finished cooldown before danger — tool is available but unused in-window.
        activations: [{ abilityGameId: 6262, timestampMs: -100_000 }],
      }),
    ).toBe("NO_RECOVERY_AVAILABLE");
  });
});

describe("Survival Phase 2 death evidence semantics", () => {
  it("treats zero observed deaths differently from missing death evidence", () => {
    const zero = scoreSurvivalV2Outcome({ count: 0, evidenceState: "OBSERVED" });
    const missing = scoreSurvivalV2Outcome({ count: 0, evidenceState: "MISSING" });
    expect(zero.state).toBe("SCORED");
    expect(zero.score).toBe(100);
    expect(missing.state).toBe("UNAVAILABLE");
    expect(missing.score).toBeNull();
    expect(zero.state).not.toBe(missing.state);
  });
});

describe("Survival Phase 2 run edge cases", () => {
  it("keeps relative damage omitted and remains valid with contextual components", () => {
    const fact: SurvivalFactDocumentV2 = {
      schemaVersion: "survival-facts-v2.0.0",
      extractorFamily: "survival",
      extractorVersion: "test",
      dungeonSlug: "ara-kara",
      slotIndex: 0,
      identity: { reportCode: "r", fightId: 1, reportRevision: 1 },
      keyLevel: 12,
      deaths: { count: 0, evidenceState: "OBSERVED" },
      activeCombat: { durationMs: 1_800_000, fightDurationMs: 1_800_000 },
      defensiveActivations: {
        byCategory: { DEFENSIVE_MAJOR: 1 },
        toolkit: [{ category: "DEFENSIVE_MAJOR", state: "AVAILABLE_CONFIRMED" }],
        catalogCoverage: 1,
        timedActivations: [
          {
            id: "d1",
            timestampMs: 9_000,
            abilityGameId: 104773,
            category: "DEFENSIVE_MAJOR",
          },
        ],
      },
      dangerWindows: [
        {
          startMs: 10_000,
          endMs: 12_000,
          triggerTypes: ["SUSTAINED_PRESSURE"],
          hpEvidenceQuality: "PARTIAL",
          defensiveResponseClass: "ANTICIPATED",
          recoveryResponseClass: "TIMELY_RECOVERY",
          recoveryEligible: true,
          recoveryUseful: true,
        },
      ],
      healthEvidence: { mode: "FULL", catalogSelfHealCoverage: 1 },
      relativeDamage: null,
      limitations: [],
    };
    const run = scoreSurvivalV2Run(fact, "shadow");
    expect(run.valid).toBe(true);
    expect(run.defensive.state).toBe("SCORED");
    expect(run.recovery.state).toBe("SCORED");
    expect(run.relativeDamageShadow.publicContribution).toBe(0);
    expect(run.behavioralScore).toBeGreaterThan(50);
  });
});
