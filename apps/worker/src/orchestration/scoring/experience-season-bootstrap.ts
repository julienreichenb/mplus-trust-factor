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
 * Exact Blizzard-id matches remain primary, but both starts present and farther
 * than this → fail closed (reuses 2× proximity from remapped-equivalence proof).
 */
export const RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS =
  RIO_BLIZZARD_START_PROXIMITY_MS * 2;

/**
 * Diagnostic-only: common main-season slug shape (`season-tww-3`, `season-mn-1`).
 * NOT Experience season authority — `is_main_season` / Blizzard id / dates are.
 */
export function isCanonicalRaiderIoSeasonSlug(slug: string): boolean {
  return /^season-[a-z]+-\d+$/i.test(slug.trim());
}

/**
 * Real Mythic+ seasons only. Event/cutoffs/remix (`is_main_season: false`) are excluded.
 * Missing `isMainSeason` fails closed (slug regex is not authority).
 */
export function isRealMythicPlusRaiderIoSeason(
  season: Pick<RaiderIoStaticSeason, "isMainSeason">,
): boolean {
  return season.isMainSeason === true;
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
 * Match a Blizzard season to a Raider.IO real Mythic+ season.
 *
 * When the target Blizzard season id is known:
 * 1) Exact `blizzardSeasonId` match among real main seasons (unique → select).
 * 2) Multiple exact-id candidates → date-disambiguate among ONLY those.
 * 3) No exact-id candidate → date match among ONLY seasons with no usable
 *    `blizzardSeasonId`. Explicitly mismatching ids never win by dates.
 *
 * When the target Blizzard id is unavailable, date matching uses all real
 * main seasons (existing conservative semantics). Event seasons never win.
 */
export function matchBlizzardSeasonToRaiderIoByDates(
  blizzard: {
    startTimestamp: number | null;
    endTimestamp: number | null;
    blizzardSeasonId?: number | null;
  },
  seasons: readonly RaiderIoStaticSeason[],
): RaiderIoDateMatchResult {
  const realSeasons = seasons.filter(isRealMythicPlusRaiderIoSeason);
  if (realSeasons.length === 0) {
    return { ok: false, reason: "RIO_DATE_MATCH_NO_REAL_MAIN_SEASONS" };
  }

  const blizzardId =
    blizzard.blizzardSeasonId != null && Number.isFinite(blizzard.blizzardSeasonId)
      ? blizzard.blizzardSeasonId
      : null;

  if (blizzardId != null) {
    const byId = realSeasons.filter((s) => s.blizzardSeasonId === blizzardId);
    if (byId.length === 1) {
      const candidate = byId[0]!;
      const chronology = assertExactIdChronologyCompatible(blizzard, candidate);
      if (!chronology.ok) return chronology;
      return { ok: true, season: candidate };
    }
    if (byId.length > 1) {
      // Multiple main seasons sharing one Blizzard id (e.g. tww-1 + tww-1-post) —
      // date disambiguation among id matches only.
      return matchByDatesOnly(blizzard, byId);
    }

    // No exact-id hit: never let an explicitly different blizzardSeasonId win by dates.
    const idUnknown = realSeasons.filter(
      (s) => s.blizzardSeasonId == null || !Number.isFinite(s.blizzardSeasonId),
    );
    if (idUnknown.length === 0) {
      return { ok: false, reason: "RIO_DATE_MATCH_EXPLICIT_BLIZZARD_ID_MISMATCH" };
    }
    return matchByDatesOnly(blizzard, idUnknown);
  }

  return matchByDatesOnly(blizzard, realSeasons);
}

/**
 * Unique exact-id candidate: accept when dates missing; fail closed when both
 * starts exist and are absurdly far apart (product proximity × 2).
 */
function assertExactIdChronologyCompatible(
  blizzard: {
    startTimestamp: number | null;
    endTimestamp: number | null;
  },
  rio: Pick<RaiderIoStaticSeason, "startsAt">,
): RaiderIoDateMatchResult | { ok: true } {
  const bStart = blizzard.startTimestamp;
  const rioStart = parseIsoMs(rio.startsAt);
  if (bStart == null || !Number.isFinite(bStart) || rioStart == null) {
    return { ok: true };
  }
  if (Math.abs(rioStart - bStart) > RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS) {
    return {
      ok: false,
      reason: "RIO_DATE_MATCH_EXACT_ID_CHRONOLOGY_ABSURD",
    };
  }
  return { ok: true };
}

