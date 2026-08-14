import { randomUUID } from "node:crypto";
import type { Logger } from "@mplus/observability";
import type { BlizzardProvider, RegionCode } from "@mplus/contracts";
import type { PrismaClient, Season } from "@mplus/database";
import { DEFAULT_TTL_SECONDS } from "@mplus/provider-blizzard";
import { ensureBlizzardCurrentSeason } from "../persistence/run-repository.js";
import type { PrismaClientOrTx } from "../persistence/shared.js";
import { ensureRegion } from "../persistence/realm-repository.js";

/** Validity window for a verified regional season — matches Blizzard season-index TTL. */
export const SEASON_AUTHORITY_VALIDITY_SECONDS = DEFAULT_TTL_SECONDS.seasonIndex;

export type SeasonAuthoritySource = "season_index.current_season";

export interface VerifiedSeasonAuthority {
  regionCode: string;
  regionId: string;
  seasonRowId: string;
  blizzardSeasonId: number;
  slug: string;
  authoritySource: SeasonAuthoritySource;
  authorityVerifiedAt: Date;
  /** Where this snapshot was obtained for this call. */
  resolution: "memory" | "database" | "provider";
}

export class SeasonAuthorityUnavailableError extends Error {
  readonly code = "SEASON_AUTHORITY_UNAVAILABLE";
  readonly regionCode: string;
  readonly retryAfterSeconds: number;

