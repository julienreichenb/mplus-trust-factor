/**
 * Blizzard closed-season Mythic+ rating history for Experience (Agent 03B).
 *
 * Discovers seasons from the character Mythic Keystone Profile Index, fetches
 * Season Details only for missing closed seasons, and persists immutable
 * PREVIOUS_SEASON_RATING evidence (reused by Phase 1 + future 03C).
 *
 * Live Blizzard semantics (Agent 03B probe):
 * - Profile Index `seasons[]` lists only seasons with a keystone profile
 *   (includes current). Absence ⇒ no season profile (Season Details → 404).
 * - Season Details expose `mythic_rating` (not `current_mythic_rating`).
 * - Absence from the index is treated as authoritative no-activity for closed
 *   seasons we already have as internal Season rows — after a successful index.
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
  EXPERIENCE_EVIDENCE_SOURCE,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
  type CharacterExperienceEvidenceDTO,
} from "@mplus/database";
import {
  buildPreviousSeasonRatingPersistInput,
  parsePersistedPreviousSeasonRatingPayload,
  ratingEvidenceFromPersistedRow,
  type ExperienceEvidenceStore,
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

export type ClosedSeasonRow = {
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

export function isClosedSeasonForHistory(
  season: Pick<ClosedSeasonRow, "isCurrent" | "endsAt" | "blizzardSeasonId" | "id">,
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

export function historicalSeasonRatingFromEvidenceRow(
  row: CharacterExperienceEvidenceDTO,
): HistoricalSeasonRating | null {
  const evidence = ratingEvidenceFromPersistedRow(row);
  if (!evidence) return null;
  if (evidence.state !== "HAS_VALUE" && evidence.state !== "CONFIRMED_NO_ACTIVITY") {
    return null;
  }
  // History dataset is Blizzard-authoritative; keep RIO fallback rows out of 03C join set.
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

export async function listHistoricalSeasonRatingsFromStore(
  store: ExperienceEvidenceStore,
  characterId: string,
): Promise<HistoricalSeasonRating[]> {
  const rows = store.listPreviousSeasonRatings
    ? await store.listPreviousSeasonRatings(characterId)
    : [];
  const out: HistoricalSeasonRating[] = [];
  for (const row of rows) {
    if (!isTerminalRatingRow(row)) continue;
    const mapped = historicalSeasonRatingFromEvidenceRow(row);
    if (mapped) out.push(mapped);
  }
  return out.sort((a, b) => a.blizzardSeasonId - b.blizzardSeasonId);
}

async function loadClosedSeasons(input: {
  prisma: Pick<PrismaClient, "season">;
  currentSeasonId: string;
  regionCode: RegionCode;
  nowMs: number;
  authoritativeBlizzardSeasonId: number | null;
}): Promise<ClosedSeasonRow[]> {
  const current = await input.prisma.season.findUnique({
    where: { id: input.currentSeasonId },
    select: { regionId: true },
  });
  if (!current?.regionId) return [];

  const rows = await input.prisma.season.findMany({
    where: {
      regionId: current.regionId,
      blizzardSeasonId: { not: null },
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

  return rows
    .filter(
      (r): r is typeof r & { blizzardSeasonId: number } =>
        r.blizzardSeasonId != null &&
        Number.isFinite(r.blizzardSeasonId) &&
        // Real Blizzard season ids only (exclude local fixtures e.g. 999001).
        r.blizzardSeasonId > 0 &&
        r.blizzardSeasonId < 1000,
    )
    .filter((r) =>
      isClosedSeasonForHistory(r, {
        currentSeasonId: input.currentSeasonId,
        authoritativeBlizzardSeasonId: input.authoritativeBlizzardSeasonId,
        nowMs: input.nowMs,
      }),
    )
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      blizzardSeasonId: r.blizzardSeasonId,
      regionId: r.regionId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      isCurrent: r.isCurrent,
      providerSeasonId: r.providerSeasonId,
    }));
}

/**
 * Acquire / reuse immutable Blizzard historical Mythic+ ratings for closed seasons.
 */
