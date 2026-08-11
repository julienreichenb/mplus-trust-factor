/**
 * Blizzard closed-season Mythic+ rating history for Experience (Agent 03B).
 *
 * Flow (Experience refresh, providers allowed):
 *   1× Profile Index
 *   + Season Details only for index seasons that map to closed internal Season
 *     rows still missing terminal PREVIOUS_SEASON_RATING evidence.
 *
 * Absence from Profile Index `seasons[]` is UNKNOWN — Blizzard docs do not
 * guarantee index-absence ≡ no Mythic+ activity. Do not persist no-activity
 * from absence alone. CONFIRMED_NO_ACTIVITY only from a successful Season
 * Details payload under existing mapping rules.
 *
 * Season Details expose `mythic_rating` (normalized via provider).
 */

import type {
  BlizzardProvider,
  CharacterIdentityInput,
  ProviderFetchContext,
  ProviderResult,
  RegionCode,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  type CharacterExperienceEvidenceDTO,
} from "@mplus/database";
import {
  buildPreviousSeasonRatingPersistInput,
  ratingEvidenceFromPersistedRow,
  type ExperienceEvidenceStore,
  type PreviousSeasonRatingEvidenceBindingExpectation,
} from "./experience-evidence-persist.js";
import {
  mapSeasonProfileToPreviousSeasonRatingEvidence,
  type ExperienceSeasonBindingCandidate,
  type PersistProviderResultFn,
} from "./experience-previous-season-evidence.js";

export type HistoryPersistProviderResultFn = PersistProviderResultFn;

export type HistoricalSeasonRatingState = "HAS_VALUE" | "CONFIRMED_NO_ACTIVITY";

/** Internal dataset for Agent 03C (Blizzard-only historical ratings). */
export type HistoricalSeasonRating = {
  seasonId: string;
  seasonSlug: string;
  blizzardSeasonId: number;
  rating: number | null;
  state: HistoricalSeasonRatingState;
  source: "BLIZZARD";
};

export type SeasonHistoryRow = {
  id: string;
  slug: string;
  blizzardSeasonId: number;
  regionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isCurrent: boolean;
  providerSeasonId: string | null;
};

export type AcquireBlizzardSeasonHistoryInput = {
  prisma: Pick<PrismaClient, "season">;
  characterId: string;
  identity: CharacterIdentityInput;
  regionCode: RegionCode;
  /** Internal Season.id for the character's current scoring season (open). */
  currentSeasonId: string;
  blizzard: Pick<
    BlizzardProvider,
    "getMythicKeystoneProfile" | "getMythicKeystoneSeasonProfile"
  >;
  ctx: ProviderFetchContext;
  persistProviderResult: HistoryPersistProviderResultFn;
  evidenceStore: ExperienceEvidenceStore;
  allowProviderCalls: boolean;
  now?: Date;
};

export type AcquireBlizzardSeasonHistoryResult = {
  ratings: HistoricalSeasonRating[];
  profileIndexCalls: number;
  seasonDetailsCalls: number;
  persistedCount: number;
  skippedCurrentSeasonIds: number[];
  failedSeasonIds: number[];
};

function isTerminalRatingRow(row: CharacterExperienceEvidenceDTO): boolean {
  if (row.evidenceKind !== EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING) {
    return false;
  }
  if (row.compatibilityVersion !== EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION) {
    return false;
  }
  return (
    row.state === EXPERIENCE_EVIDENCE_STATE.HAS_VALUE ||
    row.state === EXPERIENCE_EVIDENCE_STATE.CONFIRMED_ABSENCE
  );
}

function bindingExpectationForSeason(
  characterId: string,
  season: Pick<SeasonHistoryRow, "id" | "blizzardSeasonId" | "providerSeasonId">,
): PreviousSeasonRatingEvidenceBindingExpectation {
  return {
    characterId,
    seasonId: season.id,
    blizzardSeasonId: season.blizzardSeasonId,
    raiderIoSeasonSlug: season.providerSeasonId?.trim() || null,
  };
}

