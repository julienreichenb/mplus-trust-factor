import type { Prisma, PrismaClient } from "@prisma/client";
import {
  NONE_CONTEXT_REVISION_KEY,
  SeasonScoreContextRepository,
} from "./season-score-context-repository.js";

export interface CharacterScoreIdentity {
  characterId: string;
  seasonId: string;
  scoringVersion: string;
  contextRevisionKey?: string;
  /** Defaults to product STATIC lane (`static`). */
  abilityCatalogExecutionKey?: string;
}

export interface SaveCharacterScoreInput extends CharacterScoreIdentity {
  contextRevisionId?: string | null;
  contextDistributionSnapshotId?: string | null;
  performance?: number | null;
  utility?: number | null;
  survival?: number | null;
  experience?: number | null;
  composite?: number | null;
  contextualScore?: number | null;
  confidence?: number | null;
  tier?: string | null;
  dimensionDetails?: Prisma.InputJsonValue | null;
  selectedRuns: Prisma.InputJsonValue;
  calculatedAt?: Date;
  abilityCatalogExecutionMode?: "STATIC" | "RELEASE";
  abilityCatalogVersionId?: string | null;
  abilityCatalogReleaseId?: string | null;
  abilityCatalogContentDigest?: string | null;
  abilityCatalogReleaseKey?: string | null;
}

export class CharacterScoreRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(identity: CharacterScoreIdentity) {
    return this.prisma.characterScore.findUnique({
      where: {
        characterId_seasonId_scoringVersion_contextRevisionKey_abilityCatalogExecutionKey: {
          characterId: identity.characterId,
          seasonId: identity.seasonId,
          scoringVersion: identity.scoringVersion,
          contextRevisionKey: identity.contextRevisionKey ?? NONE_CONTEXT_REVISION_KEY,
          abilityCatalogExecutionKey: identity.abilityCatalogExecutionKey ?? "static",
        },
      },
    });
  }

  /**
   * Timestamp-latest row (any season/revision). Prefer
   * {@link findAuthoritativeForCharacter} for product reads.
   */
  async findLatestForCharacter(characterId: string) {
    return this.prisma.characterScore.findFirst({
      where: {
        characterId,
        abilityCatalogExecutionMode: "STATIC",
      },
      orderBy: { calculatedAt: "desc" },
      include: { season: { select: { slug: true } } },
    });
  }

  /**
   * Product authority: pick the season from the latest-calculated CharacterScore,
   * then prefer the row matching that season's published context revision.
   * RELEASE-pinned scores are excluded from product authority.
   */
  async findAuthoritativeForCharacter(characterId: string) {
    const latest = await this.findLatestForCharacter(characterId);
    if (!latest) return null;

    const published = await new SeasonScoreContextRepository(this.prisma).findPublishedForSeason(
      latest.seasonId,
    );
    const contextRevisionKey = published?.id ?? NONE_CONTEXT_REVISION_KEY;
    const preferred = await this.prisma.characterScore.findUnique({
      where: {
        characterId_seasonId_scoringVersion_contextRevisionKey_abilityCatalogExecutionKey: {
          characterId: latest.characterId,
          seasonId: latest.seasonId,
          scoringVersion: latest.scoringVersion,
          contextRevisionKey,
          abilityCatalogExecutionKey: latest.abilityCatalogExecutionKey ?? "static",
        },
      },
      include: { season: { select: { slug: true } } },
    });
    if (preferred) return preferred;

    return this.prisma.characterScore.findFirst({
      where: {
        characterId: latest.characterId,
        seasonId: latest.seasonId,
        scoringVersion: latest.scoringVersion,
        abilityCatalogExecutionMode: "STATIC",
      },
      orderBy: { calculatedAt: "desc" },
      include: { season: { select: { slug: true } } },
    });
  }

  async save(input: SaveCharacterScoreInput) {
    const calculatedAt = input.calculatedAt ?? new Date();
    const contextRevisionKey = input.contextRevisionKey ?? NONE_CONTEXT_REVISION_KEY;
    const abilityCatalogExecutionKey = input.abilityCatalogExecutionKey ?? "static";
    const abilityCatalogExecutionMode = input.abilityCatalogExecutionMode ?? "STATIC";
    return this.prisma.characterScore.upsert({
      where: {
        characterId_seasonId_scoringVersion_contextRevisionKey_abilityCatalogExecutionKey: {
          characterId: input.characterId,
          seasonId: input.seasonId,
          scoringVersion: input.scoringVersion,
          contextRevisionKey,
          abilityCatalogExecutionKey,
        },
      },
      create: {
        characterId: input.characterId,
        seasonId: input.seasonId,
        scoringVersion: input.scoringVersion,
        contextRevisionKey,
        contextRevisionId: input.contextRevisionId ?? null,
        contextDistributionSnapshotId: input.contextDistributionSnapshotId ?? null,
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        contextualScore: input.contextualScore ?? null,
        confidence: input.confidence ?? null,
        tier: input.tier ?? null,
        dimensionDetails: input.dimensionDetails ?? undefined,
        selectedRuns: input.selectedRuns,
        calculatedAt,
        abilityCatalogExecutionMode,
        abilityCatalogExecutionKey,
        abilityCatalogVersionId: input.abilityCatalogVersionId ?? null,
        abilityCatalogReleaseId: input.abilityCatalogReleaseId ?? null,
        abilityCatalogContentDigest: input.abilityCatalogContentDigest ?? null,
        abilityCatalogReleaseKey: input.abilityCatalogReleaseKey ?? null,
      },
      update: {
        contextRevisionId: input.contextRevisionId ?? null,
        contextDistributionSnapshotId: input.contextDistributionSnapshotId ?? null,
        performance: input.performance ?? null,
        utility: input.utility ?? null,
        survival: input.survival ?? null,
        experience: input.experience ?? null,
        composite: input.composite ?? null,
        contextualScore: input.contextualScore ?? null,
        confidence: input.confidence ?? null,
        tier: input.tier ?? null,
        dimensionDetails: input.dimensionDetails ?? undefined,
        selectedRuns: input.selectedRuns,
        calculatedAt,
        abilityCatalogExecutionMode,
        abilityCatalogVersionId: input.abilityCatalogVersionId ?? null,
        abilityCatalogReleaseId: input.abilityCatalogReleaseId ?? null,
        abilityCatalogContentDigest: input.abilityCatalogContentDigest ?? null,
        abilityCatalogReleaseKey: input.abilityCatalogReleaseKey ?? null,
      },
    });
  }
}

export function createCharacterScoreRepository(
  prisma: PrismaClient,
): CharacterScoreRepository {
  return new CharacterScoreRepository(prisma);
}
