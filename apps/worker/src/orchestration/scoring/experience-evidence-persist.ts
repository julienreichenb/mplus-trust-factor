/**
 * Typed payloads + store port for immutable CharacterExperienceEvidence.
 */

import { createHash } from "node:crypto";
import type {
  CharacterExperienceEvidenceDTO,
  CharacterExperienceEvidenceIdentity,
  UpsertCharacterExperienceEvidenceInput,
} from "@mplus/database";
import {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_EVIDENCE_SOURCE,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
} from "@mplus/database";
import { ELITE_CUTOFF_CATALOG_VERSION } from "@mplus/scoring";
import type { PreviousSeasonRatingEvidence } from "./experience-previous-season-evidence.js";

export {
  EXPERIENCE_EVIDENCE_KIND,
  EXPERIENCE_EVIDENCE_SOURCE,
  EXPERIENCE_EVIDENCE_STATE,
  EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION,
  EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
};

export type ExperienceEvidenceStore = {
  find(
    identity: CharacterExperienceEvidenceIdentity,
  ): Promise<CharacterExperienceEvidenceDTO | null>;
  upsertImmutable(
    input: UpsertCharacterExperienceEvidenceInput,
  ): Promise<{ row: CharacterExperienceEvidenceDTO; created: boolean }>;
};

export type PreviousSeasonRatingSource = "BLIZZARD" | "RAIDERIO_FALLBACK";

export type PersistedPreviousSeasonRatingPayloadV1 = {
  schemaVersion: typeof EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION;
  state: "HAS_VALUE" | "CONFIRMED_NO_ACTIVITY";
  rating: number | null;
  ratingSource: PreviousSeasonRatingSource;
  internalSeasonId: string;
  seasonSlug: string;
  blizzardSeasonId: number;
  raiderIoSeasonSlug: string | null;
};

export type PersistedEliteCutoffHistoryPayloadV1 = {
  schemaVersion: typeof ELITE_CUTOFF_CATALOG_VERSION;
  confirmedCount: number;
  confirmed: Array<{
    achievementId: number;
    seasonSlug: string;
    title: string;
    completedAt: string | null;
  }>;
};

export type PersistedPreviousClassRankPayloadV1 = {
  schemaVersion: typeof EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION;
  regionalClassRank: number;
  raiderIoSeasonSlug: string;
  blizzardSeasonId: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hashExperienceEvidencePayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function parsePersistedPreviousSeasonRatingPayload(
  raw: unknown,
): PersistedPreviousSeasonRatingPayloadV1 | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION) return null;
  if (raw.state !== "HAS_VALUE" && raw.state !== "CONFIRMED_NO_ACTIVITY") return null;
  if (raw.ratingSource !== "BLIZZARD" && raw.ratingSource !== "RAIDERIO_FALLBACK") {
    return null;
  }
  if (typeof raw.internalSeasonId !== "string" || !raw.internalSeasonId) return null;
  if (typeof raw.seasonSlug !== "string" || !raw.seasonSlug) return null;
  if (typeof raw.blizzardSeasonId !== "number" || !Number.isFinite(raw.blizzardSeasonId)) {
    return null;
  }
  if (
    !(
      raw.raiderIoSeasonSlug === null ||
      (typeof raw.raiderIoSeasonSlug === "string" && raw.raiderIoSeasonSlug.length > 0)
    )
  ) {
    return null;
  }
  if (raw.state === "HAS_VALUE") {
    if (typeof raw.rating !== "number" || !Number.isFinite(raw.rating)) return null;
  } else if (raw.rating !== null) {
    return null;
  }
  return {
    schemaVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    state: raw.state,
    rating: raw.state === "HAS_VALUE" ? (raw.rating as number) : null,
    ratingSource: raw.ratingSource,
    internalSeasonId: raw.internalSeasonId,
    seasonSlug: raw.seasonSlug,
    blizzardSeasonId: raw.blizzardSeasonId,
    raiderIoSeasonSlug: raw.raiderIoSeasonSlug,
  };
}

