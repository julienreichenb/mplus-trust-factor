import { describe, expect, it } from "vitest";
import {
  CALIBRATION_V2_MIN_SLICE_SIZE,
  buildCalibrationReportV2Extension,
} from "./report-v2.js";
import type { CalibrationV2ReplayReport } from "./replay-v2.js";

function replay(partial?: Partial<CalibrationV2ReplayReport>): CalibrationV2ReplayReport {
  return {
    schemaVersion: "calibration-replay-v2",
    bundleHash: "bundle-hash",
    deterministicSeed: 7,
    mode: "active-versus-draft",
    activeModelKey: "v6",
    evaluationModelKey: "v6-draft",
    members: [
      {
        memberId: "m1",
        expectedLabel: "good",
        dimensions: [
          {
            dimension: "UTILITY",
            score: 50,
            confidence: 0.4,
            availabilityState: "PARTIAL",
            inputFingerprint: "fp-u",
            algorithmVersion: "utility-v2",
          },
          {
            dimension: "PERFORMANCE",
            score: 70,
            confidence: 0.8,
            availabilityState: "AVAILABLE",
            inputFingerprint: "fp-p",
            algorithmVersion: "performance-v2",
          },
        ],
        errors: [],
      },
      {
        memberId: "m2",
        expectedLabel: "average",
        dimensions: [
          {
            dimension: "UTILITY",
            score: 55,
            confidence: 0.5,
            availabilityState: "AVAILABLE",
            inputFingerprint: "fp-u2",
            algorithmVersion: "utility-v2",
          },
        ],
        errors: [],
      },
    ],
    preflightIssues: [],
    contentHash: "report-hash",
    providerCalls: 0,
    refreshCalls: 0,
    ...partial,
  };
}

describe("buildCalibrationReportV2Extension", () => {
  it("is deterministic and marks small slices as limited", () => {
    const draft = replay();
    const active = replay({
      members: draft.members.map((m) => ({
        ...m,
        dimensions: m.dimensions.map((d) => ({
          ...d,
          score: d.score == null ? null : d.score - 5,
        })),
      })),
    });

    const a = buildCalibrationReportV2Extension({
      draftReplay: draft,
      activeReplay: active,
      v1OverallByMemberId: { m1: 60, m2: 58 },
      memberMeta: {
        m1: {
          role: "DPS",
          classSlug: "warlock",
          specSlug: "affliction",
          meta: false,
          coverageState: "PARTIAL",
          keyBand: "10-14",
        },
        m2: {
          role: "DPS",
          classSlug: "mage",
          specSlug: "fire",
          meta: true,
          coverageState: "FULL",
          keyBand: "15+",
        },
      },
      performanceDisagreements: [
        {
          memberId: "m1",
          detailedScore: 72,
          profileScore: 65,
          disagreement: 7,
          note: "detailed_versus_profile",
        },
      ],
      frozenCostNotes: ["pointsConsumed=12.5"],
    });
    const b = buildCalibrationReportV2Extension({
      draftReplay: draft,
      activeReplay: active,
      v1OverallByMemberId: { m1: 60, m2: 58 },
      memberMeta: {
        m1: {
          role: "DPS",
          classSlug: "warlock",
          specSlug: "affliction",
          meta: false,
          coverageState: "PARTIAL",
          keyBand: "10-14",
        },
        m2: {
          role: "DPS",
          classSlug: "mage",
          specSlug: "fire",
          meta: true,
          coverageState: "FULL",
          keyBand: "15+",
        },
      },
      performanceDisagreements: [
        {
          memberId: "m1",
          detailedScore: 72,
          profileScore: 65,
          disagreement: 7,
          note: "detailed_versus_profile",
        },
      ],
      frozenCostNotes: ["pointsConsumed=12.5"],
    });

    expect(a).toEqual(b);
    expect(a.schemaVersion).toBe("2.0.0");
    expect(a.providerCalls).toBe(0);
    expect(a.activeVersusDraft?.identicalEvidence).toBe(true);
    expect(a.activeVersusDraft?.providerCalls).toBe(0);
    expect(a.activeVersusDraft?.modelActivated).toBe(false);
    expect(a.activeVersusDraft?.publicationMutated).toBe(false);
    expect(a.activeVersusDraft?.activeModelKey).toBe("v6");
    expect(a.activeVersusDraft?.draftModelKey).toBe("v6-draft");
    expect(a.activeVersusDraft?.changedConfigFields).toEqual([]);
    expect(a.v1VersusV2?.memberDeltas).toHaveLength(2);
    expect(a.dimensionDeltas.length).toBeGreaterThan(0);
    expect(a.performanceDetailedVersusProfile[0]?.disagreement).toBe(7);
    expect(a.frozenCostDiagnostics.available).toBe(true);
    expect(a.slotCoverage.membersWithExports).toBe(2);
    expect(a.provisionalRate).toBeGreaterThan(0);

    expect(CALIBRATION_V2_MIN_SLICE_SIZE).toBe(5);
    expect(a.smallSliceLimitations.length).toBeGreaterThan(0);
    expect(a.slices.role.every((s) => s.limited)).toBe(true);
    expect(a.limitations.some((l) => l.includes("V1 reports remain readable"))).toBe(true);
  });

  it("keeps V1-compatible path when only draft replay is provided", () => {
    const ext = buildCalibrationReportV2Extension({ draftReplay: replay() });
    expect(ext.activeVersusDraft).toBeNull();
    expect(ext.v1VersusV2).toBeNull();
    expect(ext.schemaVersion).toBe("2.0.0");
  });
});