export function isClosedSeasonForHistory(
  season: Pick<SeasonHistoryRow, "isCurrent" | "endsAt" | "blizzardSeasonId" | "id">,
  input: { currentSeasonId: string; authoritativeBlizzardSeasonId: number | null; nowMs: number },
): boolean {
  if (season.id === input.currentSeasonId) return false;
  if (
    input.authoritativeBlizzardSeasonId != null &&
    season.blizzardSeasonId === input.authoritativeBlizzardSeasonId
  ) {
    return false;
  }
  if (season.isCurrent) return false;
  if (season.endsAt != null && season.endsAt.getTime() > input.nowMs) return false;
  return true;
}

/**
 * Map a persisted PREVIOUS_SEASON_RATING row into Blizzard historical standing input.
 * RAIDERIO_FALLBACK rows are never admitted. When `expected` is provided, full
 * catalog binding compatibility is required (not merely terminal shape).
 */
export function historicalSeasonRatingFromEvidenceRow(
  row: CharacterExperienceEvidenceDTO,
  expected?: PreviousSeasonRatingEvidenceBindingExpectation,
): HistoricalSeasonRating | null {
  const evidence = ratingEvidenceFromPersistedRow(row, expected);
  if (!evidence) return null;
  if (evidence.state !== "HAS_VALUE" && evidence.state !== "CONFIRMED_NO_ACTIVITY") {
    return null;
  }
  if (evidence.ratingSource === "RAIDERIO_FALLBACK") return null;
  return {
    seasonId: evidence.internalSeasonId,
    seasonSlug: evidence.seasonSlug,
    blizzardSeasonId: evidence.blizzardSeasonId,
    rating: evidence.state === "HAS_VALUE" ? evidence.rating : null,
    state: evidence.state,
    source: "BLIZZARD",
  };
}

async function loadBindingsBySeasonId(
  prisma: Pick<PrismaClient, "season">,
  characterId: string,
  seasonIds: readonly string[],
): Promise<Map<string, PreviousSeasonRatingEvidenceBindingExpectation>> {
  const out = new Map<string, PreviousSeasonRatingEvidenceBindingExpectation>();
  if (seasonIds.length === 0) return out;
  const seasons = await prisma.season.findMany({
    where: { id: { in: [...seasonIds] } },
    select: { id: true, blizzardSeasonId: true, providerSeasonId: true },
  });
  for (const season of seasons) {
    if (season.blizzardSeasonId == null || !Number.isFinite(season.blizzardSeasonId)) {
      continue;
    }
    out.set(
      season.id,
      bindingExpectationForSeason(characterId, {
        id: season.id,
        blizzardSeasonId: season.blizzardSeasonId,
        providerSeasonId: season.providerSeasonId,
      }),
    );
  }
  return out;
}

export async function listHistoricalSeasonRatingsFromStore(
  store: ExperienceEvidenceStore,
  characterId: string,
  options?: { prisma?: Pick<PrismaClient, "season"> },
): Promise<HistoricalSeasonRating[]> {
  const rows = store.listPreviousSeasonRatings
    ? await store.listPreviousSeasonRatings(characterId)
    : [];
  const bindings = options?.prisma
    ? await loadBindingsBySeasonId(
        options.prisma,
        characterId,
        rows.map((r) => r.seasonId),
      )
    : null;
  const out: HistoricalSeasonRating[] = [];
  for (const row of rows) {
    if (!isTerminalRatingRow(row)) continue;
    const expected = bindings?.get(row.seasonId);
    // When season catalog is available, require a coherent binding; skip orphans.
    if (bindings && !expected) continue;
    const mapped = historicalSeasonRatingFromEvidenceRow(row, expected);
    if (mapped) out.push(mapped);
  }
  return out.sort((a, b) => a.blizzardSeasonId - b.blizzardSeasonId);
}

