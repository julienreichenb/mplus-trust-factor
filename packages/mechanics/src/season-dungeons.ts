/**
 * Active-season dungeon set resolution for Scoring v3.
 * Never treat placeholder-current as a live scoring season.
 */

export interface SeasonDungeonSet {
  seasonSlug: string;
  expectedDungeonCount: number;
  dungeonSlugs: readonly string[];
  source: "configured" | "blizzard" | "raiderio";
  placeholder: boolean;
}

/** Midnight Season 1 Mythic+ pool (canonical slugs). */
export const MIDNIGHT_S1_DUNGEON_SLUGS = [
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "windrunner-spire",
  "algethar-academy",
  "seat-of-the-triumvirate",
  "skyreach",
  "pit-of-saron",
] as const;

export const MIDNIGHT_S1_SEASON: SeasonDungeonSet = {
  seasonSlug: "season-midnight-s1",
  expectedDungeonCount: 8,
  dungeonSlugs: MIDNIGHT_S1_DUNGEON_SLUGS,
  source: "configured",
  placeholder: false,
};

const KNOWN_SEASONS: Record<string, SeasonDungeonSet> = {
  "season-midnight-s1": MIDNIGHT_S1_SEASON,
  "blizzard-season-1": {
    ...MIDNIGHT_S1_SEASON,
    seasonSlug: "blizzard-season-1",
  },
};

const PLACEHOLDER_SLUGS = new Set(["placeholder-current", "auto-current"]);

export function isPlaceholderSeasonSlug(seasonSlug: string): boolean {
  return PLACEHOLDER_SLUGS.has(seasonSlug.trim().toLowerCase());
}

/**
 * Resolve the canonical Scoring v3 season slug.
 * Rejects placeholder/auto slugs and falls back to Midnight S1.
 */
export function resolveCanonicalScoringSeasonSlug(override?: string | null): string {
  const slug = override?.trim();
  if (slug && !isPlaceholderSeasonSlug(slug)) {
    return slug;
  }
  return MIDNIGHT_S1_SEASON.seasonSlug;
}

/**
 * Resolve the dungeon set used for eight-run selection.
 * Rejects placeholder seasons unless `allowPlaceholder` is explicitly true (tests only).
 */
export function resolveSeasonDungeonSet(input: {
  seasonSlug: string;
  dungeonSlugs?: readonly string[];
  expectedDungeonCount?: number;
  source?: SeasonDungeonSet["source"];
  allowPlaceholder?: boolean;
}): SeasonDungeonSet {
  const slug = input.seasonSlug.trim();
  if (!slug) {
    throw new Error("seasonSlug is required");
  }
  if (isPlaceholderSeasonSlug(slug) && !input.allowPlaceholder) {
    throw new Error(
      `Refusing placeholder season "${slug}" for Scoring v3 selection — resolve a live season first`,
    );
  }

  if (input.dungeonSlugs && input.dungeonSlugs.length > 0) {
    const unique = [...new Set(input.dungeonSlugs.map((s) => s.toLowerCase()))];
    return {
      seasonSlug: slug,
      expectedDungeonCount: input.expectedDungeonCount ?? unique.length,
      dungeonSlugs: unique,
      source: input.source ?? "configured",
      placeholder: isPlaceholderSeasonSlug(slug),
    };
  }

  const known = KNOWN_SEASONS[slug.toLowerCase()];
  if (known) {
    return { ...known, seasonSlug: slug };
  }

  const count = input.expectedDungeonCount ?? 8;
  return {
    seasonSlug: slug,
    expectedDungeonCount: count,
    dungeonSlugs: [],
    source: input.source ?? "configured",
    placeholder: isPlaceholderSeasonSlug(slug),
  };
}
