/**
 * Calibration V2 report extensions — deterministic backend report data.
 * Does not redesign UI; additive fields for admin/API consumers.
 */

import type { QualitativeLabel } from "./types.js";
import type {
  CalibrationV2DimensionReplayResult,
  CalibrationV2ReplayReport,
} from "./replay-v2.js";

export const CALIBRATION_REPORT_V2_SCHEMA_VERSION = "2.0.0" as const;

/** Minimum members before a slice may be interpreted as a recommendation. */
export const CALIBRATION_V2_MIN_SLICE_SIZE = 5;

export interface CalibrationV2SliceLimitation {
  sliceKey: string;
  count: number;
  limited: true;
  message: string;
}

export interface CalibrationV2SliceSummary {
  key: string;
  count: number;
  scoredCount: number;
  meanScore: number | null;
  meanConfidence: number | null;
  limited: boolean;
  limitation: string | null;
}

export interface CalibrationV2DimensionDelta {
  dimension: string;
  activeScore: number | null;
  draftScore: number | null;
  delta: number | null;
}

export interface CalibrationV2MemberDelta {
  memberId: string;
  expectedLabel: QualitativeLabel | string;
  role: string | null;
  classSlug: string | null;
  specSlug: string | null;
  overallActive: number | null;
  overallDraft: number | null;
  overallDelta: number | null;
  dimensionDeltas: CalibrationV2DimensionDelta[];
}

export interface CalibrationV2PerformanceDisagreement {
  memberId: string;
  detailedScore: number | null;
  profileScore: number | null;
  disagreement: number | null;
  note: string;
}

