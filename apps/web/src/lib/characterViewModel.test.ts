import { describe, expect, it } from "vitest";
import {
  buildDimensionExplainabilityView,
  EXPLAINABILITY_UNAVAILABLE_MESSAGE,
  hasScoreExplainabilityV1,
  mapEquipmentSlots,
  parseContributorSignals,
  parseConfidenceReasons,
  presentGrade,
  resolveDataConfidence,
  formatKeySignalDisplayText,
  topSignals,
} from "./characterViewModel";
import { FIXTURE_CHARACTERS } from "../api/mock/fixtures";
import type { DimensionScoreDTO } from "@mplus/contracts";

describe("characterViewModel", () => {
  it("presents letter grades with textual interpretation", () => {
    expect(presentGrade("A")).toMatchObject({
      letter: "A",
      interpretation: "Strong trust profile",
      isUnrated: false,
    });
  });

  it("formats key-signal text as qualitative + topic without scored values", () => {
    expect(
      formatKeySignalDisplayText({
        kind: "positive",
        label: "Offensive cooldown discipline scored 81",
        qualitativeLabel: "VERY GOOD",
      }),
    ).toBe("Very good offensive cooldown discipline");
    expect(
      formatKeySignalDisplayText({
        kind: "risk",
        label: "Defensive response scored 18",
        qualitativeLabel: "VERY BAD",
      }),
    ).toBe("Very bad defensive response");
    expect(
      formatKeySignalDisplayText({
        kind: "fact",
        label: "No confirmed Mythic+ history for scored seasons",
      }),
    ).toBe("No confirmed Mythic+ history for scored seasons");
  });

  it("treats U as unrated rather than a weak tier", () => {
    const u = presentGrade("U");
    expect(u.isUnrated).toBe(true);
    expect(u.title).toBe("Unrated");
    expect(u.interpretation).toMatch(/Insufficient evidence/i);
  });

  it("resolves confidence from profile or score", () => {
    const profile = FIXTURE_CHARACTERS[0]!.profile;
    expect(resolveDataConfidence(profile)).toBe(78);
    expect(
      resolveDataConfidence({
        ...profile,
        dataConfidence: null,
        score: { ...profile.score!, confidence: 0.42 },
      }),
    ).toBe(42);
    expect(
      resolveDataConfidence({
        ...profile,
        dataConfidence: 1,
        score: { ...profile.score!, confidence: 1 },
      }),
    ).toBe(100);
    expect(
      resolveDataConfidence({
        ...profile,
        dataConfidence: 0.25,
      }),
    ).toBe(25);
  });

  it("extracts contributor signals from Score Explainability V1 fixtures", () => {
    const dims = FIXTURE_CHARACTERS[0]!.profile.score!.dimensions;
    expect(hasScoreExplainabilityV1(dims)).toBe(true);
    const signals = parseContributorSignals(dims);
    expect(signals.some((s) => s.kind === "positive" && s.label.includes("Phase 1"))).toBe(true);
    expect(signals.some((s) => s.kind === "risk")).toBe(true);
    expect(
      signals.some(
        (s) =>
          s.kind === "fact" &&
          s.code === "experience.confirmed_no_activity" &&
          /none confirmed/i.test(s.label),
      ),
    ).toBe(true);
    // Confirmed absence must never appear as a weakness.
    expect(
      signals.some(
        (s) => s.kind === "risk" && s.code === "experience.confirmed_no_activity",
      ),
    ).toBe(false);
    expect(topSignals(signals, "risk", 2).length).toBeGreaterThan(0);
  });

  it("keeps confidence reasons out of score weaknesses", () => {
    const dims = FIXTURE_CHARACTERS[0]!.profile.score!.dimensions;
    const scoreSignals = parseContributorSignals(dims);
    const conf = parseConfidenceReasons(dims);
    expect(conf.some((s) => /cooldown evidence/i.test(s.label))).toBe(true);
    expect(scoreSignals.some((s) => s.kind === "risk" && /cooldown evidence/i.test(s.label))).toBe(
      false,
    );
    expect(scoreSignals.some((s) => s.kind === "confidence")).toBe(false);
  });

  it("maps known equipment slots and leaves others unavailable", () => {
    const slots = mapEquipmentSlots(FIXTURE_CHARACTERS[0]!.profile.equipment);
    const filled = slots.filter((s) => s.filled);
    expect(filled).toHaveLength(2);
    expect(filled.map((s) => s.label)).toEqual(["Trinket 1", "Trinket 2"]);
    expect(slots.find((s) => s.id === "head")?.filled).toBe(false);
  });

  it("emits no product score signals when ScoreExplainabilityV1 is absent", () => {
    const dims: DimensionScoreDTO[] = [
      {
        dimension: "PERFORMANCE",
        score: 70,
        confidence: 0.8,
        weight: 0.32,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          positive: [{ label: "Legacy positive label" }],
          negative: [{ label: "Legacy negative label" }],
          available: [
            { metricKey: "performance.peak", normalizedValue: 80 },
            { metricKey: "performance.consistency", normalizedValue: 30 },
          ],
          missing: [{ metricKey: "performance.coverage", available: false }],
          limitations: ["partial_dungeon_coverage"],
        },
      },
      {
        dimension: "SURVIVAL",
        score: 60,
        confidence: 0.7,
        weight: 0.3,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          positive: [{ label: "Survived pulls" }],
          negative: [{ label: "High deaths" }],
        },
      },
    ];
    expect(hasScoreExplainabilityV1(dims)).toBe(false);
    const signals = parseContributorSignals(dims);
    expect(signals).toEqual([]);
    expect(signals.some((s) => /Legacy|Peak|Consistency|partial_dungeon|Survived|deaths/i.test(s.label))).toBe(
      false,
    );
  });

  it("excludes UNAVAILABLE dimensions and never invents score signals without V1", () => {
    const signals = parseContributorSignals([
      {
        dimension: "UTILITY",
        score: null,
        confidence: 0,
        weight: 0.25,
        state: "UNAVAILABLE",
        reason: "NO_OBSERVATIONS",
        contributors: {
          available: [],
          missing: [
            { metricKey: "utility.interrupts" },
            { metricKey: "utility.crowd_control" },
            { metricKey: "utility.dispels" },
          ],
        },
      },
      {
        dimension: "PERFORMANCE",
        score: 0,
        confidence: 0.9,
        weight: 0.35,
        state: "AVAILABLE",
        reason: null,
        contributors: {
          available: [{ metricKey: "performance.peak", normalizedValue: 0 }],
          missing: [],
        },
      },
    ]);
    expect(signals).toEqual([]);
  });

  it("categorizes POSITIVE/NEGATIVE/NEUTRAL scoreDrivers without inventing from thresholds", () => {
    const dim: DimensionScoreDTO = {
      dimension: "UTILITY",
      score: 70,
      confidence: 0.6,
      weight: 0.25,
      state: "AVAILABLE",
      reason: null,
      contributors: null,
      explainability: {
        scoreDrivers: [
          {
            code: "utility.cast_stops",
            labelKey: "score.utility.cast_stops",
            label: "Cast stops contributed",
            direction: "POSITIVE",
            value: 20,
          },
          {
            code: "utility.strategic_cc",
            labelKey: "score.utility.strategic_cc",
            label: "No strategic CC observed",
            direction: "NEUTRAL",
            value: 0,
          },
          {
            code: "future.unknown_driver",
            labelKey: "score.future.unknown_driver",
            label: "Future unknown driver label",
            direction: "NEGATIVE",
            value: 10,
          },
        ],
        confidenceReasons: [
          {
            code: "tiny_run_sample",
            labelKey: "confidence.utility.tiny_run_sample",
            label: "Tiny run sample",
          },
        ],
      },
    };
    const view = buildDimensionExplainabilityView(dim);
    expect(view.strengths.map((s) => s.code)).toEqual(["utility.cast_stops"]);
    expect(view.weaknesses.map((s) => s.code)).toEqual(["future.unknown_driver"]);
    expect(view.facts.map((s) => s.code)).toEqual(["utility.strategic_cc"]);
    expect(view.confidenceReasons.map((s) => s.code)).toEqual(["tiny_run_sample"]);
    expect(view.weaknesses.some((s) => /Tiny run sample/i.test(s.label))).toBe(false);
  });

  it("hides interrupt-attempt credit counts from product key signals", () => {
    const dim: DimensionScoreDTO = {
      dimension: "UTILITY",
      score: 70,
      confidence: 0.8,
      weight: 0.25,
      state: "AVAILABLE",
      reason: null,
      contributors: null,
      explainability: {
        scoreDrivers: [
          {
            code: "utility.family.interrupt",
            labelKey: "score.utility.family.interrupt",
            label: "Interrupt toolkit scored 82",
            direction: "POSITIVE",
            value: 82,
            qualitativeLabel: "VERY GOOD",
          },
          {
            code: "utility.interrupt_attempt_credit",
            labelKey: "score.utility.interrupt_attempt_credit",
            label: "Interrupt credit: 270 landed, 0 overlapping attempts, 0 misses",
            direction: "POSITIVE",
            value: 270,
            qualitativeLabel: "VERY GOOD",
          },
        ],
        confidenceReasons: [],
      },
    };
    const view = buildDimensionExplainabilityView(dim);
    expect(view.strengths.map((s) => s.code)).toEqual(["utility.family.interrupt"]);
    expect(view.strengths.some((s) => /interrupt credit:/i.test(s.label))).toBe(false);
  });

  it("soft-fails when explainability is null without inventing weaknesses from limitations", () => {
    const dim: DimensionScoreDTO = {
      dimension: "PERFORMANCE",
      score: 80,
      confidence: 0.7,
      weight: 0.35,
      state: "AVAILABLE",
      reason: null,
      contributors: {
        limitations: ["partial_dungeon_coverage"],
        positive: [],
        negative: [],
        missing: [{ metricKey: "partial_dungeon_coverage", available: false }],
      },
    };
    const view = buildDimensionExplainabilityView(dim);
    expect(view.hasExplainability).toBe(false);
    expect(view.legacyFallbackMessage).toBe(EXPLAINABILITY_UNAVAILABLE_MESSAGE);
    expect(view.weaknesses).toEqual([]);
    const signals = parseContributorSignals([dim]);
    expect(signals).toEqual([]);
  });

  it("treats Experience E0 confirmed absence as a score fact with full confidence", () => {
    const dim: DimensionScoreDTO = {
      dimension: "EXPERIENCE",
      score: 0,
      confidence: 1,
      weight: 0.1,
      state: "AVAILABLE",
      reason: null,
      contributors: null,
      explainability: {
        scoreDrivers: [
          {
            code: "experience.confirmed_no_activity",
            labelKey: "score.experience.confirmed_no_activity",
            label: "Previous-season activity: none confirmed",
            direction: "NEUTRAL",
            value: 0,
          },
        ],
        confidenceReasons: [],
      },
    };
    const view = buildDimensionExplainabilityView(dim);
    expect(view.facts[0]?.code).toBe("experience.confirmed_no_activity");
    expect(view.weaknesses).toEqual([]);
    expect(view.fullConfidence).toBe(true);
    expect(parseContributorSignals([dim]).every((s) => s.kind !== "risk")).toBe(true);
  });

  it("shows confidence reasons only for unavailable Experience evidence", () => {
    const dim: DimensionScoreDTO = {
      dimension: "EXPERIENCE",
      score: null,
      confidence: 0,
      weight: 0.1,
      state: "UNAVAILABLE",
      reason: "PREVIOUS_EVIDENCE_UNAVAILABLE",
      contributors: null,
      explainability: {
        scoreDrivers: [
          {
            code: "should.not.render",
            labelKey: "x",
            label: "Should not render as strength",
            direction: "POSITIVE",
            value: 1,
          },
        ],
        confidenceReasons: [
          {
            code: "previous_evidence_unavailable",
            labelKey: "confidence.experience.previous_evidence_unavailable",
            label: "Previous-season evidence is unavailable",
          },
        ],
      },
    };
    const view = buildDimensionExplainabilityView(dim);
    expect(view.strengths).toEqual([]);
    expect(view.weaknesses).toEqual([]);
    expect(view.facts).toEqual([]);
    expect(view.confidenceReasons.map((r) => r.code)).toEqual([
      "previous_evidence_unavailable",
    ]);
    expect(parseContributorSignals([dim])).toEqual([]);
  });
});
