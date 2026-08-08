/**
 * Experience Phase 1 — worker bootstrap for season dates, Raider.IO slug binding,
 * and previous-season population policy sync.
 *
 * Never throws to block worker startup. No WCL / per-character work.
 */

import { randomUUID } from "node:crypto";
import type { Logger } from "@mplus/observability";
import type {
  BlizzardProvider,
  BlizzardSeasonDTO,
  ProviderFetchContext,
  ProviderResult,
  RaiderIoProvider,
  RaiderIoStaticSeason,
  RegionCode,
} from "@mplus/contracts";
import type { Prisma, PrismaClient } from "@mplus/database";
import { seasonAuthoritySlug } from "../season-authority.js";
import {
  synchronizeSeasonPopulationPolicy,
  type SeasonPopulationPolicySyncResult,
} from "./experience-season-population-policy-sync.js";

export type ExperienceSeasonBootstrapBlizzardPort = Pick<
  BlizzardProvider,
  "getMythicKeystoneSeasonIndex" | "getMythicKeystoneSeason"
>;

export type ExperienceSeasonBootstrapRaiderIoPort = Pick<
  RaiderIoProvider,
  "getStaticData" | "getSeasonCutoffs"
>;

export type PersistProviderResultFn = (
  result: ProviderResult<unknown>,
) => Promise<string | null>;

export interface ExperienceSeasonBootstrapRegion {
  code: string;
  id: string;
}

export interface ExperienceSeasonBootstrapInput {
  prisma: Pick<PrismaClient, "season">;
  regions: ExperienceSeasonBootstrapRegion[];
  blizzard: ExperienceSeasonBootstrapBlizzardPort;
  raiderIo: ExperienceSeasonBootstrapRaiderIoPort;
  persistProviderResult: PersistProviderResultFn;
  logger: Pick<Logger, "info" | "warn">;
  /** When false, skip all provider calls (still returns a soft result). */
  allowProviderCalls?: boolean;
  now?: Date;
}

export interface ExperienceSeasonBootstrapRegionResult {
  region: string;
  status: "ok" | "partial" | "skipped" | "failed";
  hydratedSeasonCount: number;
  currentSeasonId: string | null;
  previousSeasonId: string | null;
  currentRaiderIoSlug: string | null;
  previousRaiderIoSlug: string | null;
  policySync: SeasonPopulationPolicySyncResult | null;
  reasons: string[];
}

export interface ExperienceSeasonBootstrapResult {
  status: "ok" | "partial" | "skipped" | "failed";
  staticDataCalls: number;
  seasonIndexCalls: number;
  /** Blizzard season-detail calls used to hydrate start/end timestamps (index has IDs only). */
  seasonDetailCalls: number;
  seasonCutoffsCalls: number;
  wclCalls: number;
  regions: ExperienceSeasonBootstrapRegionResult[];
}

export type RaiderIoSeasonPairResult =
  | {
      ok: true;
      current: RaiderIoStaticSeason;
      /** Null when no chronological previous RIO season exists (still bind current). */
      previous: RaiderIoStaticSeason | null;
      previousReason: string | null;
    }
  | {
      ok: false;
      reason: string;
    };

export type RaiderIoDateMatchResult =
  | { ok: true; season: RaiderIoStaticSeason }
  | { ok: false; reason: string };

/** Max |RIO start − Blizzard start| for start-proximity matching across expansions. */
export const RIO_BLIZZARD_START_PROXIMITY_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Main Raider.IO season slugs only (exclude cutoffs / remix / break-the-meta variants).
 * Examples: season-tww-3, season-mn-1.
 */
export function isCanonicalRaiderIoSeasonSlug(slug: string): boolean {
  return /^season-[a-z]+-\d+$/i.test(slug.trim());
}

function regionKey(code: string): string {
  return code.trim().toUpperCase();
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (value == null || typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Match a Blizzard season to a Raider.IO season by dates.
 * Only canonical RIO season slugs are considered.
 *
 * 1) Unique start within proximity of Blizzard start (ties on equal distance fail closed).
 * 2) Else unique RIO start contained in Blizzard [start, end).
 * Otherwise fail closed.
 */