export async function acquireBlizzardSeasonHistory(
  input: AcquireBlizzardSeasonHistoryInput,
): Promise<AcquireBlizzardSeasonHistoryResult> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  let profileIndexCalls = 0;
  let seasonDetailsCalls = 0;
  let persistedCount = 0;
  const skippedCurrentSeasonIds: number[] = [];
  const failedSeasonIds: number[] = [];

  const existingRows = input.evidenceStore.listPreviousSeasonRatings
    ? await input.evidenceStore.listPreviousSeasonRatings(input.characterId)
    : [];
  const evidenceBySeasonId = new Map(
    existingRows.filter(isTerminalRatingRow).map((r) => [r.seasonId, r] as const),
  );

  // Authoritative current Blizzard id from the scoring season row when available.
  const currentRow = await input.prisma.season.findUnique({
    where: { id: input.currentSeasonId },
    select: { blizzardSeasonId: true },
  });
  const authoritativeFromSeason =
    currentRow?.blizzardSeasonId != null && Number.isFinite(currentRow.blizzardSeasonId)
      ? currentRow.blizzardSeasonId
      : null;

  const closedSeasons = await loadClosedSeasons({
    prisma: input.prisma,
    currentSeasonId: input.currentSeasonId,
    regionCode: input.regionCode,
    nowMs,
    authoritativeBlizzardSeasonId: authoritativeFromSeason,
  });

  const missing = closedSeasons.filter((s) => !evidenceBySeasonId.has(s.id));
  if (missing.length === 0 || !input.allowProviderCalls) {
    return {
      ratings: await listHistoricalSeasonRatingsFromStore(
        input.evidenceStore,
        input.characterId,
      ),
      profileIndexCalls: 0,
      seasonDetailsCalls: 0,
      persistedCount: 0,
      skippedCurrentSeasonIds,
      failedSeasonIds,
    };
  }

  profileIndexCalls = 1;
  let indexSeasonIds: Set<number>;
  let authoritativeFromIndex: number | null = authoritativeFromSeason;
  try {
    const index = await input.blizzard.getMythicKeystoneProfile(input.identity, input.ctx);
    indexSeasonIds = new Set(
      (index.data.seasons ?? [])
        .map((s) => s.seasonId)
        .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
    );
    if (
      index.data.currentSeasonId != null &&
      Number.isFinite(index.data.currentSeasonId)
    ) {
      authoritativeFromIndex = index.data.currentSeasonId;
    }
  } catch {
    // Index failure: do not invent absences; leave missing seasons retryable.
    return {
      ratings: await listHistoricalSeasonRatingsFromStore(
        input.evidenceStore,
        input.characterId,
      ),
      profileIndexCalls,
      seasonDetailsCalls: 0,
      persistedCount: 0,
      skippedCurrentSeasonIds,
      failedSeasonIds: missing.map((s) => s.blizzardSeasonId),
    };
  }

  if (authoritativeFromIndex != null) {
    skippedCurrentSeasonIds.push(authoritativeFromIndex);
  }

  for (const season of missing) {
    if (
      authoritativeFromIndex != null &&
      season.blizzardSeasonId === authoritativeFromIndex
    ) {
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

    // Authoritative absence: closed season we track is not in Profile Index.
    if (!indexSeasonIds.has(season.blizzardSeasonId)) {
      const fetchedAt = now.toISOString();
      const persistInput = buildPreviousSeasonRatingPersistInput({
        characterId: input.characterId,
        evidence: {
          state: "CONFIRMED_NO_ACTIVITY",
          rating: null,
          internalSeasonId: season.id,
          seasonSlug: season.slug,
          blizzardSeasonId: season.blizzardSeasonId,
          fetchedAt,
          providerPayloadId: null,
          ratingSource: "BLIZZARD",
        },
        raiderIoSeasonSlug: season.providerSeasonId?.trim() || null,
        sourceRequestFingerprint: `blizzard-mplus-index-absent:${season.blizzardSeasonId}`,
      });
      if (persistInput) {
        const { created } = await input.evidenceStore.upsertImmutable(persistInput);
        if (created) persistedCount += 1;
      }
      continue;
    }

    seasonDetailsCalls += 1;
    try {
      const result = await input.blizzard.getMythicKeystoneSeasonProfile(
        input.identity,
        season.blizzardSeasonId,
        input.ctx,
      );
      let payloadId: string | null = null;
      try {
        payloadId = await input.persistProviderResult(
          result as ProviderResult<unknown>,
        );
      } catch {
        payloadId = null;
      }
      const evidence = mapSeasonProfileToPreviousSeasonRatingEvidence({
        binding,
        result,
        providerPayloadId: payloadId,
      });
      if (evidence.state !== "HAS_VALUE" && evidence.state !== "CONFIRMED_NO_ACTIVITY") {
        failedSeasonIds.push(season.blizzardSeasonId);
        continue;
      }
      const persistInput = buildPreviousSeasonRatingPersistInput({
        characterId: input.characterId,
        evidence,
        raiderIoSeasonSlug: season.providerSeasonId?.trim() || null,
        sourceRequestFingerprint: result.metadata.requestFingerprint ?? null,
      });
      if (!persistInput) {
        failedSeasonIds.push(season.blizzardSeasonId);
        continue;
      }
      const { created } = await input.evidenceStore.upsertImmutable(persistInput);
      if (created) persistedCount += 1;
    } catch {
      failedSeasonIds.push(season.blizzardSeasonId);
    }
  }

  return {
    ratings: await listHistoricalSeasonRatingsFromStore(
      input.evidenceStore,
      input.characterId,
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

/** @internal — parse helper retained for tests */
export function _parseRatingPayload(row: CharacterExperienceEvidenceDTO) {
  return parsePersistedPreviousSeasonRatingPayload(row.payload);
}

export { EXPERIENCE_EVIDENCE_SOURCE };
