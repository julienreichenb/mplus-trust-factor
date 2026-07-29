/**
 * Region / spec fairness so one group cannot consume the entire refresh budget.
 */

export interface FairnessCandidate {
  characterId: string;
  region: string;
  specRole: string | null;
  priority: number;
  estimatedWclPoints: number;
}

export interface FairnessConfig {
  /** Max share of a batch any single region may take (0–1). */
  maxRegionShare: number;
  /** Max share of a batch any single spec/role may take (0–1). */
  maxSpecRoleShare: number;
  /** Absolute min slots reserved when enough candidates exist. */
  minPerRegion?: number;
}

export interface FairnessResult {
  selected: FairnessCandidate[];
  skipped: Array<FairnessCandidate & { reason: "REGION_CAP" | "SPEC_CAP" }>;
  regionCounts: Record<string, number>;
  specCounts: Record<string, number>;
}

export const DEFAULT_FAIRNESS_CONFIG: FairnessConfig = {
  maxRegionShare: 0.5,
  maxSpecRoleShare: 0.4,
  minPerRegion: 1,
};

export function applyFairnessCaps(
  candidates: FairnessCandidate[],
  batchSize: number,
  config: FairnessConfig = DEFAULT_FAIRNESS_CONFIG,
): FairnessResult {
  const selected: FairnessCandidate[] = [];
  const skipped: FairnessResult["skipped"] = [];
  const regionCounts: Record<string, number> = {};
  const specCounts: Record<string, number> = {};

  const maxRegion = Math.max(1, Math.floor(batchSize * config.maxRegionShare));
  const maxSpec = Math.max(1, Math.floor(batchSize * config.maxSpecRoleShare));

  const ordered = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.characterId.localeCompare(b.characterId);
  });

  for (const c of ordered) {
    if (selected.length >= batchSize) {
      skipped.push({ ...c, reason: "REGION_CAP" });
      continue;
    }
    const region = c.region.toUpperCase();
    const spec = c.specRole ?? "UNKNOWN";
    const regionCount = regionCounts[region] ?? 0;
    const specCount = specCounts[spec] ?? 0;

    if (regionCount >= maxRegion) {
      skipped.push({ ...c, reason: "REGION_CAP" });
      continue;
    }
    if (specCount >= maxSpec) {
      skipped.push({ ...c, reason: "SPEC_CAP" });
      continue;
    }

    selected.push(c);
    regionCounts[region] = regionCount + 1;
    specCounts[spec] = specCount + 1;
  }

  return { selected, skipped, regionCounts, specCounts };
}
