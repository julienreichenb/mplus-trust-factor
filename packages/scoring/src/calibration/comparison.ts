import type { Grade } from "@mplus/contracts";
import type {
  ActiveDraftCharacterComparison,
  ActiveDraftComparisonAggregate,
  ActiveDraftComparisonResult,
  CalibrationRole,
  DimensionDelta,
  PerCharacterCalibrationResult,
  QualitativeLabel,
  SliceSummary,
} from "./types.js";

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function gradeDist(rows: PerCharacterCalibrationResult[]): Partial<Record<Grade, number>> {
  const out: Partial<Record<Grade, number>> = {};
  for (const row of rows) {
    if (!row.grade) continue;
    out[row.grade] = (out[row.grade] ?? 0) + 1;
  }
  return out;
}

function labelDist(
  rows: PerCharacterCalibrationResult[],
): Partial<Record<QualitativeLabel, number>> {
  const out: Partial<Record<QualitativeLabel, number>> = {};
  for (const row of rows) {
    out[row.expectedLabel] = (out[row.expectedLabel] ?? 0) + 1;
  }
  return out;
}

function sliceOf(key: string, rows: PerCharacterCalibrationResult[]): SliceSummary {
  const scored = rows.filter((r) => r.overallScore != null && !r.error && !r.validationFailure);
  const scores = scored.map((r) => r.overallScore!);
  const confs = scored
    .map((r) => r.confidence)
    .filter((c): c is number => typeof c === "number");
  return {
    key,
    count: rows.length,
    scoredCount: scored.length,
    meanScore: mean(scores),
    meanConfidence: confs.length === 0 ? null : mean(confs),
    gradeDistribution: gradeDist(rows),
    labelDistribution: labelDist(rows),
  };
}

function dimMap(
  dims: PerCharacterCalibrationResult["dimensions"],
): Map<string, number | null> {
  return new Map(dims.map((d) => [d.dimension, d.score]));
}

export interface PairwiseReplayResult {
  memberId: string;
  role: CalibrationRole;
  classSlug: string;
  specSlug: string;
  expectedLabel: QualitativeLabel;
  meta: boolean;
  lowConfidence: boolean;
  hasMissingDim: boolean;
  evidenceFingerprint: string | null;
  active: PerCharacterCalibrationResult | null;
  draft: PerCharacterCalibrationResult | null;
}