async function emptyResult(
  store: ExperienceEvidenceStore,
  characterId: string,
  partial: Partial<AcquireBlizzardSeasonHistoryResult> = {},
  prisma?: Pick<PrismaClient, "season">,
): Promise<AcquireBlizzardSeasonHistoryResult> {
  return {
    ratings: await listHistoricalSeasonRatingsFromStore(store, characterId, {
      prisma,
    }),
    profileIndexCalls: 0,
    seasonDetailsCalls: 0,
    persistedCount: 0,
    skippedCurrentSeasonIds: [],
    failedSeasonIds: [],
    ...partial,
  };
}

/**
 * Acquire / reuse immutable Blizzard historical Mythic+ ratings for closed seasons
 * discovered via the character Profile Index.
 */
export async function acquireBlizzardSeasonHistory(
  input: AcquireBlizzardSeasonHistoryInput,
): Promise<AcquireBlizzardSeasonHistoryResult> {
  const nowMs = (input.now ?? new Date()).getTime();

  if (!input.allowProviderCalls) {
    return emptyResult(input.evidenceStore, input.characterId, {}, input.prisma);
  }

  const currentRow = await input.prisma.season.findUnique({
    where: { id: input.currentSeasonId },
    select: { regionId: true, blizzardSeasonId: true },
  });
  if (!currentRow?.regionId) {
    return emptyResult(input.evidenceStore, input.characterId, {}, input.prisma);
  }

  const profileIndexCalls = 1;
  let seasonDetailsCalls = 0;
  let persistedCount = 0;
  const skippedCurrentSeasonIds: number[] = [];
  const failedSeasonIds: number[] = [];

  let indexSeasonIds: number[] = [];
  let authoritativeBlizzardSeasonId: number | null =
    currentRow.blizzardSeasonId != null && Number.isFinite(currentRow.blizzardSeasonId)
      ? currentRow.blizzardSeasonId
      : null;

  try {
    const index = await input.blizzard.getMythicKeystoneProfile(input.identity, input.ctx);
    indexSeasonIds = (index.data.seasons ?? [])
      .map((s) => s.seasonId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
    if (index.data.currentSeasonId != null && Number.isFinite(index.data.currentSeasonId)) {
      authoritativeBlizzardSeasonId = index.data.currentSeasonId;
    }
  } catch {
    return emptyResult(input.evidenceStore, input.characterId, {
      profileIndexCalls,
      failedSeasonIds: [],
    }, input.prisma);
  }

  if (authoritativeBlizzardSeasonId != null) {
    skippedCurrentSeasonIds.push(authoritativeBlizzardSeasonId);
  }

  const existingRows = input.evidenceStore.listPreviousSeasonRatings
    ? await input.evidenceStore.listPreviousSeasonRatings(input.characterId)
    : [];
  const evidenceBySeasonId = new Map(
    existingRows.filter(isTerminalRatingRow).map((r) => [r.seasonId, r] as const),
  );

  const uniqueIndexIds = [...new Set(indexSeasonIds)];
  const mappedSeasons = await input.prisma.season.findMany({
    where: {
      regionId: currentRow.regionId,
      blizzardSeasonId: { in: uniqueIndexIds },
    },
    select: {
      id: true,
      slug: true,
      blizzardSeasonId: true,
      regionId: true,
      startsAt: true,
      endsAt: true,
      isCurrent: true,
      providerSeasonId: true,
    },
  });
  const seasonByBlizzardId = new Map(
    mappedSeasons
      .filter(
        (s): s is typeof s & { blizzardSeasonId: number } =>
          s.blizzardSeasonId != null && Number.isFinite(s.blizzardSeasonId),
      )
      .map((s) => [s.blizzardSeasonId, s] as const),
  );

  for (const blizzardSeasonId of uniqueIndexIds) {
    if (
      authoritativeBlizzardSeasonId != null &&
      blizzardSeasonId === authoritativeBlizzardSeasonId
    ) {
      continue;
    }

    const season = seasonByBlizzardId.get(blizzardSeasonId);
    if (!season) continue;
    if (
      !isClosedSeasonForHistory(season, {
        currentSeasonId: input.currentSeasonId,
        authoritativeBlizzardSeasonId,
        nowMs,
      })
    ) {
      continue;
    }

    const expected = bindingExpectationForSeason(input.characterId, season);
    const existing = evidenceBySeasonId.get(season.id);
    // Cache hit only when persisted evidence is usable Blizzard history for this binding.
    if (existing && historicalSeasonRatingFromEvidenceRow(existing, expected)) {
      continue;
    }

    const binding: ExperienceSeasonBindingCandidate = {
      id: season.id,
      regionId: season.regionId,
      slug: season.slug,
      blizzardSeasonId: season.blizzardSeasonId,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      providerSeasonId: season.providerSeasonId,
    };

    seasonDetailsCalls += 1;
    try {
      const result = await input.blizzard.getMythicKeystoneSeasonProfile(
        input.identity,
        blizzardSeasonId,
        input.ctx,
      );
      let payloadId: string | null = null;
      try {
        payloadId = await input.persistProviderResult(result as ProviderResult<unknown>);
      } catch {
        payloadId = null;
      }
      const evidence = mapSeasonProfileToPreviousSeasonRatingEvidence({
        binding,
        result,
        providerPayloadId: payloadId,
      });
      if (evidence.state !== "HAS_VALUE" && evidence.state !== "CONFIRMED_NO_ACTIVITY") {
        failedSeasonIds.push(blizzardSeasonId);
        continue;
      }
      const persistInput = buildPreviousSeasonRatingPersistInput({
        characterId: input.characterId,
        evidence,
        raiderIoSeasonSlug: season.providerSeasonId?.trim() || null,
        sourceRequestFingerprint: result.metadata.requestFingerprint ?? null,
      });
      if (!persistInput) {
        failedSeasonIds.push(blizzardSeasonId);
        continue;
      }
      const { row, created } = await input.evidenceStore.upsertImmutable(persistInput);
      if (created) {
        persistedCount += 1;
        evidenceBySeasonId.set(season.id, row);
      } else if (!historicalSeasonRatingFromEvidenceRow(row, expected)) {
        // Immutable conflict: do not trust the incompatible existing row.
        failedSeasonIds.push(blizzardSeasonId);
      }
    } catch {
      failedSeasonIds.push(blizzardSeasonId);
    }
  }

  return {
    ratings: await listHistoricalSeasonRatingsFromStore(
      input.evidenceStore,
      input.characterId,
      { prisma: input.prisma },
    ),
    profileIndexCalls,
    seasonDetailsCalls,
    persistedCount,
    skippedCurrentSeasonIds,
    failedSeasonIds,
  };
}

/** Wrap Prisma repository as ExperienceEvidenceStore (with list). */
export function experienceEvidenceStoreFromRepository(repo: {
  find: ExperienceEvidenceStore["find"];
  upsertImmutable: ExperienceEvidenceStore["upsertImmutable"];
  findManyPreviousSeasonRatingsForCharacter: (
    characterId: string,
  ) => Promise<CharacterExperienceEvidenceDTO[]>;
}): ExperienceEvidenceStore {
  return {
    find: (id) => repo.find(id),
    upsertImmutable: (input) => repo.upsertImmutable(input),
    listPreviousSeasonRatings: (characterId) =>
      repo.findManyPreviousSeasonRatingsForCharacter(characterId),
  };
}

/** Join proof helper for 03C — rating + population anchors when both exist. */
export function joinHistoricalRatingWithPopulationPolicy(input: {
  rating: HistoricalSeasonRating;
  populationPolicy: {
    anchors: Array<{ nativeQuantile: string; score: number }>;
  } | null;
}): {
  blizzardSeasonId: number;
  historicalRating: number | null;
  cutoffs: Partial<Record<string, number>>;
} | null {
  if (!input.populationPolicy) return null;
  const cutoffs: Partial<Record<string, number>> = {};
  for (const a of input.populationPolicy.anchors) {
    cutoffs[a.nativeQuantile] = a.score;
  }
  return {
    blizzardSeasonId: input.rating.blizzardSeasonId,
    historicalRating: input.rating.rating,
    cutoffs,
  };
}