export interface CalibrationV2ReportExtension {
  schemaVersion: typeof CALIBRATION_REPORT_V2_SCHEMA_VERSION;
  bundleHash: string;
  contentHash: string;
  deterministicSeed: number;
  providerCalls: 0;
  refreshCalls: 0;
  /** Present when both active and draft replays were supplied. */
  activeVersusDraft: {
    identicalEvidence: true;
    sourceModelsImmutable: true;
    memberDeltas: CalibrationV2MemberDelta[];
    meanOverallDelta: number | null;
  } | null;
  /** Optional V1 snapshot overall vs V2 replay overall. */
  v1VersusV2: {
    memberDeltas: Array<{
      memberId: string;
      v1Overall: number | null;
      v2Overall: number | null;
      delta: number | null;
    }>;
    meanDelta: number | null;
  } | null;
  dimensionDeltas: CalibrationV2DimensionDelta[];
  slices: {
    role: CalibrationV2SliceSummary[];
    classSpec: CalibrationV2SliceSummary[];
    meta: CalibrationV2SliceSummary[];
    coverage: CalibrationV2SliceSummary[];
    keyBand: CalibrationV2SliceSummary[];
  };
  performanceDetailedVersusProfile: CalibrationV2PerformanceDisagreement[];
  slotCoverage: {
    membersWithExports: number;
    meanDimensionsPresent: number | null;
  };
  provisionalRate: number | null;
  smallSliceLimitations: CalibrationV2SliceLimitation[];
  frozenCostDiagnostics: {
    available: boolean;
    notes: string[];
  };
  limitations: string[];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function overallFromDims(dims: CalibrationV2DimensionReplayResult[]): number | null {
  const scores = dims.map((d) => d.score).filter((s): s is number => s != null);
  return mean(scores);
}

function sliceSummary(key: string, rows: Array<{ score: number | null; confidence: number | null }>): CalibrationV2SliceSummary {
  const scored = rows.filter((r) => r.score != null);
  const confs = scored.map((r) => r.confidence).filter((c): c is number => c != null);
  const limited = rows.length > 0 && rows.length < CALIBRATION_V2_MIN_SLICE_SIZE;
  return {
    key,
    count: rows.length,
    scoredCount: scored.length,
    meanScore: mean(scored.map((r) => r.score!)),
    meanConfidence: mean(confs),
    limited,
    limitation: limited
      ? `slice n=${rows.length} < ${CALIBRATION_V2_MIN_SLICE_SIZE}; report only — do not overinterpret`
      : null,
  };
}

export interface BuildCalibrationReportV2ExtensionInput {
  /** Draft / evaluation-side replay (required). */
  draftReplay: CalibrationV2ReplayReport;
  /** Active-side replay for active-versus-draft. */
  activeReplay?: CalibrationV2ReplayReport | null;
  /** Optional V1 overall scores by memberId for V1/V2 deltas. */
  v1OverallByMemberId?: Record<string, number | null>;
  /** Optional member metadata for slices. */
  memberMeta?: Record<
    string,
    {
      role?: string | null;
      classSlug?: string | null;
      specSlug?: string | null;
      meta?: boolean | null;
      coverageState?: string | null;
      keyBand?: string | null;
    }
  >;
  /** Optional Performance detailed vs profile pairs. */
  performanceDisagreements?: CalibrationV2PerformanceDisagreement[];
  /** Frozen cost diagnostics when present on the bundle. */
  frozenCostNotes?: string[];
}

/**
 * Build additive V2 report extension. Deterministic for identical inputs.
 * Small slices are explicitly marked limited.
 */
export function buildCalibrationReportV2Extension(
  input: BuildCalibrationReportV2ExtensionInput,
): CalibrationV2ReportExtension {
  const draft = input.draftReplay;
  const active = input.activeReplay ?? null;
  const meta = input.memberMeta ?? {};

  const memberDeltas: CalibrationV2MemberDelta[] = [];
  const dimAgg = new Map<string, { active: number[]; draft: number[] }>();

  for (const member of draft.members) {
    const activeMember = active?.members.find((m) => m.memberId === member.memberId) ?? null;
    const draftOverall = overallFromDims(member.dimensions);
    const activeOverall = activeMember ? overallFromDims(activeMember.dimensions) : null;
    const dimensionDeltas: CalibrationV2DimensionDelta[] = [];

    const dims = new Set([
      ...member.dimensions.map((d) => d.dimension),
      ...(activeMember?.dimensions.map((d) => d.dimension) ?? []),
    ]);
    for (const dimension of dims) {
      const dScore = member.dimensions.find((d) => d.dimension === dimension)?.score ?? null;
      const aScore =
        activeMember?.dimensions.find((d) => d.dimension === dimension)?.score ?? null;
      const delta = aScore != null && dScore != null ? dScore - aScore : null;
      dimensionDeltas.push({
        dimension,
        activeScore: aScore,
        draftScore: dScore,
        delta,
      });
      const bucket = dimAgg.get(dimension) ?? { active: [], draft: [] };
      if (aScore != null) bucket.active.push(aScore);
      if (dScore != null) bucket.draft.push(dScore);
      dimAgg.set(dimension, bucket);
    }

    const m = meta[member.memberId] ?? {};
    memberDeltas.push({
      memberId: member.memberId,
      expectedLabel: member.expectedLabel,
      role: m.role ?? null,
      classSlug: m.classSlug ?? null,
      specSlug: m.specSlug ?? null,
      overallActive: activeOverall,
      overallDraft: draftOverall,
      overallDelta:
        activeOverall != null && draftOverall != null ? draftOverall - activeOverall : null,
      dimensionDeltas,
    });
  }

  const dimensionDeltas: CalibrationV2DimensionDelta[] = [...dimAgg.entries()].map(
    ([dimension, bucket]) => {
      const a = mean(bucket.active);
      const d = mean(bucket.draft);
      return {
        dimension,
        activeScore: a,
        draftScore: d,
        delta: a != null && d != null ? d - a : null,
      };
    },
  );

  // Slices
  const roleBuckets = new Map<string, Array<{ score: number | null; confidence: number | null }>>();
  const classSpecBuckets = new Map<string, Array<{ score: number | null; confidence: number | null }>>();
  const metaBuckets = new Map<string, Array<{ score: number | null; confidence: number | null }>>();
  const coverageBuckets = new Map<string, Array<{ score: number | null; confidence: number | null }>>();
  const keyBandBuckets = new Map<string, Array<{ score: number | null; confidence: number | null }>>();

  for (const member of draft.members) {
    const m = meta[member.memberId] ?? {};
    const score = overallFromDims(member.dimensions);
    const confidence = mean(member.dimensions.map((d) => d.confidence));
    const row = { score, confidence };
    const roleKey = m.role ?? "UNKNOWN_ROLE";
    roleBuckets.set(roleKey, [...(roleBuckets.get(roleKey) ?? []), row]);
    const csKey = `${m.classSlug ?? "unknown"}/${m.specSlug ?? "unknown"}`;
    classSpecBuckets.set(csKey, [...(classSpecBuckets.get(csKey) ?? []), row]);
    const metaKey = m.meta === true ? "meta" : m.meta === false ? "non-meta" : "meta-unknown";
    metaBuckets.set(metaKey, [...(metaBuckets.get(metaKey) ?? []), row]);
    const covKey = m.coverageState ?? "coverage-unknown";
    coverageBuckets.set(covKey, [...(coverageBuckets.get(covKey) ?? []), row]);
    const kbKey = m.keyBand ?? "keyband-unknown";
    keyBandBuckets.set(kbKey, [...(keyBandBuckets.get(kbKey) ?? []), row]);
  }

  const slices = {
    role: [...roleBuckets.entries()].map(([k, rows]) => sliceSummary(k, rows)),
    classSpec: [...classSpecBuckets.entries()].map(([k, rows]) => sliceSummary(k, rows)),
    meta: [...metaBuckets.entries()].map(([k, rows]) => sliceSummary(k, rows)),
    coverage: [...coverageBuckets.entries()].map(([k, rows]) => sliceSummary(k, rows)),
    keyBand: [...keyBandBuckets.entries()].map(([k, rows]) => sliceSummary(k, rows)),
  };

  const smallSliceLimitations: CalibrationV2SliceLimitation[] = [
    ...slices.role,
    ...slices.classSpec,
    ...slices.meta,
    ...slices.coverage,
    ...slices.keyBand,
  ]
    .filter((s) => s.limited)
    .map((s) => ({
      sliceKey: s.key,
      count: s.count,
      limited: true as const,
      message: s.limitation ?? `slice n=${s.count} is too small to interpret`,
    }));

  let v1VersusV2: CalibrationV2ReportExtension["v1VersusV2"] = null;
  if (input.v1OverallByMemberId) {
    const memberDeltasV1 = draft.members.map((m) => {
      const v1Overall = input.v1OverallByMemberId![m.memberId] ?? null;
      const v2Overall = overallFromDims(m.dimensions);
      return {
        memberId: m.memberId,
        v1Overall,
        v2Overall,
        delta: v1Overall != null && v2Overall != null ? v2Overall - v1Overall : null,
      };
    });
    v1VersusV2 = {
      memberDeltas: memberDeltasV1,
      meanDelta: mean(
        memberDeltasV1.map((d) => d.delta).filter((x): x is number => x != null),
      ),
    };
  }

  const membersWithExports = draft.members.filter((m) => m.dimensions.length > 0).length;
  const meanDimensionsPresent = mean(draft.members.map((m) => m.dimensions.length));

  const provisionalCount = draft.members.filter((m) =>
    m.dimensions.some(
      (d) => d.availabilityState === "PARTIAL" || d.availabilityState === "UNAVAILABLE",
    ),
  ).length;
  const provisionalRate =
    draft.members.length === 0 ? null : provisionalCount / draft.members.length;

  const limitations = [
    "V2 report extension is additive; V1 reports remain readable unchanged.",
    ...(smallSliceLimitations.length > 0
      ? ["One or more slices are below the minimum interpretive size."]
      : []),
  ];

  return {
    schemaVersion: CALIBRATION_REPORT_V2_SCHEMA_VERSION,
    bundleHash: draft.bundleHash,
    contentHash: draft.contentHash,
    deterministicSeed: draft.deterministicSeed,
    providerCalls: 0,
    refreshCalls: 0,
    activeVersusDraft: active
      ? {
          identicalEvidence: true,
          sourceModelsImmutable: true,
          memberDeltas,
          meanOverallDelta: mean(
            memberDeltas.map((d) => d.overallDelta).filter((x): x is number => x != null),
          ),
        }
      : null,
    v1VersusV2,
    dimensionDeltas,
    slices,
    performanceDetailedVersusProfile: input.performanceDisagreements ?? [],
    slotCoverage: {
      membersWithExports,
      meanDimensionsPresent,
    },
    provisionalRate,
    smallSliceLimitations,
    frozenCostDiagnostics: {
      available: (input.frozenCostNotes?.length ?? 0) > 0,
      notes: input.frozenCostNotes ?? [],
    },
    limitations,
  };
}