export function buildActiveDraftComparison(
  pairs: PairwiseReplayResult[],
): ActiveDraftComparisonResult {
  const characters: ActiveDraftCharacterComparison[] = [];

  for (const pair of pairs) {
    const active = pair.active;
    const draft = pair.draft;
    const activeOk = active && !active.error && !active.validationFailure && active.overallScore != null;
    const draftOk = draft && !draft.error && !draft.validationFailure && draft.overallScore != null;
    const comparable = Boolean(
      activeOk &&
        draftOk &&
        pair.evidenceFingerprint &&
        active!.evaluationKind === "replay" &&
        draft!.evaluationKind === "replay",
    );

    const activeDims = dimMap(active?.dimensions ?? []);
    const draftDims = dimMap(draft?.dimensions ?? []);
    const dimKeys = new Set([...activeDims.keys(), ...draftDims.keys()]);
    const dimensionDeltas: DimensionDelta[] = [...dimKeys]
      .sort((a, b) => a.localeCompare(b))
      .map((dimension) => {
        const a = activeDims.get(dimension) ?? null;
        const d = draftDims.get(dimension) ?? null;
        return {
          dimension,
          activeScore: a,
          draftScore: d,
          delta: a != null && d != null ? d - a : null,
        };
      });

    const activeGrade = active?.grade ?? null;
    const draftGrade = draft?.grade ?? null;
    const gradeTransition =
      comparable && activeGrade != null && draftGrade != null
        ? `${activeGrade}->${draftGrade}`
        : null;

    characters.push({
      memberId: pair.memberId,
      role: pair.role,
      classSlug: pair.classSlug,
      specSlug: pair.specSlug,
      expectedLabel: pair.expectedLabel,
      meta: pair.meta,
      activeOverallScore: active?.overallScore ?? null,
      draftOverallScore: draft?.overallScore ?? null,
      scoreDelta:
        comparable && activeOk && draftOk
          ? draft!.overallScore! - active!.overallScore!
          : null,
      activeGrade,
      draftGrade,
      gradeTransition,
      activeConfidence: active?.confidence ?? null,
      draftConfidence: draft?.confidence ?? null,
      confidenceDelta:
        comparable &&
        typeof active?.confidence === "number" &&
        typeof draft?.confidence === "number"
          ? draft!.confidence! - active!.confidence!
          : null,
      dimensionDeltas,
      activeModelKey: active?.scoreModelKey ?? active?.activeModelKey ?? null,
      activeModelVersion: active?.scoreModelVersion ?? active?.activeModelVersion ?? null,
      draftModelKey: draft?.scoreModelKey ?? draft?.evaluationModelKey ?? null,
      draftModelVersion: draft?.scoreModelVersion ?? draft?.evaluationModelVersion ?? null,
      evidenceFingerprint: pair.evidenceFingerprint,
      comparable,
      activeError: active?.validationFailure?.message ?? active?.error ?? null,
      draftError: draft?.validationFailure?.message ?? draft?.error ?? null,
    });
  }

  const comparableRows = characters.filter((c) => c.comparable && c.scoreDelta != null);
  if (comparableRows.length === 0) {
    return {
      schemaVersion: "1.0.0",
      comparable: false,
      note:
        "No strict active-versus-draft pairs — snapshot-only evidence is not comparable without replayable observations/context.",
      characters,
      aggregate: null,
    };
  }

  const scoreDeltas = comparableRows.map((c) => c.scoreDelta!);
  const gradeTransitionCounts: Record<string, number> = {};
  let changedGradeCount = 0;
  for (const row of comparableRows) {
    if (!row.gradeTransition) continue;
    gradeTransitionCounts[row.gradeTransition] =
      (gradeTransitionCounts[row.gradeTransition] ?? 0) + 1;
    if (row.activeGrade !== row.draftGrade) changedGradeCount += 1;
  }

  const dimDeltaBuckets = new Map<string, number[]>();
  for (const row of comparableRows) {
    for (const d of row.dimensionDeltas) {
      if (d.delta == null) continue;
      const list = dimDeltaBuckets.get(d.dimension) ?? [];
      list.push(d.delta);
      dimDeltaBuckets.set(d.dimension, list);
    }
  }

  const sortedByDelta = [...comparableRows].sort(
    (a, b) => (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0),
  );

  // Build synthetic row views for slice helpers (use draft scores as primary).
  const asRows = (filter: (c: ActiveDraftCharacterComparison) => boolean) =>
    pairs
      .filter((p) => {
        const c = characters.find((x) => x.memberId === p.memberId);
        return c ? filter(c) : false;
      })
      .map((p) => p.draft ?? p.active!)
      .filter(Boolean);

  const aggregate: ActiveDraftComparisonAggregate = {
    sampleSize: characters.length,
    comparableCount: comparableRows.length,
    meanScoreDelta: mean(scoreDeltas),
    medianScoreDelta: median(scoreDeltas),
    gradeTransitionCounts,
    changedGradeCount,
    changedGradePercent: comparableRows.length === 0 ? null : changedGradeCount / comparableRows.length,
    meanDimensionDeltas: [...dimDeltaBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dimension, vals]) => ({
        dimension,
        meanDelta: mean(vals),
        sampleSize: vals.length,
      })),
    largestPositiveMovers: sortedByDelta
      .filter((c) => (c.scoreDelta ?? 0) > 0)
      .slice(0, 10)
      .map((c) => ({ memberId: c.memberId, scoreDelta: c.scoreDelta! })),
    largestNegativeMovers: [...sortedByDelta]
      .reverse()
      .filter((c) => (c.scoreDelta ?? 0) < 0)
      .slice(0, 10)
      .map((c) => ({ memberId: c.memberId, scoreDelta: c.scoreDelta! })),
    roleSlices: groupSlice(
      asRows(() => true),
      (r) => r.role,
    ),
    classSpecSlices: groupSlice(
      asRows(() => true),
      (r) => `${r.classSlug}/${r.specSlug}`,
    ),
    expectedLabelSlices: groupSlice(
      asRows(() => true),
      (r) => r.expectedLabel,
    ),
    metaVersusNonMeta: {
      meta: sliceOf(
        "meta",
        asRows((c) => c.meta),
      ),
      nonMeta: sliceOf(
        "non-meta",
        asRows((c) => !c.meta),
      ),
    },
    lowConfidenceSlices: [
      sliceOf(
        "low-confidence",
        asRows((c) => {
          const p = pairs.find((x) => x.memberId === c.memberId);
          return Boolean(p?.lowConfidence);
        }),
      ),
    ],
    missingDataSlices: [
      sliceOf(
        "missing-or-partial-dimension",
        asRows((c) => {
          const p = pairs.find((x) => x.memberId === c.memberId);
          return Boolean(p?.hasMissingDim);
        }),
      ),
    ],
  };

  return {
    schemaVersion: "1.0.0",
    comparable: true,
    note: "Strict comparison from identical observations, scoring context, calculatedAt, and evidence fingerprint. Exploratory — not a production calibration claim.",
    characters: characters.sort((a, b) => a.memberId.localeCompare(b.memberId)),
    aggregate,
  };
}

function groupSlice(
  rows: PerCharacterCalibrationResult[],
  keyFn: (r: PerCharacterCalibrationResult) => string,
): SliceSummary[] {
  const map = new Map<string, PerCharacterCalibrationResult[]>();
  for (const row of rows) {
    const key = keyFn(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => sliceOf(key, group));
}

/** Snapshot-only non-comparable marker for reports. */
export function snapshotOnlyComparisonNote(): ActiveDraftComparisonResult {
  return {
    schemaVersion: "1.0.0",
    comparable: false,
    note: "Snapshot-only mode — not a strict active/draft model delta. Provide replayable observations/context and mode=active-versus-draft.",
    characters: [],
    aggregate: null,
  };
}