export function parsePersistedEliteCutoffHistoryPayload(
  raw: unknown,
): PersistedEliteCutoffHistoryPayloadV1 | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== ELITE_CUTOFF_CATALOG_VERSION) return null;
  if (typeof raw.confirmedCount !== "number" || !Number.isFinite(raw.confirmedCount)) {
    return null;
  }
  if (raw.confirmedCount < 0) return null;
  if (!Array.isArray(raw.confirmed)) return null;
  const confirmed: PersistedEliteCutoffHistoryPayloadV1["confirmed"] = [];
  for (const item of raw.confirmed) {
    if (!isPlainObject(item)) return null;
    if (typeof item.achievementId !== "number" || !Number.isFinite(item.achievementId)) {
      return null;
    }
    if (typeof item.seasonSlug !== "string") return null;
    if (typeof item.title !== "string") return null;
    if (!(item.completedAt === null || typeof item.completedAt === "string")) return null;
    confirmed.push({
      achievementId: item.achievementId,
      seasonSlug: item.seasonSlug,
      title: item.title,
      completedAt: item.completedAt,
    });
  }
  if (confirmed.length !== raw.confirmedCount) return null;
  return {
    schemaVersion: ELITE_CUTOFF_CATALOG_VERSION,
    confirmedCount: raw.confirmedCount,
    confirmed,
  };
}

export function parsePersistedPreviousClassRankPayload(
  raw: unknown,
): PersistedPreviousClassRankPayloadV1 | null {
  if (!isPlainObject(raw)) return null;
  if (raw.schemaVersion !== EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION) return null;
  if (
    typeof raw.regionalClassRank !== "number" ||
    !Number.isFinite(raw.regionalClassRank) ||
    raw.regionalClassRank <= 0
  ) {
    return null;
  }
  if (typeof raw.raiderIoSeasonSlug !== "string" || !raw.raiderIoSeasonSlug) return null;
  if (typeof raw.blizzardSeasonId !== "number" || !Number.isFinite(raw.blizzardSeasonId)) {
    return null;
  }
  return {
    schemaVersion: EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION,
    regionalClassRank: raw.regionalClassRank,
    raiderIoSeasonSlug: raw.raiderIoSeasonSlug,
    blizzardSeasonId: raw.blizzardSeasonId,
  };
}

export function ratingEvidenceFromPersistedRow(
  row: CharacterExperienceEvidenceDTO,
  expected?: PreviousSeasonRatingEvidenceBindingExpectation,
): PreviousSeasonRatingEvidence | null {
  if (row.evidenceKind !== EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING) return null;
  if (row.compatibilityVersion !== EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION) return null;
  const payload = parsePersistedPreviousSeasonRatingPayload(row.payload);
  if (!payload) return null;
  if (payload.internalSeasonId !== row.seasonId) return null;

  if (expected) {
    if (!isPersistedRatingEvidenceCompatible(row, payload, expected)) {
      return null;
    }
  }

  const base = {
    internalSeasonId: payload.internalSeasonId,
    seasonSlug: payload.seasonSlug,
    blizzardSeasonId: payload.blizzardSeasonId,
    fetchedAt: row.fetchedAt.toISOString(),
    providerPayloadId: row.sourcePayloadId,
    ratingSource: payload.ratingSource,
  };
  if (payload.state === "HAS_VALUE") {
    return { state: "HAS_VALUE", rating: payload.rating!, ...base };
  }
  return { state: "CONFIRMED_NO_ACTIVITY", rating: null, ...base };
}

/**
 * Expected previous-season binding for durable evidence reuse.
 * A mismatched immutable row must fail closed (reacquire or unavailable).
 */
export type PreviousSeasonRatingEvidenceBindingExpectation = {
  characterId: string;
  seasonId: string;
  blizzardSeasonId: number;
  /** Bound RIO slug when known; null means do not enforce slug equality. */
  raiderIoSeasonSlug?: string | null;
};