export function matchBlizzardSeasonToRaiderIoByDates(
  blizzard: {
    startTimestamp: number | null;
    endTimestamp: number | null;
  },
  seasons: readonly RaiderIoStaticSeason[],
): RaiderIoDateMatchResult {
  const bStart = blizzard.startTimestamp;
  if (bStart == null || !Number.isFinite(bStart)) {
    return { ok: false, reason: "BLIZZARD_START_MISSING_FOR_RIO_DATE_MATCH" };
  }
  const bEnd =
    blizzard.endTimestamp != null && Number.isFinite(blizzard.endTimestamp)
      ? blizzard.endTimestamp
      : null;

  const withStarts = seasons.filter(
    (s) => isCanonicalRaiderIoSeasonSlug(s.slug) && parseIsoMs(s.startsAt) != null,
  );
  if (withStarts.length === 0) {
    return { ok: false, reason: "RIO_DATE_MATCH_NO_SEASONS_WITH_START" };
  }

  const proximal = withStarts
    .map((s) => ({ season: s, distance: Math.abs(parseIsoMs(s.startsAt)! - bStart) }))
    .filter((x) => x.distance <= RIO_BLIZZARD_START_PROXIMITY_MS);
  if (proximal.length > 0) {
    let best = Number.POSITIVE_INFINITY;
    for (const x of proximal) {
      if (x.distance < best) best = x.distance;
    }
    const tied = proximal.filter((x) => x.distance === best);
    if (tied.length === 1) {
      return { ok: true, season: tied[0]!.season };
    }
    return { ok: false, reason: "RIO_DATE_MATCH_AMBIGUOUS_START" };
  }

  if (bEnd != null) {
    const contained = withStarts.filter((s) => {
      const rStart = parseIsoMs(s.startsAt)!;
      return rStart >= bStart && rStart < bEnd;
    });
    if (contained.length === 1) {
      return { ok: true, season: contained[0]! };
    }
    if (contained.length > 1) {
      return { ok: false, reason: "RIO_DATE_MATCH_AMBIGUOUS_CONTAINED_START" };
    }
  }

  return { ok: false, reason: "RIO_DATE_MATCH_NONE" };
}

/**
 * Latest season whose start is strictly before currentStart.
 * Ties on identical startTimestamp fail closed (ambiguous).
 * Never uses blizzardSeasonId − 1.
 */
export function pickPreviousSeasonByStartTimestamp<
  T extends { startTimestamp: number | null },
>(currentStartTimestamp: number, candidates: readonly T[]): T | null {
  if (!Number.isFinite(currentStartTimestamp)) return null;
  const eligible = candidates.filter(
    (c): c is T & { startTimestamp: number } =>
      c.startTimestamp != null &&
      Number.isFinite(c.startTimestamp) &&
      c.startTimestamp < currentStartTimestamp,
  );
  if (eligible.length === 0) return null;
  let bestStart = Number.NEGATIVE_INFINITY;
  for (const c of eligible) {
    if (c.startTimestamp > bestStart) bestStart = c.startTimestamp;
  }
  const tied = eligible.filter((c) => c.startTimestamp === bestStart);
  if (tied.length !== 1) return null;
  return tied[0]!;
}

/**
 * Resolve current (isCurrent) and optional previous Raider.IO seasons.
 * Ambiguous current → fail closed.
 * Missing / ambiguous previous does not block current binding.
 */
export function resolveRaiderIoCurrentAndPrevious(
  seasons: readonly RaiderIoStaticSeason[],
): RaiderIoSeasonPairResult {
  const currentMatches = seasons.filter((s) => s.isCurrent === true);
  if (currentMatches.length === 0) {
    return { ok: false, reason: "RIO_NO_CURRENT_SEASON" };
  }
  if (currentMatches.length > 1) {
    return { ok: false, reason: "RIO_AMBIGUOUS_CURRENT_SEASON" };
  }
  const current = currentMatches[0]!;
  const currentStart = parseIsoMs(current.startsAt);
  if (currentStart == null) {
    return { ok: false, reason: "RIO_CURRENT_START_MISSING" };
  }

  const previousEligible = seasons.filter((s) => {
    if (s.slug === current.slug) return false;
    const start = parseIsoMs(s.startsAt);
    return start != null && start < currentStart;
  });
  if (previousEligible.length === 0) {
    return {
      ok: true,
      current,
      previous: null,
      previousReason: "RIO_NO_PREVIOUS_SEASON",
    };
  }

  let bestStart = Number.NEGATIVE_INFINITY;
  for (const s of previousEligible) {
    const start = parseIsoMs(s.startsAt)!;
    if (start > bestStart) bestStart = start;
  }
  const tied = previousEligible.filter((s) => parseIsoMs(s.startsAt) === bestStart);
  if (tied.length !== 1) {
    return {
      ok: true,
      current,
      previous: null,
      previousReason: "RIO_AMBIGUOUS_PREVIOUS_SEASON",
    };
  }

  return { ok: true, current, previous: tied[0]!, previousReason: null };
}

