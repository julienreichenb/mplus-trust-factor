import { SCORING_ACQUISITION_VERSION } from "../orchestration/scoring/run-orchestration/production-ports.js";

export function pickUniqueRaw<T extends { reportRevision: number; acquisitionVersion: string; id: string }>(
  rows: T[],
  preferredRevision: number | null,
): T | "ambiguous" | null {
  if (rows.length === 0) return null;
  const byRevision = new Map<number, T[]>();
  for (const row of rows) {
    const list = byRevision.get(row.reportRevision) ?? [];
    list.push(row);
    byRevision.set(row.reportRevision, list);
  }
  let revision = preferredRevision;
  if (revision == null) {
    if (byRevision.size !== 1) {
      const scoringAll = rows.filter((r) => r.acquisitionVersion === SCORING_ACQUISITION_VERSION);
      if (scoringAll.length === 1) return scoringAll[0]!;
      return "ambiguous";
    }
    revision = [...byRevision.keys()][0]!;
  }
  const atRev = byRevision.get(revision) ?? [];
  if (atRev.length === 0) return null;
  const byAcq = new Map<string, T[]>();
  for (const row of atRev) {
    const list = byAcq.get(row.acquisitionVersion) ?? [];
    list.push(row);
    byAcq.set(row.acquisitionVersion, list);
  }
  if (byAcq.size !== 1) {
    const scoring = byAcq.get(SCORING_ACQUISITION_VERSION);
    if (scoring?.length === 1) return scoring[0]!;
    return "ambiguous";
  }
  const chosen = [...byAcq.values()][0]!;
  if (chosen.length !== 1) return "ambiguous";
  return chosen[0]!;
}