/**
 * Prove persisted rating evidence matches the current canonical binding.
 * Legacy null provenance fields are tolerated when the compatibility contract
 * did not previously require them; present mismatched values fail closed.
 */
export function isPersistedRatingEvidenceCompatible(
  row: CharacterExperienceEvidenceDTO,
  payload: PersistedPreviousSeasonRatingPayloadV1,
  expected: PreviousSeasonRatingEvidenceBindingExpectation,
): boolean {
  if (row.characterId !== expected.characterId) return false;
  if (row.seasonId !== expected.seasonId) return false;
  if (payload.internalSeasonId !== expected.seasonId) return false;
  if (row.compatibilityVersion !== EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION) {
    return false;
  }
  if (payload.schemaVersion !== EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION) {
    return false;
  }

  if (payload.blizzardSeasonId !== expected.blizzardSeasonId) return false;
  if (
    row.blizzardSeasonId != null &&
    row.blizzardSeasonId !== expected.blizzardSeasonId
  ) {
    return false;
  }

  const expectedRio = expected.raiderIoSeasonSlug?.trim() || null;
  if (expectedRio) {
    if (
      row.raiderIoSeasonSlug != null &&
      row.raiderIoSeasonSlug.trim() !== expectedRio
    ) {
      return false;
    }
    if (
      payload.raiderIoSeasonSlug != null &&
      payload.raiderIoSeasonSlug.trim() !== expectedRio
    ) {
      return false;
    }
  } else if (
    row.raiderIoSeasonSlug != null &&
    payload.raiderIoSeasonSlug != null &&
    row.raiderIoSeasonSlug.trim() !== payload.raiderIoSeasonSlug.trim()
  ) {
    return false;
  }

  // source / ratingSource consistency
  if (payload.ratingSource === "BLIZZARD") {
    if (
      row.source !== EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD &&
      row.source !== EXPERIENCE_EVIDENCE_SOURCE.NONE
    ) {
      return false;
    }
  } else if (payload.ratingSource === "RAIDERIO_FALLBACK") {
    if (row.source !== EXPERIENCE_EVIDENCE_SOURCE.RAIDERIO_FALLBACK) {
      return false;
    }
  }

  if (row.contentHash != null && row.contentHash.length > 0) {
    const expectedHash = hashExperienceEvidencePayload(payload);
    if (row.contentHash !== expectedHash) return false;
  }

  return true;
}

export function buildPreviousSeasonRatingPersistInput(input: {
  characterId: string;
  evidence: Extract<
    PreviousSeasonRatingEvidence,
    { state: "HAS_VALUE" | "CONFIRMED_NO_ACTIVITY" }
  >;
  raiderIoSeasonSlug?: string | null;
  sourceRequestFingerprint?: string | null;
}): UpsertCharacterExperienceEvidenceInput | null {
  if (
    input.evidence.state !== "HAS_VALUE" &&
    input.evidence.state !== "CONFIRMED_NO_ACTIVITY"
  ) {
    return null;
  }
  const ratingSource = input.evidence.ratingSource ?? "BLIZZARD";
  const payload: PersistedPreviousSeasonRatingPayloadV1 = {
    schemaVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    state: input.evidence.state,
    rating: input.evidence.state === "HAS_VALUE" ? input.evidence.rating : null,
    ratingSource,
    internalSeasonId: input.evidence.internalSeasonId,
    seasonSlug: input.evidence.seasonSlug,
    blizzardSeasonId: input.evidence.blizzardSeasonId,
    raiderIoSeasonSlug: input.raiderIoSeasonSlug ?? null,
  };
  return {
    characterId: input.characterId,
    seasonId: input.evidence.internalSeasonId,
    evidenceKind: EXPERIENCE_EVIDENCE_KIND.PREVIOUS_SEASON_RATING,
    compatibilityVersion: EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION,
    blizzardSeasonId: input.evidence.blizzardSeasonId,
    raiderIoSeasonSlug: input.raiderIoSeasonSlug ?? null,
    state:
      input.evidence.state === "HAS_VALUE"
        ? EXPERIENCE_EVIDENCE_STATE.HAS_VALUE
        : EXPERIENCE_EVIDENCE_STATE.CONFIRMED_ABSENCE,
    source:
      ratingSource === "RAIDERIO_FALLBACK"
        ? EXPERIENCE_EVIDENCE_SOURCE.RAIDERIO_FALLBACK
        : EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
    payload,
    sourcePayloadId: input.evidence.providerPayloadId,
    sourceRequestFingerprint: input.sourceRequestFingerprint ?? null,
    contentHash: hashExperienceEvidencePayload(payload),
    fetchedAt: new Date(input.evidence.fetchedAt),
  };
}