  constructor(regionCode: string, message?: string, retryAfterSeconds = 60) {
    super(message ?? `Season authority unavailable for region ${regionCode}`);
    this.name = "SeasonAuthorityUnavailableError";
    this.regionCode = regionCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SeasonAuthorityDeps {
  prisma: PrismaClientOrTx;
  blizzard: BlizzardProvider;
  logger: Logger;
  now?: () => Date;
  validitySeconds?: number;
}

interface MemoryEntry {
  authority: VerifiedSeasonAuthority;
  expiresAtMs: number;
}

const memoryByRegion = new Map<string, MemoryEntry>();
const inflightByRegion = new Map<string, Promise<VerifiedSeasonAuthority>>();

export function clearSeasonAuthorityCacheForTests(): void {
  memoryByRegion.clear();
  inflightByRegion.clear();
}

export function seasonAuthoritySlug(blizzardSeasonId: number): string {
  return `blizzard-season-${blizzardSeasonId}`;
}

/** Technical / fixture Season slugs that must never be product scoring seasons. */
export function isNonProductSeasonSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const s = slug.trim().toLowerCase();
  if (s === "auto-current" || s === "placeholder-current" || s.startsWith("placeholder")) {
    return true;
  }
  if (s === "pub-cancel-season" || s.startsWith("pub-cancel-season-")) {
    return true;
  }
  return false;
}

function regionKey(regionCode: string): string {
  return regionCode.trim().toUpperCase();
}

function readMetadata(season: Season): Record<string, unknown> {
  if (season.metadata && typeof season.metadata === "object" && !Array.isArray(season.metadata)) {
    return season.metadata as Record<string, unknown>;
  }
  return {};
}

/** Parse authority verification fields from a persisted Season row. */
export function parseSeasonAuthorityMetadata(season: Season): {
  blizzardSeasonId: number | null;
  authoritySource: string | null;
  authorityVerifiedAt: Date | null;
} {
  const meta = readMetadata(season);
  const blizzardSeasonId =
    typeof season.blizzardSeasonId === "number"
      ? season.blizzardSeasonId
      : typeof meta.blizzardSeasonId === "number"
        ? meta.blizzardSeasonId
        : null;
  const authoritySource =
    typeof meta.authoritySource === "string"
      ? meta.authoritySource
      : typeof meta.source === "string"
        ? meta.source
        : null;
  const rawVerified =
    typeof meta.authorityVerifiedAt === "string"
      ? meta.authorityVerifiedAt
      : typeof meta.verifiedAt === "string"
        ? meta.verifiedAt
        : null;
  const authorityVerifiedAt = rawVerified ? new Date(rawVerified) : null;
  return {
    blizzardSeasonId,
    authoritySource,
    authorityVerifiedAt:
      authorityVerifiedAt && Number.isFinite(authorityVerifiedAt.getTime())
        ? authorityVerifiedAt
        : null,
  };
}

function isAuthoritativeSource(source: string | null): source is SeasonAuthoritySource {
  return source === "season_index.current_season";
}

function isWithinValidity(
  verifiedAt: Date,
  now: Date,
  validitySeconds: number,
): boolean {
  const ageMs = now.getTime() - verifiedAt.getTime();
  return ageMs >= 0 && ageMs <= validitySeconds * 1000;
}

function toAuthority(
  season: Season,
  regionCode: string,
  parsed: {
    blizzardSeasonId: number;
    authoritySource: SeasonAuthoritySource;
    authorityVerifiedAt: Date;
  },
  resolution: VerifiedSeasonAuthority["resolution"],
): VerifiedSeasonAuthority {
  return {
    regionCode: regionKey(regionCode),
    regionId: season.regionId ?? "",
    seasonRowId: season.id,
    blizzardSeasonId: parsed.blizzardSeasonId,
    slug: season.slug,
    authoritySource: parsed.authoritySource,
    authorityVerifiedAt: parsed.authorityVerifiedAt,
    resolution,
  };
}

function remember(authority: VerifiedSeasonAuthority, validitySeconds: number, now: Date): void {
  memoryByRegion.set(regionKey(authority.regionCode), {
    authority,
    expiresAtMs: now.getTime() + validitySeconds * 1000,
  });
}

/**
 * Read-only peek: prefer a still-valid DB authority over process memory so
 * another process (e.g. API admin season sync) can repair seasons without
 * requiring a worker restart. Memory is only a same-process fast path when it
 * matches the current DB row. Never calls Blizzard.
 */
export async function peekVerifiedSeasonAuthority(
  deps: Pick<SeasonAuthorityDeps, "prisma" | "now" | "validitySeconds">,
  regionCode: string,
  regionId: string,
): Promise<VerifiedSeasonAuthority | null> {
  const now = deps.now?.() ?? new Date();
  const validitySeconds = deps.validitySeconds ?? SEASON_AUTHORITY_VALIDITY_SECONDS;
  const key = regionKey(regionCode);
  const mem = memoryByRegion.get(key);

  const season = await deps.prisma.season.findFirst({
    where: { regionId, isCurrent: true },
  });

  const dbAuthority = season ? authorityFromSeasonRow(season, regionCode, now, validitySeconds) : null;
  if (dbAuthority) {
    const memoryStale =
      !mem ||
      mem.expiresAtMs <= now.getTime() ||
      mem.authority.regionId !== regionId ||
      mem.authority.blizzardSeasonId !== dbAuthority.blizzardSeasonId ||
      mem.authority.slug !== dbAuthority.slug ||
      mem.authority.authorityVerifiedAt.getTime() < dbAuthority.authorityVerifiedAt.getTime();

    if (memoryStale) {
      remember(dbAuthority, validitySeconds, now);
      return { ...dbAuthority, resolution: "database" };
    }
    return { ...mem!.authority, resolution: "memory" };
  }

  if (mem && mem.expiresAtMs > now.getTime() && mem.authority.regionId === regionId) {
    return { ...mem.authority, resolution: "memory" };
  }
  return null;
}

function authorityFromSeasonRow(
  season: Season,
  regionCode: string,
  now: Date,
  validitySeconds: number,
): VerifiedSeasonAuthority | null {
  const parsed = parseSeasonAuthorityMetadata(season);
  if (
    parsed.blizzardSeasonId == null ||
    !isAuthoritativeSource(parsed.authoritySource) ||
    !parsed.authorityVerifiedAt ||
    !isWithinValidity(parsed.authorityVerifiedAt, now, validitySeconds)
  ) {
    return null;
  }

  if (season.slug !== seasonAuthoritySlug(parsed.blizzardSeasonId)) {
    return null;
  }

  return toAuthority(
    season,
    regionCode,
    {
      blizzardSeasonId: parsed.blizzardSeasonId,
      authoritySource: parsed.authoritySource,
      authorityVerifiedAt: parsed.authorityVerifiedAt,
    },
    "database",
  );
}

/**
 * Resolve Blizzard current_season, persist, and cache.
 * Concurrent calls for the same region share one in-flight provider request.
 */
export async function synchronizeSeasonAuthority(
  deps: SeasonAuthorityDeps,
  regionCode: string,
  regionId: string,
  opts: { forceRefresh?: boolean; correlationId?: string | null } = {},
): Promise<VerifiedSeasonAuthority> {
  const key = regionKey(regionCode);
  const existing = inflightByRegion.get(key);
  if (existing && !opts.forceRefresh) return existing;

  const pending = (async (): Promise<VerifiedSeasonAuthority> => {
    const now = deps.now?.() ?? new Date();
    const validitySeconds = deps.validitySeconds ?? SEASON_AUTHORITY_VALIDITY_SECONDS;

    if (!opts.forceRefresh) {
      const peeked = await peekVerifiedSeasonAuthority(deps, regionCode, regionId);
      if (peeked) {
        deps.logger.info(
          {
            event: "season_authority_ready",
            readiness: "cached_authority",
            region: key,
            authoritativeSeasonId: peeked.blizzardSeasonId,
            authoritativeSeasonSlug: peeked.slug,
            authoritySource: peeked.authoritySource,
            authorityVerifiedAt: peeked.authorityVerifiedAt.toISOString(),
            resolution: peeked.resolution,
          },
          "season authority using still-valid cached authority",
        );
        return peeked;
      }
    }

    const previous = await deps.prisma.season.findFirst({
      where: { regionId, isCurrent: true },
      select: { id: true, slug: true, blizzardSeasonId: true },
    });

    const ctx = {
      region: regionCode.toLowerCase() as RegionCode,
      requestId: opts.correlationId ?? randomUUID(),
      correlationId: opts.correlationId ?? null,
      forceRefresh: opts.forceRefresh ?? false,
      now: now.toISOString(),
    };

    let seasonId: number;
    let source: string;
    let slug: string;
    try {
      const result = await deps.blizzard.resolveAuthoritativeCurrentSeasonId(ctx);
      seasonId = result.data.seasonId;
      source = result.data.source;
      slug = result.data.slug;
    } catch (error) {
      deps.logger.warn(
        {
          event: "season_authority_ready",
          readiness: "unavailable",
          region: key,
          err: error instanceof Error ? { name: error.name, message: error.message } : error,
        },
        "season authority temporarily unavailable — refresh enqueue disabled",
      );
      throw new SeasonAuthorityUnavailableError(key);
    }

    if (source !== "season_index.current_season") {
      deps.logger.warn(
        {
          event: "season_authority_ready",
          readiness: "unavailable",
          region: key,
          authoritySource: source,
          reason: "non_authoritative_source",
        },
        "season authority rejected non-current_season source",
      );
      throw new SeasonAuthorityUnavailableError(
        key,
        `Authoritative season source must be season_index.current_season (got ${source})`,
      );
    }

    const verifiedAt = deps.now?.() ?? new Date();
    const season = await ensureBlizzardCurrentSeason(
      deps.prisma,
      regionId,
      seasonId,
      {
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: verifiedAt,
      },
    );

    const authority = toAuthority(
      season,
      regionCode,
      {
        blizzardSeasonId: seasonId,
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: verifiedAt,
      },
      "provider",
    );
    remember(authority, validitySeconds, verifiedAt);

    deps.logger.info(
      {
        event: "season_authority_ready",
        readiness: "verified",
        region: key,
        authoritativeSeasonId: seasonId,
        authoritativeSeasonSlug: slug,
        authoritySource: "season_index.current_season",
        authorityVerifiedAt: verifiedAt.toISOString(),
        previousDatabaseSeasonId: previous?.blizzardSeasonId ?? null,
        previousDatabaseSeasonSlug: previous?.slug ?? null,
        resultingDatabaseSeasonId: season.id,
        resultingDatabaseSeasonSlug: season.slug,
      },
      "season authority verified",
    );

    return authority;
  })().finally(() => {
    inflightByRegion.delete(key);
  });

  inflightByRegion.set(key, pending);
  return pending;
}

/**
 * Require a verified regional season for refresh-contract / enqueue paths.
 * When `allowProviderSync` is false (profile reads), never hits Blizzard.
 */
export async function requireVerifiedSeasonAuthority(
  deps: SeasonAuthorityDeps,
  regionCode: string,
  regionId: string,
  opts: { allowProviderSync?: boolean; forceRefresh?: boolean; correlationId?: string | null } = {},
): Promise<VerifiedSeasonAuthority> {
  const allowProviderSync = opts.allowProviderSync ?? false;
  const peeked = await peekVerifiedSeasonAuthority(deps, regionCode, regionId);
  if (peeked) return peeked;

  if (!allowProviderSync) {
    deps.logger.info(
      {
        event: "season_authority_ready",
        readiness: "unavailable",
        region: regionKey(regionCode),
        reason: "unverified_no_provider_sync",
      },
      "season authority temporarily unavailable — refresh enqueue disabled",
    );
    throw new SeasonAuthorityUnavailableError(regionKey(regionCode));
  }

  return synchronizeSeasonAuthority(deps, regionCode, regionId, {
    forceRefresh: opts.forceRefresh,
    correlationId: opts.correlationId,
  });
}

export interface BootstrapSeasonAuthorityResult {
  region: string;
  status: "verified" | "cached_authority" | "unavailable";
  authority: VerifiedSeasonAuthority | null;
}

/**
 * Bootstrap / ops entry: synchronize enabled regions without throwing.
 * Prefer DB cache within TTL so API+worker startups do not double-call Blizzard.
 */
export async function bootstrapSeasonAuthorityForRegions(
  deps: SeasonAuthorityDeps,
  regions: Array<{ code: string; id: string }>,
): Promise<BootstrapSeasonAuthorityResult[]> {
  const results: BootstrapSeasonAuthorityResult[] = [];
  for (const region of regions) {
    try {
      const before = await peekVerifiedSeasonAuthority(deps, region.code, region.id);
      const authority = before
        ? before
        : await synchronizeSeasonAuthority(deps, region.code, region.id);
      results.push({
        region: regionKey(region.code),
        status: authority.resolution === "provider" ? "verified" : "cached_authority",
        authority,
      });
    } catch {
      results.push({
        region: regionKey(region.code),
        status: "unavailable",
        authority: null,
      });
    }
  }
  return results;
}

/** Load region rows that exist in the DB for bootstrap. */
export async function listPersistedRegionsForAuthority(
  prisma: PrismaClient,
): Promise<Array<{ code: string; id: string }>> {
  const rows = await prisma.region.findMany({
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });
  return rows.map((r) => ({ id: r.id, code: r.code }));
}

/**
 * Ops repair: ensure region exists, synchronize authority, report old→new.
 * Idempotent; does not enqueue score refreshes or WCL calls.
 */
export async function repairSeasonAuthority(
  deps: SeasonAuthorityDeps,
  regionCode: string,
): Promise<{
  region: string;
  previous: { blizzardSeasonId: number | null; slug: string | null };
  current: VerifiedSeasonAuthority;
  changed: boolean;
}> {
  const region = await ensureRegion(deps.prisma, regionCode);
  const previous = await deps.prisma.season.findFirst({
    where: { regionId: region.id, isCurrent: true },
    select: { blizzardSeasonId: true, slug: true },
  });
  const current = await synchronizeSeasonAuthority(deps, region.code, region.id, {
    forceRefresh: true,
  });
  return {
    region: regionKey(region.code),
    previous: {
      blizzardSeasonId: previous?.blizzardSeasonId ?? null,
      slug: previous?.slug ?? null,
    },
    current,
    changed:
      previous?.blizzardSeasonId !== current.blizzardSeasonId ||
      previous?.slug !== current.slug,
  };
}
