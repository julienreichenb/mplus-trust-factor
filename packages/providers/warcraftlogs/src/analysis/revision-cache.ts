/**
 * In-memory revision cache keyed by report code.
 * Immutable report data is cached until revision increases.
 */
export class ReportRevisionCache {
  private readonly revisions = new Map<string, number>();
  private readonly analyzed = new Set<string>();

  getRevision(reportCode: string): number | undefined {
    return this.revisions.get(reportCode);
  }

  setRevision(reportCode: string, revision: number): void {
    const existing = this.revisions.get(reportCode);
    if (existing !== undefined && existing !== revision) {
      this.invalidateAnalysis(reportCode);
    }
    this.revisions.set(reportCode, revision);
  }

  isRevisionCached(reportCode: string, revision: number): boolean {
    return this.revisions.get(reportCode) === revision;
  }

  analysisKey(reportCode: string, fightId: number, revision: number, analysisVersion: string): string {
    return `${reportCode}:${fightId}:r${revision}:v${analysisVersion}`;
  }

  hasAnalysis(
    reportCode: string,
    fightId: number,
    revision: number,
    analysisVersion: string,
  ): boolean {
    return this.analyzed.has(this.analysisKey(reportCode, fightId, revision, analysisVersion));
  }

  markAnalysis(
    reportCode: string,
    fightId: number,
    revision: number,
    analysisVersion: string,
  ): void {
    this.analyzed.add(this.analysisKey(reportCode, fightId, revision, analysisVersion));
  }

  invalidateAnalysis(reportCode: string): void {
    for (const key of this.analyzed) {
      if (key.startsWith(`${reportCode}:`)) {
        this.analyzed.delete(key);
      }
    }
  }

  clear(): void {
    this.revisions.clear();
    this.analyzed.clear();
  }
}