/**
 * Revalidate a persisted Season.providerSeasonId against currently available
 * Raider.IO static seasons for a known target Blizzard season id.
 *
 * PROVEN_INCOMPATIBLE — static data shows an explicit Blizzard-id contradiction
 *   (or non-main season); safe to invalidate the persisted slug.
 * COULD_NOT_REVALIDATE — static unavailable / slug not present in loaded pools;
 *   retain LKG slug (do not clear on transient failure).
 * COMPATIBLE — slug points at an acceptable real main season for the target.
 */
export type PersistedRaiderIoSlugRevalidation =
  | {
      status: "COMPATIBLE";
      season: RaiderIoStaticSeason;
    }
  | {
      status: "PROVEN_INCOMPATIBLE";
      reason: string;
    }
  | {
      status: "COULD_NOT_REVALIDATE";
      reason: string;
    };

export function revalidatePersistedRaiderIoSeasonSlug(input: {
  persistedSlug: string;
  targetBlizzardSeasonId: number;
  /** True when at least one RIO static payload was successfully loaded. */
  staticDataAvailable: boolean;
  seasons: readonly RaiderIoStaticSeason[];
}): PersistedRaiderIoSlugRevalidation {
  const slug = input.persistedSlug.trim();
  if (!slug) {
    return { status: "COULD_NOT_REVALIDATE", reason: "BLANK_PERSISTED_RIO_SLUG" };
  }
  if (
    !Number.isFinite(input.targetBlizzardSeasonId) ||
    !input.staticDataAvailable ||
    input.seasons.length === 0
  ) {
    return {
      status: "COULD_NOT_REVALIDATE",
      reason: "RIO_STATIC_UNAVAILABLE_FOR_REVALIDATION",
    };
  }

  const matches = input.seasons.filter((s) => s.slug.trim() === slug);
  if (matches.length === 0) {
    // Slug may live on an unloaded expansion — do not treat as proven bad.
    return {
      status: "COULD_NOT_REVALIDATE",
      reason: "PERSISTED_RIO_SLUG_NOT_IN_LOADED_STATIC",
    };
  }

  // Same slug may appear in current + previous-expansion pools; collapse duplicates.
  const distinct = new Map<string, RaiderIoStaticSeason>();
  for (const season of matches) {
    const key = `${season.isMainSeason === true}|${season.blizzardSeasonId ?? "null"}`;
    distinct.set(key, season);
  }
  if (distinct.size > 1) {
    return {
      status: "COULD_NOT_REVALIDATE",
      reason: "PERSISTED_RIO_SLUG_AMBIGUOUS_IN_STATIC",
    };
  }

  const season = matches[0]!;
  if (season.isMainSeason !== true) {
    return {
      status: "PROVEN_INCOMPATIBLE",
      reason: "PERSISTED_RIO_SLUG_NOT_MAIN_SEASON",
    };
  }
  const rioId = season.blizzardSeasonId;
  if (rioId != null && Number.isFinite(rioId) && rioId !== input.targetBlizzardSeasonId) {
    return {
      status: "PROVEN_INCOMPATIBLE",
      reason: "PERSISTED_RIO_SLUG_EXPLICIT_BLIZZARD_ID_MISMATCH",
    };
  }
  return { status: "COMPATIBLE", season };
}

