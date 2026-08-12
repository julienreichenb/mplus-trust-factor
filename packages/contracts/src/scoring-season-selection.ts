/**
 * Platform-wide scoring season selection (RuntimeSetting).
 * Distinct from Blizzard-detected current season (Season.isCurrent).
 */
import { z } from "zod";

export const SCORING_SEASON_SELECTION_KEY = "scoring_season_selection" as const;

export const ScoringSeasonSelectionModeSchema = z.enum(["AUTO", "PINNED"]);
export type ScoringSeasonSelectionMode = z.infer<typeof ScoringSeasonSelectionModeSchema>;

export const ScoringSeasonSelectionAutoSchema = z
  .object({
    mode: z.literal("AUTO"),
  })
  .strict();

export const ScoringSeasonSelectionPinnedSchema = z
  .object({
    mode: z.literal("PINNED"),
    blizzardSeasonId: z.number().int().positive(),
  })
  .strict();

export const ScoringSeasonSelectionSchema = z.discriminatedUnion("mode", [
  ScoringSeasonSelectionAutoSchema,
  ScoringSeasonSelectionPinnedSchema,
]);
export type ScoringSeasonSelection = z.infer<typeof ScoringSeasonSelectionSchema>;

export const DEFAULT_SCORING_SEASON_SELECTION: ScoringSeasonSelection = { mode: "AUTO" };

export function parseScoringSeasonSelection(value: unknown): ScoringSeasonSelection {
  if (value == null) return DEFAULT_SCORING_SEASON_SELECTION;
  return ScoringSeasonSelectionSchema.parse(value);
}

export function tryParseScoringSeasonSelection(
  value: unknown,
): { ok: true; value: ScoringSeasonSelection } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: DEFAULT_SCORING_SEASON_SELECTION };
  const parsed = ScoringSeasonSelectionSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

/** Admin update body — optimistic concurrency on RuntimeSetting.version. */
export const updateScoringSeasonSelectionBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("AUTO"),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("PINNED"),
      blizzardSeasonId: z.number().int().positive(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
]);
export type UpdateScoringSeasonSelectionBody = z.infer<
  typeof updateScoringSeasonSelectionBodySchema
>;

export interface ScoringSeasonOptionDTO {
  id: string;
  slug: string;
  name: string;
  blizzardSeasonId: number | null;
  regionCode: string;
  isBlizzardCurrent: boolean;
  catalogReady: boolean;
  wclZoneId: number | null;
  startsAt: string | null;
  endsAt: string | null;
  /** True only when persisted M+ catalog is complete and validated. */
  pinnable: boolean;
}

export interface ScoringSeasonSelectionStatusDTO {
  selection: ScoringSeasonSelection;
  version: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
  /** Representative region used for detected/effective display. */
  regionCode: string;
  detectedCurrentSeason: {
    id: string;
    slug: string;
    name: string;
    blizzardSeasonId: number | null;
  } | null;
  effectiveScoringSeason: {
    id: string;
    slug: string;
    name: string;
    blizzardSeasonId: number | null;
    wclZoneId: number | null;
    catalogReady: boolean;
  } | null;
  pinnedDiffersFromDetected: boolean;
  seasons: ScoringSeasonOptionDTO[];
}
