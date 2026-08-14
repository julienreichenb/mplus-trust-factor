/**
 * Product Character page / profile score resolution.
 *
 * Operational CharacterScore (from scoreCharacter) is the source of truth for
 * the website. Published ScoreSnapshot is used only when no CharacterScore exists.
 * This prevents SCORING_PUBLICATION_ENABLED / stale published U from masking a
 * fresh operational composite.
 *
 * Revision authority: prefer the CharacterScore matching the published context
 * revision for the score's season. While N+1 is published but not yet persisted,
 * keep showing the latest existing row for that season (typically N).
 */
import type { ScoreSnapshotDTO } from "@mplus/contracts";
import { CharacterScoreRepository, type PrismaClient } from "@mplus/database";
import { mapCharacterScoreToSnapshotDto } from "./character-score-read.js";
import { mapScoreSnapshot } from "./mappers.js";
import type { ScoreSnapshotWithRelations } from "@mplus/worker";

export type ProductScoreSource = "character_score" | "published_snapshot" | "none";

export interface ResolvedProductScore {
  source: ProductScoreSource;
  score: ScoreSnapshotDTO | null;
  characterScoreCalculatedAt: Date | null;
  publishedCalculatedAt: Date | null;
}

export async function resolveProductScoreDto(input: {
  prisma: PrismaClient;
  characterId: string;
  publishedSnapshot: ScoreSnapshotWithRelations | null;
  modelKey?: string;
  modelVersion?: number;
  dimensionWeights?: {
    performance: number;
    survival: number;
    utility: number;
    experience: number;
  };
  gradeThresholds?: { S: number; A: number; B: number; C: number };
}): Promise<ResolvedProductScore> {
  const scores = new CharacterScoreRepository(input.prisma);
  const row = await scores.findAuthoritativeForCharacter(input.characterId);
  const publishedDto = input.publishedSnapshot
    ? mapScoreSnapshot(input.publishedSnapshot)
    : null;

  if (row) {
    const operational = mapCharacterScoreToSnapshotDto(row, {
      modelKey: input.modelKey ?? publishedDto?.modelKey,
      modelVersion: input.modelVersion ?? publishedDto?.modelVersion,
      dimensionWeights: input.dimensionWeights,
      gradeThresholds: input.gradeThresholds,
    });
    // Prefer operational CharacterScore whenever present — even if an older
    // published snapshot exists with grade U / empty dimensions.
    return {
      source: "character_score",
      score: operational,
      characterScoreCalculatedAt: row.calculatedAt,
      publishedCalculatedAt: input.publishedSnapshot?.calculatedAt ?? null,
    };
  }

  if (publishedDto) {
    return {
      source: "published_snapshot",
      score: publishedDto,
      characterScoreCalculatedAt: null,
      publishedCalculatedAt: input.publishedSnapshot!.calculatedAt,
    };
  }

  return {
    source: "none",
    score: null,
    characterScoreCalculatedAt: null,
    publishedCalculatedAt: null,
  };
}