function matchByDatesOnly(
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

  const withStarts = seasons.filter((s) => parseIsoMs(s.startsAt) != null);
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
 * Resolve current (isCurrent) and optional previous *real* Raider.IO Mythic+ seasons.
 * Event/intermediate seasons never become previous.
 * Ambiguous current → fail closed.
 * Missing / ambiguous previous does not block current binding.
 *
 * Pass `{ unfiltered: true }` only for diagnostics that document the event-season trap.
 */
export function resolveRaiderIoCurrentAndPrevious(
  seasons: readonly RaiderIoStaticSeason[],
  opts: { unfiltered?: boolean } = {},
): RaiderIoSeasonPairResult {
  const pool = opts.unfiltered === true ? seasons : seasons.filter(isRealMythicPlusRaiderIoSeason);
  if (!opts.unfiltered && pool.length === 0 && seasons.length > 0) {
    return { ok: false, reason: "RIO_NO_REAL_MAIN_SEASONS" };
  }

  const currentFromAll = seasons.filter((s) => s.isCurrent === true);
  let current: RaiderIoStaticSeason;
  if (opts.unfiltered === true) {
    if (currentFromAll.length === 0) {
      return { ok: false, reason: "RIO_NO_CURRENT_SEASON" };
    }
    if (currentFromAll.length > 1) {
      return { ok: false, reason: "RIO_AMBIGUOUS_CURRENT_SEASON" };
    }
    current = currentFromAll[0]!;
  } else {
    const realCurrent = currentFromAll.filter(isRealMythicPlusRaiderIoSeason);
    if (realCurrent.length === 0) {
      return { ok: false, reason: "RIO_NO_CURRENT_SEASON" };
    }
    if (realCurrent.length > 1) {
      return { ok: false, reason: "RIO_AMBIGUOUS_CURRENT_SEASON" };
    }
    current = realCurrent[0]!;
  }

  const currentStart = parseIsoMs(current.startsAt);
  if (currentStart == null) {
    return { ok: false, reason: "RIO_CURRENT_START_MISSING" };
  }

  const previousEligible = pool.filter((s) => {
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

/**
 * Narrow proof that a (possibly remapped) Raider.IO cutoff payload refers to the
 * exact intended previous real Mythic+ season from the Blizzard↔RIO binding.
 *
 * Never set `exactTargetSeasonEquivalenceProven=true` without this proof.
 */
export type ExactTargetSeasonEquivalenceProof = {
  proven: boolean;
  reasons: string[];
};

export function proveExactRaiderIoCutoffSeasonEquivalence(input: {
  boundRaiderIoSlug: string;
  blizzardSeasonId: number;
  blizzardStartsAtMs: number | null;
  blizzardEndsAtMs: number | null;
  rioSeason: Pick<
    RaiderIoStaticSeason,
    "slug" | "isMainSeason" | "blizzardSeasonId" | "startsAt" | "endsAt"
  >;
}): ExactTargetSeasonEquivalenceProof {
  const reasons: string[] = [];
  const boundSlug = input.boundRaiderIoSlug.trim();
  const rioSlug = input.rioSeason.slug.trim();

  if (!boundSlug || rioSlug !== boundSlug) {
    reasons.push("RIO_SLUG_MISMATCH_OR_BLANK");
  }
  if (input.rioSeason.isMainSeason !== true) {
    reasons.push("RIO_NOT_MAIN_SEASON");
  }
  if (!Number.isFinite(input.blizzardSeasonId)) {
    reasons.push("BLIZZARD_SEASON_ID_INVALID");
  }

  const rioBlizzardId = input.rioSeason.blizzardSeasonId;
  if (rioBlizzardId != null && Number.isFinite(rioBlizzardId)) {
    if (rioBlizzardId !== input.blizzardSeasonId) {
      reasons.push("RIO_BLIZZARD_SEASON_ID_MISMATCH");
    }
  } else {
    // Missing RIO blizzard id: require chronology compatibility.
    const rioStart = parseIsoMs(input.rioSeason.startsAt);
    const bStart = input.blizzardStartsAtMs;
    if (rioStart == null || bStart == null || !Number.isFinite(bStart)) {
      reasons.push("RIO_BLIZZARD_ID_ABSENT_AND_DATES_INSUFFICIENT");
    } else {
      const proximity = Math.abs(rioStart - bStart);
      const bEnd =
        input.blizzardEndsAtMs != null && Number.isFinite(input.blizzardEndsAtMs)
          ? input.blizzardEndsAtMs
          : null;
      const contained =
        bEnd != null && rioStart >= bStart && rioStart < bEnd;
      if (proximity > RIO_BLIZZARD_START_PROXIMITY_MS && !contained) {
        reasons.push("RIO_BLIZZARD_CHRONOLOGY_INCOMPATIBLE");
      }
    }
  }

  // When RIO supplies matching blizzard id, still reject absurd chronology if both starts exist.
  if (
    rioBlizzardId != null &&
    Number.isFinite(rioBlizzardId) &&
    rioBlizzardId === input.blizzardSeasonId
  ) {
    const rioStart = parseIsoMs(input.rioSeason.startsAt);
    const bStart = input.blizzardStartsAtMs;
    if (rioStart != null && bStart != null && Number.isFinite(bStart)) {
      const proximity = Math.abs(rioStart - bStart);
      if (proximity > RIO_BLIZZARD_EXACT_ID_CHRONOLOGY_MAX_MS) {
        reasons.push("RIO_BLIZZARD_CHRONOLOGY_FAR_FROM_START");
      }
    }
  }

  return { proven: reasons.length === 0, reasons };
}

/**
 * True when a region bootstrap result is sufficient to memoize ensure for this
 * current Blizzard season. Transient / partial binding failures must retry.
 */
export function isExperienceSeasonBindingEnsureComplete(
  region: ExperienceSeasonBootstrapRegionResult,
): boolean {
  if (region.status === "failed" || region.status === "skipped") {
    return false;
  }
  if (!region.currentSeasonId) return false;

  // Hard transient / insufficient outcomes — must retry ensure.
  for (const reason of region.reasons) {
    if (
      reason.startsWith("POLICY_SYNC_PROVIDER_") ||
      reason === "NO_AUTHORITATIVE_CURRENT_SEASON" ||
      reason === "CURRENT_START_MISSING" ||
      reason === "POLICY_SYNC_SKIPPED_NO_PREVIOUS_RIO_SLUG" ||
      reason === "PREVIOUS_SEASON_ROW_MISSING_FOR_RIO_BIND" ||
      reason.includes("RIO_STATIC_DATA") ||
      reason.includes("SEASON_INDEX")
    ) {
      return false;
    }
  }

  // No previous Blizzard season is terminal (nothing left to bind/sync).
  if (region.reasons.includes("NO_PREVIOUS_BLIZZARD_SEASON")) {
    return true;
  }

  if (!region.previousSeasonId || !region.previousRaiderIoSlug) {
    return false;
  }

  const policyStatus = region.policySync?.status ?? null;
  if (
    policyStatus === "PROVIDER_FAILURE" ||
    policyStatus === "PROVIDER_PERSISTENCE_FAILED" ||
    policyStatus === "VALIDATION_FAILED"
  ) {
    return false;
  }

  // UPDATED / RETAINED_LAST_KNOWN_GOOD / NO_USABLE_POLICY are stable enough to skip.
  return (
    policyStatus === "UPDATED" ||
    policyStatus === "RETAINED_LAST_KNOWN_GOOD" ||
    policyStatus === "NO_USABLE_POLICY"
  );
}

/** Process-local last Experience bind ensured for each region's current Blizzard season. */
const lastEnsuredCurrentBlizzardSeasonIdByRegion = new Map<string, number>();

/** Test/reset helper — not for production paths. */
export function resetExperienceSeasonBindingEnsureStateForTests(): void {
  lastEnsuredCurrentBlizzardSeasonIdByRegion.clear();
}

export function peekExperienceSeasonBindingEnsureStateForTests(): ReadonlyMap<string, number> {
  return lastEnsuredCurrentBlizzardSeasonIdByRegion;
}

/**
 * True when Experience historical bind/policy must re-run for this authority current season.
 * Proves long-lived N→N+1 without restart: same process, new current id → ensure again.
 */
export function shouldEnsureExperienceSeasonBinding(input: {
  regionCode: string;
  currentBlizzardSeasonId: number;
  force?: boolean;
}): boolean {
  if (input.force === true) return true;
  if (!Number.isFinite(input.currentBlizzardSeasonId)) return true;
  const key = regionKey(input.regionCode);
  const last = lastEnsuredCurrentBlizzardSeasonIdByRegion.get(key);
  return last !== input.currentBlizzardSeasonId;
}

export function rememberExperienceSeasonBindingEnsured(
  regionCode: string,
  currentBlizzardSeasonId: number,
): void {
  if (!Number.isFinite(currentBlizzardSeasonId)) return;
  lastEnsuredCurrentBlizzardSeasonIdByRegion.set(
    regionKey(regionCode),
    currentBlizzardSeasonId,
  );
}

export interface EnsureExperienceSeasonBindingInput extends ExperienceSeasonBootstrapInput {
  /**
   * Authoritative current Blizzard season id per region code (uppercase).
   * When omitted, bootstrap still runs (startup path) and remembers ids from results when available.
   */
  currentBlizzardSeasonIdByRegion?: ReadonlyMap<string, number> | Record<string, number>;
  force?: boolean;
}

function readCurrentIdMap(
  value: EnsureExperienceSeasonBindingInput["currentBlizzardSeasonIdByRegion"],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!value) return out;
  if (value instanceof Map) {
    for (const [k, v] of value) out.set(regionKey(k), v);
    return out;
  }
  for (const [k, v] of Object.entries(value)) out.set(regionKey(k), v);
  return out;
}

/**
 * Season-level ensure: when canonical current flips N→N+1 (or first touch),
 * re-bind previous real RIO slug + sync population policy for the new previous.
 * Soft-fail. No per-character cutoff fetches.
 */
export async function ensureExperienceSeasonBindingReady(
  input: EnsureExperienceSeasonBindingInput,
): Promise<ExperienceSeasonBootstrapResult | { status: "skipped"; reason: string }> {
  const idByRegion = readCurrentIdMap(input.currentBlizzardSeasonIdByRegion);
  const regionsNeedingEnsure = input.regions.filter((r) => {
    const key = regionKey(r.code);
    const currentId = idByRegion.get(key);
    if (currentId == null) {
      // Unknown current id → run ensure (safe; bootstrap resolves from DB isCurrent).
      return true;
    }
    return shouldEnsureExperienceSeasonBinding({
      regionCode: key,
      currentBlizzardSeasonId: currentId,
      force: input.force,
    });
  });

  if (regionsNeedingEnsure.length === 0) {
    return { status: "skipped", reason: "EXPERIENCE_SEASON_BINDING_ALREADY_ENSURED" };
  }

  const result = await bootstrapExperienceSeasonMetadata({
    ...input,
    regions: regionsNeedingEnsure,
  });

  for (const region of regionsNeedingEnsure) {
    const key = regionKey(region.code);
    const row = result.regions.find((r) => r.region === key);
    if (!row || !isExperienceSeasonBindingEnsureComplete(row)) {
      // Transient / insufficient — do not memoize; next ensure retries.
      continue;
    }
    const fromInput = idByRegion.get(key);
    if (fromInput != null) {
      rememberExperienceSeasonBindingEnsured(key, fromInput);
      continue;
    }
    if (row.currentSeasonId) {
      try {
        const season = await input.prisma.season.findUnique({
          where: { id: row.currentSeasonId },
          select: { blizzardSeasonId: true },
        });
        if (season?.blizzardSeasonId != null) {
          rememberExperienceSeasonBindingEnsured(key, season.blizzardSeasonId);
        }
      } catch {
        // ignore
      }
    }
  }

  return result;
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
  let staticSeasonsForBind: RaiderIoStaticSeason[] = [];
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
    staticSeasonsForBind = staticResult.data.seasons ?? [];
    rioPair = resolveRaiderIoCurrentAndPrevious(staticSeasonsForBind);
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
    let previousRioSeasonForProof: RaiderIoStaticSeason | null = null;
    let previousBlizzardForProof: {
      blizzardSeasonId: number;
      startTimestamp: number | null;
      endTimestamp: number | null;
    } | null = null;
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
          previousBlizzardForProof = {
            blizzardSeasonId: previousDto.blizzardSeasonId,
            startTimestamp: previousDto.startTimestamp,
            endTimestamp: previousDto.endTimestamp,
          };
          const prevSlug = seasonAuthoritySlug(previousDto.blizzardSeasonId);
          const prevRow = await input.prisma.season.findFirst({
            where: { regionId: region.id, slug: prevSlug },
            select: { id: true, providerSeasonId: true, startsAt: true, endsAt: true },
          });
          previousSeasonId = prevRow?.id ?? null;

          if (rioPair.ok && currentSeasonId) {
            // Bind current via Blizzard↔RIO identity; never write a contradicting slug.
            const currentMatched = matchBlizzardSeasonToRaiderIoByDates(
              {
                startTimestamp: currentStart,
                endTimestamp: currentDto?.endTimestamp ?? null,
                blizzardSeasonId: currentRow.blizzardSeasonId,
              },
              staticSeasonsForBind,
            );
            if (currentMatched.ok) {
              currentRaiderIoSlug = currentMatched.season.slug;
              await input.prisma.season.update({
                where: { id: currentSeasonId },
                data: { providerSeasonId: currentRaiderIoSlug },
              });
            } else {
              // Fail closed — do not fall back to rioPair.current when identity failed
              // (especially explicit Blizzard-id mismatch).
              reasons.push(currentMatched.reason);
            }

            if (previousSeasonId) {
              const matchedPrevious = matchBlizzardSeasonToRaiderIoByDates(
                {
                  startTimestamp:
                    previousDto.startTimestamp ??
                    prevRow?.startsAt?.getTime() ??
                    null,
                  endTimestamp:
                    previousDto.endTimestamp ?? prevRow?.endsAt?.getTime() ?? null,
                  blizzardSeasonId: previousDto.blizzardSeasonId,
                },
                staticSeasonsForBind,
              );
              if (matchedPrevious.ok) {
                previousRaiderIoSlug = matchedPrevious.season.slug;
                previousRioSeasonForProof = matchedPrevious.season;
                await input.prisma.season.update({
                  where: { id: previousSeasonId },
                  data: { providerSeasonId: matchedPrevious.season.slug },
                });
              } else {
                // Same-expansion static may lack previous (cross-expansion).
                const previousExpansion = await loadPreviousExpansionSeasons();
                if (!previousExpansion) {
                  reasons.push(matchedPrevious.reason);
                  reasons.push("PREVIOUS_EXPANSION_STATIC_UNAVAILABLE");
                } else {
                  const crossMatched = matchBlizzardSeasonToRaiderIoByDates(
                    {
                      startTimestamp:
                        previousDto.startTimestamp ??
                        prevRow?.startsAt?.getTime() ??
                        null,
                      endTimestamp:
                        previousDto.endTimestamp ?? prevRow?.endsAt?.getTime() ?? null,
                      blizzardSeasonId: previousDto.blizzardSeasonId,
                    },
                    previousExpansion,
                  );
                  if (!crossMatched.ok) {
                    reasons.push(matchedPrevious.reason);
                    reasons.push(crossMatched.reason);
                  } else {
                    previousRaiderIoSlug = crossMatched.season.slug;
                    previousRioSeasonForProof = crossMatched.season;
                    await input.prisma.season.update({
                      where: { id: previousSeasonId },
                      data: { providerSeasonId: crossMatched.season.slug },
                    });
                    reasons.push("PREVIOUS_RIO_BOUND_VIA_PREVIOUS_EXPANSION");
                  }
                }
              }
            } else {
              reasons.push("PREVIOUS_SEASON_ROW_MISSING_FOR_RIO_BIND");
            }
          } else if (!rioPair.ok) {
            reasons.push(rioPair.reason);
          }
        }
      }

      if (rioPair.ok && currentSeasonId && currentRaiderIoSlug == null) {
        // Previous Blizzard path skipped / unresolved — still try to bind current
        // via the same identity rules (never blind rioPair.current overwrite).
        const bindStart =
          currentStart ?? currentRow.startsAt?.getTime() ?? null;
        const currentMatched = matchBlizzardSeasonToRaiderIoByDates(
          {
            startTimestamp: bindStart,
            endTimestamp: currentDto?.endTimestamp ?? null,
            blizzardSeasonId: currentRow.blizzardSeasonId,
          },
          staticSeasonsForBind,
        );
        if (currentMatched.ok) {
          currentRaiderIoSlug = currentMatched.season.slug;
          await input.prisma.season.update({
            where: { id: currentSeasonId },
            data: { providerSeasonId: currentRaiderIoSlug },
          });
        } else if (!reasons.includes(currentMatched.reason)) {
          reasons.push(currentMatched.reason);
        }
        if (rioPair.previousReason && !reasons.includes(rioPair.previousReason)) {
          reasons.push(rioPair.previousReason);
        }
      } else if (!rioPair.ok && !reasons.includes(rioPair.reason)) {
        reasons.push(rioPair.reason);
      }

      // Prefer freshly matched previous slug; otherwise revalidate any legacy
      // Season.providerSeasonId before trusting it for sync / historical binding.
      let previousSlugForSync: string | null = previousRaiderIoSlug;
      if (previousSeasonId && !previousSlugForSync) {
        const reloaded = await input.prisma.season.findUnique({
          where: { id: previousSeasonId },
          select: { providerSeasonId: true },
        });
        const persisted = reloaded?.providerSeasonId?.trim() || null;
        if (persisted) {
          const targetBlizzardId =
            previousBlizzardForProof?.blizzardSeasonId ?? null;
          const revalidationSeasons = [
            ...staticSeasonsForBind,
            ...(previousExpansionSeasons ?? []),
          ];
          if (targetBlizzardId == null || !Number.isFinite(targetBlizzardId)) {
            // Cannot prove identity without target Blizzard id — retain LKG.
            previousSlugForSync = persisted;
            reasons.push("PERSISTED_RIO_SLUG_COULD_NOT_REVALIDATE:NO_TARGET_BLIZZARD_ID");
          } else {
            const revalidation = revalidatePersistedRaiderIoSeasonSlug({
              persistedSlug: persisted,
              targetBlizzardSeasonId: targetBlizzardId,
              staticDataAvailable:
                staticSeasonsForBind.length > 0 ||
                (previousExpansionSeasons?.length ?? 0) > 0,
              seasons: revalidationSeasons,
            });
            if (revalidation.status === "COMPATIBLE") {
              previousSlugForSync = persisted;
              previousRaiderIoSlug = persisted;
              previousRioSeasonForProof = revalidation.season;
            } else if (revalidation.status === "PROVEN_INCOMPATIBLE") {
              await input.prisma.season.update({
                where: { id: previousSeasonId },
                data: { providerSeasonId: null },
              });
              previousSlugForSync = null;
              reasons.push(
                `PERSISTED_RIO_SLUG_PROVEN_INCOMPATIBLE:${revalidation.reason}`,
              );
            } else {
              // Transient / incomplete static — retain LKG, do not clear.
              previousSlugForSync = persisted;
              reasons.push(
                `PERSISTED_RIO_SLUG_COULD_NOT_REVALIDATE:${revalidation.reason}`,
              );
            }
          }
        }
      }

      if (previousSeasonId && previousSlugForSync) {
        const equivalenceProof =
          previousRioSeasonForProof && previousBlizzardForProof
            ? proveExactRaiderIoCutoffSeasonEquivalence({
                boundRaiderIoSlug: previousSlugForSync,
                blizzardSeasonId: previousBlizzardForProof.blizzardSeasonId,
                blizzardStartsAtMs: previousBlizzardForProof.startTimestamp,
                blizzardEndsAtMs: previousBlizzardForProof.endTimestamp,
                rioSeason: previousRioSeasonForProof,
              })
            : {
                proven: false as const,
                reasons: ["MISSING_BOUND_RIO_SEASON"],
              };

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
          exactTargetSeasonEquivalenceProven: equivalenceProof.proven,
        });
        if (
          policySync.status === "PROVIDER_FAILURE" ||
          policySync.status === "PROVIDER_PERSISTENCE_FAILED" ||
          policySync.status === "VALIDATION_FAILED"
        ) {
          reasons.push(`POLICY_SYNC_${policySync.status}`);
        }
        if (
          (policySync.status === "RETAINED_LAST_KNOWN_GOOD" ||
            policySync.status === "NO_USABLE_POLICY") &&
          "reason" in policySync &&
          policySync.reason ===
            "REMAPPED_CUTOFFS_UNPROVEN_TARGET_SEASON_EQUIVALENCE"
        ) {
          reasons.push(
            `POLICY_SYNC_REMAPPED_CUTOFFS_REJECTED:${equivalenceProof.reasons.join(",")}`,
          );
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
    for (const region of result.regions) {
      if (!region.currentSeasonId) continue;
      if (!isExperienceSeasonBindingEnsureComplete(region)) continue;
      try {
        const season = await input.prisma.season.findUnique({
          where: { id: region.currentSeasonId },
          select: { blizzardSeasonId: true },
        });
        if (season?.blizzardSeasonId != null) {
          rememberExperienceSeasonBindingEnsured(region.region, season.blizzardSeasonId);
        }
      } catch {
        // Soft: remembering ensure state must not fail bootstrap.
      }
    }
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
