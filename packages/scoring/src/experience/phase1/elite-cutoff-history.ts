/**
 * Experience Phase 1 — historical Mythic+ seasonal top 0.1% Hero title evidence.
 *
 * Provider-free pure logic. Matches Blizzard character achievements against a
 * hand-verified elite cutoff catalog. No age decay, no score, no production wiring.
 */

import type { BlizzardCharacterAchievementsDTO } from "@mplus/contracts";

export const ELITE_CUTOFF_CATALOG_VERSION = "elite-cutoff-catalog-v1" as const;

export interface EliteCutoffCatalogEntry {
  achievementId: number;
  seasonSlug: string;
  title: string;
  topPercent: 0.1;
}

/**
 * Hand-verified Mythic+ regional top 0.1% seasonal Hero FoS only.
 *
 * Sources (Wowhead achievement pages / nether tooltip payloads, 2026-08-08):
 * - 16429 https://www.wowhead.com/achievement=16429/thundering-hero-dragonflight-season-1
 * - 17846 nether.wowhead.com/tooltip/achievement/17846 (Smoldering Hero: DF S2)
 * - 19449 https://www.wowhead.com/achievement=19449/dreaming-hero-dragonflight-season-3
 * - 19785 https://www.wowhead.com/achievement=19785/draconic-hero-dragonflight-season-4
 * - 20589 https://www.wowhead.com/achievement=20589/tempered-hero-the-war-within-season-1
 * - 40954 https://www.wowhead.com/achievement=40954/enterprising-hero-the-war-within-season-two
 * - 42174 https://www.wowhead.com/achievement=42174/unbound-hero-the-war-within-season-three
 *
 * Each verified description: end the season with Mythic+ rating in the top 0.1%
 * of players in the region. Keystone Master/Hero/Legend milestones are excluded.
 */
export const ELITE_CUTOFF_CATALOG_V1: readonly EliteCutoffCatalogEntry[] = Object.freeze([
  Object.freeze({
    achievementId: 16_429,
    seasonSlug: "season-df-1",
    title: "Thundering Hero: Dragonflight Season 1",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 17_846,
    seasonSlug: "season-df-2",
    title: "Smoldering Hero: Dragonflight Season 2",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 19_449,
    seasonSlug: "season-df-3",
    title: "Dreaming Hero: Dragonflight Season 3",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 19_785,
    seasonSlug: "season-df-4",
    title: "Draconic Hero: Dragonflight Season 4",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 20_589,
    seasonSlug: "season-tww-1",
    title: "Tempered Hero: The War Within Season 1",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 40_954,
    seasonSlug: "season-tww-2",
    title: "Enterprising Hero: The War Within Season Two",
    topPercent: 0.1 as const,
  }),
  Object.freeze({
    achievementId: 42_174,
    seasonSlug: "season-tww-3",
    title: "Unbound Hero: The War Within Season Three",
    topPercent: 0.1 as const,
  }),
]);

export interface EliteCutoffConfirmation {
  achievementId: number;
  seasonSlug: string;
  title: string;
  completedAt: string | null;
}

export interface EliteCutoffHistoryEvidence {
  catalogVersion: typeof ELITE_CUTOFF_CATALOG_VERSION;
  confirmed: EliteCutoffConfirmation[];
  confirmedCount: number;
}

export function getEliteCutoffCatalogEntry(
  achievementId: number,
  catalog: readonly EliteCutoffCatalogEntry[] = ELITE_CUTOFF_CATALOG_V1,
): EliteCutoffCatalogEntry | null {
  return catalog.find((e) => e.achievementId === achievementId) ?? null;
}

function compareConfirmations(a: EliteCutoffConfirmation, b: EliteCutoffConfirmation): number {
  const bySeason = a.seasonSlug.localeCompare(b.seasonSlug);
  if (bySeason !== 0) return bySeason;
  if (a.achievementId !== b.achievementId) return a.achievementId - b.achievementId;
  return a.title.localeCompare(b.title);
}

/**
 * Extract confirmed historical Mythic+ top 0.1% Hero titles from Blizzard achievements.
 * Match by achievement ID only. No age decay, no scoring.
 */
export function extractEliteCutoffHistory(
  achievements: BlizzardCharacterAchievementsDTO,
  catalog: readonly EliteCutoffCatalogEntry[] = ELITE_CUTOFF_CATALOG_V1,
): EliteCutoffHistoryEvidence {
  const byId = new Map<number, EliteCutoffCatalogEntry>();
  for (const entry of catalog) {
    byId.set(entry.achievementId, entry);
  }

  const confirmedById = new Map<number, EliteCutoffConfirmation>();
  for (const row of achievements.achievements ?? []) {
    const entry = byId.get(row.achievementId);
    if (!entry) continue;

    const existing = confirmedById.get(entry.achievementId);
    if (!existing) {
      confirmedById.set(entry.achievementId, {
        achievementId: entry.achievementId,
        seasonSlug: entry.seasonSlug,
        title: entry.title,
        completedAt: row.completedAt,
      });
      continue;
    }

    // Prefer a non-null completedAt when deduplicating identical IDs.
    if (existing.completedAt == null && row.completedAt != null) {
      confirmedById.set(entry.achievementId, {
        ...existing,
        completedAt: row.completedAt,
      });
    }
  }

  const confirmed = [...confirmedById.values()].sort(compareConfirmations);
  return {
    catalogVersion: ELITE_CUTOFF_CATALOG_VERSION,
    confirmed,
    confirmedCount: confirmed.length,
  };
}
