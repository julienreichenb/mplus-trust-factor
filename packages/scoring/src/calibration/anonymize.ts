import type { CalibrationReport, PerCharacterCalibrationResult } from "./types.js";

/** Strip PII / character identity for public-safe artifacts. */
export function anonymizeReport(report: CalibrationReport): CalibrationReport {
  const characters: PerCharacterCalibrationResult[] = report.characters.map((row, index) => {
    const alias = `member-${String(index + 1).padStart(3, "0")}`;
    return {
      ...row,
      region: "REDACTED",
      realm: "redacted",
      character: alias,
      displayName: undefined,
      rationale: row.rationale ? "[redacted rationale]" : row.rationale,
      snapshotId: row.snapshotId ? `snap-${alias}` : null,
    };
  });

  const idMap = new Map(
    report.characters.map((row, index) => [
      row.memberId,
      `member-${String(index + 1).padStart(3, "0")}`,
    ]),
  );

  const remapId = (id: string) => idMap.get(id) ?? id;

  return {
    ...report,
    characters: characters.map((c, index) => ({
      ...c,
      memberId: `member-${String(index + 1).padStart(3, "0")}`,
    })),
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
