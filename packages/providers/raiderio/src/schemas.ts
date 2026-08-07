import { z } from "zod";

const rankBucketSchema = z
  .object({
    world: z.number().optional(),
    region: z.number().optional(),
    realm: z.number().optional(),
  })
  .passthrough();

const rankValueSchema = z.union([z.number(), rankBucketSchema]);

export const characterProfileSchema = z
  .object({
    name: z.string().min(1),
    region: z.string().min(1),
    realm: z.string().min(1),
    profile_url: z.string().optional(),
    last_crawled_at: z.string().optional(),
    class: z.string().optional(),
    active_spec_name: z.string().optional(),
    active_spec_role: z.string().optional(),
    gear: z.unknown().optional(),
    talents: z.unknown().optional(),
    mythic_plus_scores_by_season: z.array(z.unknown()).optional(),
    mythic_plus_ranks: z
      .object({
        overall: rankValueSchema.optional(),
        class: rankValueSchema.optional(),
        server: z.number().optional(),
        world: z.number().optional(),
        region: z.number().optional(),
        role: z.string().optional(),
      })
      .passthrough()
      .optional(),
    mythic_plus_recent_runs: z.array(z.unknown()).optional(),
    mythic_plus_best_runs: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** Soft node: malformed percentile payload is treated as absent, not whole-response failure. */
const cutoffPopulationSchema = z
  .object({
    quantile: z.number().finite().optional(),
    quantileMinValue: z.number().finite().optional(),
    quantilePopulationCount: z.number().int().nonnegative().optional(),
    quantilePopulationFraction: z.number().finite().optional(),
    totalPopulationCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const cutoffQuantileNodeInner = z
  .object({
    score: z.number().finite().optional(),
    all: cutoffPopulationSchema.optional(),
  })
  .passthrough();

const cutoffQuantileNodeSchema = cutoffQuantileNodeInner.optional().catch(undefined);

export const seasonCutoffsSchema = z
  .object({
    cutoffs: z
      .object({
        updatedAt: z.string().optional(),
        p999: cutoffQuantileNodeSchema,
        p990: cutoffQuantileNodeSchema,
        p900: cutoffQuantileNodeSchema,
        p750: cutoffQuantileNodeSchema,
        p600: cutoffQuantileNodeSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const staticDataSchema = z
  .object({
    seasons: z.array(z.unknown()).optional(),
    dungeons: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const runDetailsSchema = z
  .object({
    season: z.string().optional(),
    keystone_run_id: z.number().optional(),
    mythic_level: z.number().optional(),
    clear_time_ms: z.number().optional(),
    keystone_time_ms: z.number().optional(),
    completed_at: z.string().optional(),
    score: z.number().optional(),
    dungeon: z.unknown().optional(),
    roster: z.array(z.unknown()).optional(),
    url: z.string().optional(),
  })
  .passthrough();

export const periodsSchema = z
  .object({
    periods: z.array(z.unknown()).optional(),
  })
  .passthrough();

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  body: unknown,
  endpointKey: string,
): { ok: true; data: T } | { ok: false; issues: string } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, issues: `Raider.IO ${endpointKey} schema mismatch: ${issues}` };
}
