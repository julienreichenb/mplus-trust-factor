/** Stable radar dimension order (excludes AUTHENTICITY). */
export const RADAR_DIMENSIONS = [
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
  "RAID",
] as const;

export type RadarDimension = (typeof RADAR_DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<RadarDimension, string> = {
  PERFORMANCE: "Performance",
  SURVIVAL: "Survival",
  UTILITY: "Utility",
  EXPERIENCE: "Experience",
  RAID: "Mythic Raid",
};

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

export function validateCompareCount(count: number): string | null {
  if (count < 2) return "Add at least 2 characters to compare.";
  if (count > 10) return "Comparison supports at most 10 characters.";
  return null;
}
