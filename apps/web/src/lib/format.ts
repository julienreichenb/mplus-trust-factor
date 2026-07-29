/** Stable radar dimension order (excludes AUTHENTICITY). */
export const RADAR_DIMENSIONS = [
  "PERFORMANCE",
  "EXPERIENCE",
  "UTILITY",
  "SURVIVAL",
  "RAID",
] as const;

/** Wave 4 model v3+ — Raid dimension removed from default scoring. */
export const RADAR_DIMENSIONS_V3 = [
  "PERFORMANCE",
  "EXPERIENCE",
  "UTILITY",
  "SURVIVAL",
] as const;

export type RadarDimension = (typeof RADAR_DIMENSIONS)[number];
export type RadarDimensionV3 = (typeof RADAR_DIMENSIONS_V3)[number];

export const DIMENSION_LABELS: Record<RadarDimension, string> = {
  PERFORMANCE: "Performance",
  SURVIVAL: "Survival",
  UTILITY: "Utility",
  EXPERIENCE: "Experience",
  RAID: "Mythic Raid",
};

/** Returns false for default@3 and newer models where Raid is excluded from the UI. */
export function includesRaidDimension(modelVersion: number | null | undefined): boolean {
  return modelVersion == null || modelVersion < 3;
}

export function resolveRadarDimensions(
  modelVersion?: number | null,
): readonly RadarDimension[] {
  return includesRaidDimension(modelVersion)
    ? RADAR_DIMENSIONS
    : (RADAR_DIMENSIONS_V3 as readonly RadarDimension[]);
}

export function filterDimensionsForModel<T extends { dimension: string }>(
  dimensions: T[],
  modelVersion?: number | null,
): T[] {
  if (includesRaidDimension(modelVersion)) return dimensions;
  return dimensions.filter((d) => d.dimension !== "RAID");
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function formatWeight(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

export function canonicalCharacterPath(
  region: string,
  realm: string,
  name: string,
): { region: string; realm: string; name: string } {
  return {
    region: region.trim().toUpperCase(),
    realm: realm.trim().toLowerCase().replace(/\s+/g, "-"),
    name: name.trim(),
  };
}

export function validateCompareCount(
  count: number,
  options: { minimum?: boolean } = {},
): string | null {
  const enforceMinimum = options.minimum ?? true;
  if (enforceMinimum && count < 2) return "Add at least 2 characters to compare.";
  if (count > 10) return "Comparison supports at most 10 characters.";
  return null;
}
