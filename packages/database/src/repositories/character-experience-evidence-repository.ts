import type { Prisma, PrismaClient } from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";

export const EXPERIENCE_EVIDENCE_KIND = {
  PREVIOUS_SEASON_RATING: "PREVIOUS_SEASON_RATING",
  PREVIOUS_SEASON_CLASS_RANK: "PREVIOUS_SEASON_CLASS_RANK",
  ELITE_CUTOFF_HISTORY: "ELITE_CUTOFF_HISTORY",
} as const;

export type ExperienceEvidenceKind =
  (typeof EXPERIENCE_EVIDENCE_KIND)[keyof typeof EXPERIENCE_EVIDENCE_KIND];

export const EXPERIENCE_EVIDENCE_STATE = {
  HAS_VALUE: "HAS_VALUE",
  CONFIRMED_ABSENCE: "CONFIRMED_ABSENCE",
} as const;

export type ExperienceEvidenceState =
  (typeof EXPERIENCE_EVIDENCE_STATE)[keyof typeof EXPERIENCE_EVIDENCE_STATE];

export const EXPERIENCE_EVIDENCE_SOURCE = {
  BLIZZARD: "BLIZZARD",
  RAIDERIO_FALLBACK: "RAIDERIO_FALLBACK",
  NONE: "NONE",
} as const;

export type ExperienceEvidenceSource =
  (typeof EXPERIENCE_EVIDENCE_SOURCE)[keyof typeof EXPERIENCE_EVIDENCE_SOURCE];

/** Compatibility version for previous-season rating evidence payload shape. */
export const EXPERIENCE_PREVIOUS_RATING_COMPAT_VERSION =
  "experience-previous-rating-v1" as const;

/** Compatibility version for exact-season class-rank payload (scaffold). */
export const EXPERIENCE_PREVIOUS_CLASS_RANK_COMPAT_VERSION =
  "experience-previous-class-rank-v1" as const;

export interface CharacterExperienceEvidenceIdentity {
  characterId: string;
  seasonId: string;
  evidenceKind: ExperienceEvidenceKind | string;
  compatibilityVersion: string;
}

export interface CharacterExperienceEvidenceDTO {
  id: string;
  characterId: string;
  seasonId: string;
  blizzardSeasonId: number | null;
  raiderIoSeasonSlug: string | null;
  evidenceKind: string;
  compatibilityVersion: string;
  state: string;
  source: string;
  payload: unknown;
  sourcePayloadId: string | null;
  sourceRequestFingerprint: string | null;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCharacterExperienceEvidenceInput
  extends CharacterExperienceEvidenceIdentity {
  blizzardSeasonId?: number | null;
  raiderIoSeasonSlug?: string | null;
  state: ExperienceEvidenceState | string;
  source: ExperienceEvidenceSource | string;
  payload: Prisma.InputJsonValue;
  sourcePayloadId?: string | null;
  sourceRequestFingerprint?: string | null;
  contentHash?: string | null;
  fetchedAt: Date;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof PrismaNamespace.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function toDto(row: {
  id: string;
  characterId: string;
  seasonId: string;
  blizzardSeasonId: number | null;
  raiderIoSeasonSlug: string | null;
  evidenceKind: string;
  compatibilityVersion: string;
  state: string;
  source: string;
  payload: unknown;
  sourcePayloadId: string | null;
  sourceRequestFingerprint: string | null;
  contentHash: string | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): CharacterExperienceEvidenceDTO {
  return {
    id: row.id,
    characterId: row.characterId,
    seasonId: row.seasonId,
    blizzardSeasonId: row.blizzardSeasonId,
    raiderIoSeasonSlug: row.raiderIoSeasonSlug,
    evidenceKind: row.evidenceKind,
    compatibilityVersion: row.compatibilityVersion,
    state: row.state,
    source: row.source,
    payload: row.payload,
    sourcePayloadId: row.sourcePayloadId,
    sourceRequestFingerprint: row.sourceRequestFingerprint,
    contentHash: row.contentHash,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Durable Experience historical evidence repository.
 * Successful closed-season facts only — never write transient provider failures.
 */
export class CharacterExperienceEvidenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(
    identity: CharacterExperienceEvidenceIdentity,
  ): Promise<CharacterExperienceEvidenceDTO | null> {
    const row = await this.prisma.characterExperienceEvidence.findUnique({
      where: {
        characterId_seasonId_evidenceKind_compatibilityVersion: {
          characterId: identity.characterId,
          seasonId: identity.seasonId,
          evidenceKind: identity.evidenceKind,
          compatibilityVersion: identity.compatibilityVersion,
        },
      },
    });
    return row ? toDto(row) : null;
  }

  async findManyForCharacterSeason(input: {
    characterId: string;
    seasonId: string;
  }): Promise<CharacterExperienceEvidenceDTO[]> {
    const rows = await this.prisma.characterExperienceEvidence.findMany({
      where: {
        characterId: input.characterId,
        seasonId: input.seasonId,
      },
      orderBy: [{ evidenceKind: "asc" }, { compatibilityVersion: "asc" }],
    });
    return rows.map(toDto);
  }

  /**
   * Insert-or-keep successful evidence. Existing compatible rows win (immutable).
   * Does not overwrite a successful fact with a later fetch of the same identity.
   */
  async upsertImmutable(
    input: UpsertCharacterExperienceEvidenceInput,
  ): Promise<{ row: CharacterExperienceEvidenceDTO; created: boolean }> {
    const existing = await this.find(input);
    if (existing) {
      return { row: existing, created: false };
    }

    try {
      const created = await this.prisma.characterExperienceEvidence.create({
        data: {
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
        },
      });
      return { row: toDto(created), created: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.find(input);
      if (!raced) throw error;
      return { row: raced, created: false };
    }
  }
}

export function createCharacterExperienceEvidenceRepository(
  prisma: PrismaClient,
): CharacterExperienceEvidenceRepository {
  return new CharacterExperienceEvidenceRepository(prisma);
}