async function upsertSeasonDates(input: {
  prisma: Pick<PrismaClient, "season">;
  regionId: string;
  dto: BlizzardSeasonDTO;
}): Promise<{ id: string; created: boolean }> {
  const slug = seasonAuthoritySlug(input.dto.blizzardSeasonId);
  const existing = await input.prisma.season.findFirst({
    where: { regionId: input.regionId, slug },
    select: { id: true, startsAt: true, endsAt: true, blizzardSeasonId: true },
  });

  const startsAt =
    input.dto.startTimestamp != null && Number.isFinite(input.dto.startTimestamp)
      ? new Date(input.dto.startTimestamp)
      : undefined;
  const endsAt =
    input.dto.endTimestamp != null && Number.isFinite(input.dto.endTimestamp)
      ? new Date(input.dto.endTimestamp)
      : undefined;

  if (existing) {
    const data: Prisma.SeasonUpdateInput = {
      blizzardSeasonId: input.dto.blizzardSeasonId,
    };
    // Only write timestamps when provider supplies them — never clear existing dates.
    if (startsAt) data.startsAt = startsAt;
    if (endsAt) data.endsAt = endsAt;
    await input.prisma.season.update({ where: { id: existing.id }, data });
    return { id: existing.id, created: false };
  }

  const created = await input.prisma.season.create({
    data: {
      regionId: input.regionId,
      slug,
      name: input.dto.name ?? `Blizzard Season ${input.dto.blizzardSeasonId}`,
      blizzardSeasonId: input.dto.blizzardSeasonId,
      isCurrent: false,
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
      metadata: {},
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Bootstrap Experience season metadata for all provided regions.
 * Soft-fail: never throws for provider/mapping errors.
 */
export async function bootstrapExperienceSeasonMetadata(
  input: ExperienceSeasonBootstrapInput,
): Promise<ExperienceSeasonBootstrapResult> {
  const now = input.now ?? new Date();
  const allowProviderCalls = input.allowProviderCalls !== false;
  const regions: ExperienceSeasonBootstrapRegionResult[] = [];
  let staticDataCalls = 0;
  let seasonIndexCalls = 0;
  let seasonDetailCalls = 0;
  let seasonCutoffsCalls = 0;
  const wclCalls = 0;

  if (!allowProviderCalls || input.regions.length === 0) {
    return {
      status: "skipped",
      staticDataCalls: 0,
      seasonIndexCalls: 0,
      seasonDetailCalls: 0,
      seasonCutoffsCalls: 0,
      wclCalls: 0,
      regions: input.regions.map((r) => ({
        region: regionKey(r.code),
        status: "skipped",
        hydratedSeasonCount: 0,
        currentSeasonId: null,
        previousSeasonId: null,
        currentRaiderIoSlug: null,
        previousRaiderIoSlug: null,
        policySync: null,
        reasons: ["PROVIDER_CALLS_DISABLED_OR_NO_REGIONS"],
      })),
    };
  }

  let rioPair: RaiderIoSeasonPairResult = {
    ok: false,
    reason: "RIO_STATIC_DATA_NOT_LOADED",
  };
  let currentExpansionId: number | null = null;
  let previousExpansionSeasons: RaiderIoStaticSeason[] | null = null;
  let previousExpansionFetchFailed = false;

  const staticCtx: ProviderFetchContext = {
    region: "EU",
    requestId: `experience-season-bootstrap-static:${randomUUID()}`,
    correlationId: null,
    forceRefresh: false,
    now: now.toISOString(),
  };

  try {
    staticDataCalls = 1;
    const staticResult = await input.raiderIo.getStaticData(staticCtx);
    try {
      await input.persistProviderResult(staticResult);
    } catch {
      // Provenance persistence failure must not block bootstrap.
    }
    currentExpansionId = staticResult.data.expansionId;
    rioPair = resolveRaiderIoCurrentAndPrevious(staticResult.data.seasons ?? []);
    if (!rioPair.ok) {
      input.logger.warn(
        {
          event: "experience_season_bootstrap",
          reason: rioPair.reason,
        },
        "experience season bootstrap: Raider.IO season mapping unavailable",
      );
    }
  } catch (error) {
    input.logger.warn(
      {
        event: "experience_season_bootstrap",
        err: error instanceof Error ? { name: error.name, message: error.message } : error,
      },
      "experience season bootstrap: getStaticData failed",
    );
    rioPair = { ok: false, reason: "RIO_STATIC_DATA_FAILED" };
  }

  async function loadPreviousExpansionSeasons(): Promise<RaiderIoStaticSeason[] | null> {
    if (previousExpansionSeasons) return previousExpansionSeasons;
    if (previousExpansionFetchFailed) return null;
    if (currentExpansionId == null || !Number.isFinite(currentExpansionId) || currentExpansionId <= 1) {
      previousExpansionFetchFailed = true;
      return null;
    }
    const previousExpansionId = currentExpansionId - 1;
    try {
      staticDataCalls += 1;
      const previousStatic = await input.raiderIo.getStaticData(staticCtx, {
        expansionId: previousExpansionId,
      });
      try {
        await input.persistProviderResult(previousStatic);
      } catch {
        // ignore provenance write failures
      }
      previousExpansionSeasons = previousStatic.data.seasons ?? [];
      return previousExpansionSeasons;
    } catch (error) {
      previousExpansionFetchFailed = true;
      input.logger.warn(
        {
          event: "experience_season_bootstrap",
          previousExpansionId,
          err: error instanceof Error ? { name: error.name, message: error.message } : error,
        },
        "experience season bootstrap: previous-expansion getStaticData failed",
      );
      return null;
    }
  }

  for (const region of input.regions) {
    const key = regionKey(region.code);
    const reasons: string[] = [];
    let hydratedSeasonCount = 0;
    let currentSeasonId: string | null = null;
    let previousSeasonId: string | null = null;
    let currentRaiderIoSlug: string | null = null;
    let previousRaiderIoSlug: string | null = null;
    let policySync: SeasonPopulationPolicySyncResult | null = null;

    try {
      const ctx: ProviderFetchContext = {
        region: key as RegionCode,
        requestId: `experience-season-bootstrap:${key}:${randomUUID()}`,
        correlationId: null,
        forceRefresh: false,
        now: now.toISOString(),
      };

      seasonIndexCalls += 1;
      const indexResult = await input.blizzard.getMythicKeystoneSeasonIndex(ctx);
      try {
        await input.persistProviderResult(indexResult);
      } catch {
        // ignore provenance write failures
      }

      // Blizzard season index is ID-only; start/end live on season/{id}.
      // Skip detail when the regional Season row already has startsAt (warm LKG).
      const indexSeasons: BlizzardSeasonDTO[] = [];
      for (const indexed of indexResult.data ?? []) {
        if (!Number.isFinite(indexed.blizzardSeasonId)) continue;
        let dto = indexed;
        const needsDetail =
          dto.startTimestamp == null || !Number.isFinite(dto.startTimestamp);
        if (needsDetail) {
          const existingSlug = seasonAuthoritySlug(dto.blizzardSeasonId);
          const existingRow = await input.prisma.season.findFirst({
            where: { regionId: region.id, slug: existingSlug },
            select: { startsAt: true, endsAt: true },
          });
          if (existingRow?.startsAt) {
            dto = {
              ...dto,
              startTimestamp: existingRow.startsAt.getTime(),
              endTimestamp: existingRow.endsAt?.getTime() ?? null,
            };
          } else {
            try {
              seasonDetailCalls += 1;
              const detail = await input.blizzard.getMythicKeystoneSeason(
                dto.blizzardSeasonId,
                ctx,
              );
              try {
                await input.persistProviderResult(detail);
              } catch {
                // ignore provenance write failures
              }
              dto = {
                ...dto,
                ...detail.data,
                blizzardSeasonId: dto.blizzardSeasonId,
              };
            } catch (error) {
              reasons.push(`SEASON_DETAIL_FAILED_${dto.blizzardSeasonId}`);
              input.logger.warn(
                {
                  event: "experience_season_bootstrap",
                  region: key,
                  blizzardSeasonId: dto.blizzardSeasonId,
                  err:
                    error instanceof Error
                      ? { name: error.name, message: error.message }
                      : error,
                },
                "experience season bootstrap: season detail failed — keeping index row",
              );
            }
          }
        }
        indexSeasons.push(dto);
        await upsertSeasonDates({
          prisma: input.prisma,
          regionId: region.id,
          dto,
        });
        hydratedSeasonCount += 1;
      }

      const currentRow = await input.prisma.season.findFirst({
        where: { regionId: region.id, isCurrent: true },
        select: {
          id: true,
          blizzardSeasonId: true,
          startsAt: true,
          providerSeasonId: true,
        },
      });

      if (!currentRow?.blizzardSeasonId) {
        reasons.push("NO_AUTHORITATIVE_CURRENT_SEASON");
        regions.push({
          region: key,
          status: "partial",
          hydratedSeasonCount,
          currentSeasonId: null,
          previousSeasonId: null,
          currentRaiderIoSlug: null,
          previousRaiderIoSlug: null,
          policySync: null,
          reasons,
        });
        continue;
      }

      currentSeasonId = currentRow.id;
      const currentDto = indexSeasons.find(
        (s) => s.blizzardSeasonId === currentRow.blizzardSeasonId,
      );
      const currentStart =
        currentDto?.startTimestamp != null && Number.isFinite(currentDto.startTimestamp)
          ? currentDto.startTimestamp
          : currentRow.startsAt?.getTime() ?? null;

      if (currentStart == null) {
        reasons.push("CURRENT_START_MISSING");
      } else {
        const previousDto = pickPreviousSeasonByStartTimestamp(currentStart, indexSeasons);
        if (!previousDto) {
          reasons.push("NO_PREVIOUS_BLIZZARD_SEASON");
        } else {
          const prevSlug = seasonAuthoritySlug(previousDto.blizzardSeasonId);
          const prevRow = await input.prisma.season.findFirst({
            where: { regionId: region.id, slug: prevSlug },
            select: { id: true, providerSeasonId: true, startsAt: true, endsAt: true },
          });
          previousSeasonId = prevRow?.id ?? null;

          if (rioPair.ok && currentSeasonId) {
            currentRaiderIoSlug = rioPair.current.slug;
            await input.prisma.season.update({
              where: { id: currentSeasonId },
              data: { providerSeasonId: rioPair.current.slug },
            });
            if (rioPair.previousReason) {
              reasons.push(rioPair.previousReason);
            }
            if (previousSeasonId && rioPair.previous) {
              previousRaiderIoSlug = rioPair.previous.slug;
              await input.prisma.season.update({
                where: { id: previousSeasonId },
                data: { providerSeasonId: rioPair.previous.slug },
              });
            } else if (previousSeasonId && !rioPair.previous) {
              // Current-expansion static data cannot resolve previous (e.g. Midnight → TWW).
              const previousExpansion = await loadPreviousExpansionSeasons();
              if (!previousExpansion) {
                reasons.push("PREVIOUS_EXPANSION_STATIC_UNAVAILABLE");
              } else {
                const matched = matchBlizzardSeasonToRaiderIoByDates(
                  {
                    startTimestamp:
                      previousDto.startTimestamp ??
                      prevRow?.startsAt?.getTime() ??
                      null,
                    endTimestamp:
                      previousDto.endTimestamp ?? prevRow?.endsAt?.getTime() ?? null,
                  },
                  previousExpansion,
                );
                if (!matched.ok) {
                  reasons.push(matched.reason);
                } else {
                  previousRaiderIoSlug = matched.season.slug;
                  await input.prisma.season.update({
                    where: { id: previousSeasonId },
                    data: { providerSeasonId: matched.season.slug },
                  });
                  reasons.push("PREVIOUS_RIO_BOUND_VIA_PREVIOUS_EXPANSION");
                }
              }
            } else if (!previousSeasonId) {
              reasons.push("PREVIOUS_SEASON_ROW_MISSING_FOR_RIO_BIND");
            }
          } else if (!rioPair.ok) {
            reasons.push(rioPair.reason);
          }
        }
      }

      if (rioPair.ok && currentSeasonId && currentRaiderIoSlug == null) {
        // Previous Blizzard missing / unresolved, but current RIO can still bind.
        currentRaiderIoSlug = rioPair.current.slug;
        await input.prisma.season.update({
          where: { id: currentSeasonId },
          data: { providerSeasonId: rioPair.current.slug },
        });
        if (rioPair.previousReason && !reasons.includes(rioPair.previousReason)) {
          reasons.push(rioPair.previousReason);
        }
      } else if (!rioPair.ok && !reasons.includes(rioPair.reason)) {
        reasons.push(rioPair.reason);
      }

      // Reload previous providerSeasonId after bind (or existing LKG slug).
      let previousSlugForSync: string | null = previousRaiderIoSlug;
      if (previousSeasonId && !previousSlugForSync) {
        const reloaded = await input.prisma.season.findUnique({
          where: { id: previousSeasonId },
          select: { providerSeasonId: true },
        });
        previousSlugForSync = reloaded?.providerSeasonId ?? null;
      }

      if (previousSeasonId && previousSlugForSync) {
        seasonCutoffsCalls += 1;
        policySync = await synchronizeSeasonPopulationPolicy({
          prisma: input.prisma,
          seasonId: previousSeasonId,
          regionCode: key,
          raiderIoSeasonSlug: previousSlugForSync,
          raiderIo: input.raiderIo,
          ctx,
          persistProviderResult: input.persistProviderResult,
          now,
        });
        if (
          policySync.status === "PROVIDER_FAILURE" ||
          policySync.status === "PROVIDER_PERSISTENCE_FAILED" ||
          policySync.status === "VALIDATION_FAILED"
        ) {
          reasons.push(`POLICY_SYNC_${policySync.status}`);
        }
      } else {
        reasons.push("POLICY_SYNC_SKIPPED_NO_PREVIOUS_RIO_SLUG");
      }

      const status: ExperienceSeasonBootstrapRegionResult["status"] =
        reasons.length === 0
          ? "ok"
          : hydratedSeasonCount > 0 || policySync?.status === "UPDATED" || policySync?.status === "RETAINED_LAST_KNOWN_GOOD"
            ? "partial"
            : "failed";

      regions.push({
        region: key,
        status,
        hydratedSeasonCount,
        currentSeasonId,
        previousSeasonId,
        currentRaiderIoSlug,
        previousRaiderIoSlug,
        policySync,
        reasons,
      });
    } catch (error) {
      input.logger.warn(
        {
          event: "experience_season_bootstrap",
          region: key,
          err: error instanceof Error ? { name: error.name, message: error.message } : error,
        },
        "experience season bootstrap: region failed",
      );
      regions.push({
        region: key,
        status: "failed",
        hydratedSeasonCount,
        currentSeasonId,
        previousSeasonId,
        currentRaiderIoSlug,
        previousRaiderIoSlug,
        policySync,
        reasons: [
          ...reasons,
          error instanceof Error ? error.message : "REGION_BOOTSTRAP_FAILED",
        ],
      });
    }
  }

  const anyOk = regions.some((r) => r.status === "ok" || r.status === "partial");
  const allFailed = regions.length > 0 && regions.every((r) => r.status === "failed");
  return {
    status: allFailed ? "failed" : anyOk ? (regions.every((r) => r.status === "ok") ? "ok" : "partial") : "skipped",
    staticDataCalls,
    seasonIndexCalls,
    seasonDetailCalls,
    seasonCutoffsCalls,
    wclCalls,
    regions,
  };
}

/**
 * Soft-fail worker entry: never throws.
 */
export async function runExperienceSeasonBootstrapSafe(
  input: ExperienceSeasonBootstrapInput,
): Promise<ExperienceSeasonBootstrapResult> {
  try {
    const result = await bootstrapExperienceSeasonMetadata(input);
    input.logger.info(
      {
        event: "experience_season_bootstrap",
        status: result.status,
        staticDataCalls: result.staticDataCalls,
        seasonIndexCalls: result.seasonIndexCalls,
        seasonDetailCalls: result.seasonDetailCalls,
        seasonCutoffsCalls: result.seasonCutoffsCalls,
        wclCalls: result.wclCalls,
        regions: result.regions.map((r) => ({
          region: r.region,
          status: r.status,
          previousSeasonId: r.previousSeasonId,
          previousRaiderIoSlug: r.previousRaiderIoSlug,
          policySyncStatus: r.policySync?.status ?? null,
          reasons: r.reasons,
        })),
      },
      `experience season bootstrap: ${result.status}`,
    );
    return result;
  } catch (error) {
    input.logger.warn(
      {
        event: "experience_season_bootstrap",
        err: error instanceof Error ? { name: error.name, message: error.message } : error,
      },
      "experience season bootstrap failed — continuing worker startup",
    );
    return {
      status: "failed",
      staticDataCalls: 0,
      seasonIndexCalls: 0,
      seasonDetailCalls: 0,
      seasonCutoffsCalls: 0,
      wclCalls: 0,
      regions: [],
    };
  }
}
