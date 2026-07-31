import type {
  ActiveDraftComparisonResult,
  CalibrationReport,
  PerCharacterCalibrationResult,
} from "./types.js";

/** Strip identity for public-safe artifacts (identity-redacted, not legal PII claims). */
export function anonymizeReport(report: CalibrationReport): CalibrationReport {
  // Sort-stable aliases: characters are expected sorted by memberId before anonymize.
  const ordered = [...report.characters].sort((a, b) =>
    a.memberId.localeCompare(b.memberId),
  );
  const idMap = new Map(
    ordered.map((row, index) => [
      row.memberId,
      `member-${String(index + 1).padStart(3, "0")}`,
    ]),
  );
  const remapId = (id: string) => idMap.get(id) ?? id;

  const characters: PerCharacterCalibrationResult[] = ordered.map((row) => {
    const alias = remapId(row.memberId);
    return {
      ...row,
      memberId: alias,
      region: "REDACTED",
      realm: "redacted",
      character: alias,
      displayName: undefined,
      rationale: row.rationale ? "[redacted rationale]" : row.rationale,
      snapshotId: row.snapshotId ? `snap-${alias}` : null,
    };
  });

  const comparison = anonymizeComparison(report.activeDraftComparison, remapId);

  return {
    ...report,
    characters,
    validationFailures: report.validationFailures.map((v) => ({
      ...v,
      memberId: v.memberId ? remapId(v.memberId) : null,
    })),
    activeDraftComparison: comparison,
    statistics: {
      ...report.statistics,
      monotonicOrdering: {
        ...report.statistics.monotonicOrdering,
        inversions: report.statistics.monotonicOrdering.inversions.map((inv) => ({
          ...inv,
          higherExpectedId: remapId(inv.higherExpectedId),
          lowerExpectedId: remapId(inv.lowerExpectedId),
        })),
      },
      outliers: report.statistics.outliers.map((o) => ({
        ...o,
        memberId: remapId(o.memberId),
      })),
      confidenceVersusCoverage: report.statistics.confidenceVersusCoverage.map((p) => ({
        ...p,
        memberId: remapId(p.memberId),
      })),
    },
  };
}

function anonymizeComparison(
  comparison: ActiveDraftComparisonResult | null,
  remapId: (id: string) => string,
): ActiveDraftComparisonResult | null {
  if (!comparison) return null;
  return {
    ...comparison,
    characters: comparison.characters.map((c) => ({
      ...c,
      memberId: remapId(c.memberId),
    })),
    aggregate: comparison.aggregate
      ? {
          ...comparison.aggregate,
          largestPositiveMovers: comparison.aggregate.largestPositiveMovers.map((m) => ({
            ...m,
            memberId: remapId(m.memberId),
          })),
          largestNegativeMovers: comparison.aggregate.largestNegativeMovers.map((m) => ({
            ...m,
            memberId: remapId(m.memberId),
          })),
        }
      : null,
  };
}
