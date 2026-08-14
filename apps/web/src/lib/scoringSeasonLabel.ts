/** Canonical admin display: "Blizzard Season 17 / Blizzard 17". */
export function formatScoringSeasonLabel(input: {
  name?: string | null;
  blizzardSeasonId?: number | null;
}): string {
  if (input.blizzardSeasonId != null && Number.isFinite(input.blizzardSeasonId)) {
    return `Blizzard Season ${input.blizzardSeasonId} / Blizzard ${input.blizzardSeasonId}`;
  }
  const name = input.name?.trim();
  return name && name.length > 0 ? name : "Unknown season";
}
