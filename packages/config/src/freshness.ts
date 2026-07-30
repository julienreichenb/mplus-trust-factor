import type { AppEnv } from "./index.js";

/** Dataset identifiers for provider-specific freshness windows. */
export type FreshnessDataset =
  | "blizzard.character_profile"
  | "blizzard.equipment"
  | "blizzard.talents"
  | "blizzard.seasonal_runs"
  | "raiderio.profile"
  | "wcl.zone_rankings"
  | "wcl.recent_report_discovery"
  | "wcl.report_master"
  | "wcl.combat_events"
  | "normalized.run_analysis"
  | "calculated.score_snapshot";

export interface FreshnessConfig {
  version: string;
  datasets: Record<FreshnessDataset, number>;
}

export const FRESHNESS_CONFIG_VERSION = "2026-07-29";

/** Centralized dataset-specific TTLs (seconds). Immutable report data gets long TTLs. */
export function buildFreshnessConfig(
  env: Pick<
    AppEnv,
    | "BLIZZARD_CHARACTER_TTL_SECONDS"
    | "WCL_CHARACTER_TTL_SECONDS"
    | "RAIDERIO_CHARACTER_TTL_SECONDS"
    | "SCORE_TTL_SECONDS"
  >,
): FreshnessConfig {
  return {
    version: FRESHNESS_CONFIG_VERSION,
    datasets: {
      "blizzard.character_profile": env.BLIZZARD_CHARACTER_TTL_SECONDS,
      "blizzard.equipment": Math.min(env.BLIZZARD_CHARACTER_TTL_SECONDS, 43_200),
      "blizzard.talents": Math.min(env.BLIZZARD_CHARACTER_TTL_SECONDS, 43_200),
      "blizzard.seasonal_runs": env.BLIZZARD_CHARACTER_TTL_SECONDS,
      "raiderio.profile": env.RAIDERIO_CHARACTER_TTL_SECONDS,
      "wcl.zone_rankings": env.WCL_CHARACTER_TTL_SECONDS,
      "wcl.recent_report_discovery": env.WCL_CHARACTER_TTL_SECONDS,
      "wcl.report_master": 2_592_000, // 30 days — report metadata is immutable
      "wcl.combat_events": 2_592_000, // 30 days — fight events are immutable
      "normalized.run_analysis": 604_800, // 7 days — invalidated by analyzer/catalog version
      // Published Trust Score freshness — distinct from provider TTLs (default 7 days).
      "calculated.score_snapshot": env.SCORE_TTL_SECONDS,
    },
  };
}

export function ttlForDataset(
  config: FreshnessConfig,
  dataset: FreshnessDataset,
): number {
  return config.datasets[dataset];
}

export function isDatasetFresh(
  fetchedAt: Date | string | null | undefined,
  dataset: FreshnessDataset,
  config: FreshnessConfig,
  nowMs = Date.now(),
): boolean {
  if (!fetchedAt) return false;
  const at = typeof fetchedAt === "string" ? new Date(fetchedAt).getTime() : fetchedAt.getTime();
  const ttlMs = ttlForDataset(config, dataset) * 1000;
  return nowMs - at <= ttlMs;
}