export function buildEliteCutoffHistoryPersistInput(input: {
  characterId: string;
  /** Current scoring season — rollover miss triggers one reacquire. */
  currentSeasonId: string;
  confirmedCount: number;
  confirmed: PersistedEliteCutoffHistoryPayloadV1["confirmed"];
  sourcePayloadId?: string | null;
  sourceRequestFingerprint?: string | null;
  fetchedAt: string;
}): UpsertCharacterExperienceEvidenceInput {
  const payload: PersistedEliteCutoffHistoryPayloadV1 = {
    schemaVersion: ELITE_CUTOFF_CATALOG_VERSION,
    confirmedCount: input.confirmedCount,
    confirmed: input.confirmed,
  };
  return {
    characterId: input.characterId,
    seasonId: input.currentSeasonId,
    evidenceKind: EXPERIENCE_EVIDENCE_KIND.ELITE_CUTOFF_HISTORY,
    compatibilityVersion: ELITE_CUTOFF_CATALOG_VERSION,
    blizzardSeasonId: null,
    raiderIoSeasonSlug: null,
    state:
      input.confirmedCount > 0
        ? EXPERIENCE_EVIDENCE_STATE.HAS_VALUE
        : EXPERIENCE_EVIDENCE_STATE.CONFIRMED_ABSENCE,
    source: EXPERIENCE_EVIDENCE_SOURCE.BLIZZARD,
    payload,
    sourcePayloadId: input.sourcePayloadId ?? null,
    sourceRequestFingerprint: input.sourceRequestFingerprint ?? null,
    contentHash: hashExperienceEvidencePayload(payload),
    fetchedAt: new Date(input.fetchedAt),
  };
}

/** In-memory store for unit tests / process-restart simulation of durable rows. */
export function createInMemoryExperienceEvidenceStore(
  sharedRows?: Map<string, CharacterExperienceEvidenceDTO>,
): ExperienceEvidenceStore {
  const rows = sharedRows ?? new Map<string, CharacterExperienceEvidenceDTO>();
  const keyOf = (id: CharacterExperienceEvidenceIdentity) =>
    `${id.characterId}|${id.seasonId}|${id.evidenceKind}|${id.compatibilityVersion}`;

  return {
    async find(identity) {
      return rows.get(keyOf(identity)) ?? null;
    },
    async upsertImmutable(input) {
      const key = keyOf(input);
      const existing = rows.get(key);
      if (existing) return { row: existing, created: false };
      const now = new Date();
      const row: CharacterExperienceEvidenceDTO = {
        id: `mem-${rows.size + 1}`,
        characterId: input.characterId,
        seasonId: input.seasonId,
        blizzardSeasonId: input.blizzardSeasonId ?? null,
        raiderIoSeasonSlug: input.raiderIoSeasonSlug ?? null,
        evidenceKind: input.evidenceKind,
        compatibilityVersion: input.compatibilityVersion,
        state: input.state,
        source: input.source,
        payload: input.payload,
        sourcePayloadId: input.sourcePayloadId ?? null,
        sourceRequestFingerprint: input.sourceRequestFingerprint ?? null,
        contentHash: input.contentHash ?? null,
        fetchedAt: input.fetchedAt,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(key, row);
      return { row, created: true };
    },
  };
}
