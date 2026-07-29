import type {
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  RankingEligibilityDTO,
  ScoreDimension,
} from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { mapScoreSnapshot } from "../lib/mappers.js";

const MIN_CHARACTERS = 2;
const MAX_CHARACTERS = 10;

const DIMENSIONS: ScoreDimension[] = ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE", "RAID", "AUTHENTICITY"];

type ComparisonEntry = CharacterComparisonResponse["entries"][number];

interface ResolvedEntry {
  identity: ComparisonEntry["identity"];
  characterId: string | null;
  overallScore: number | null;
  grade: ComparisonEntry["grade"];
  confidence: number | null;
  dimensions: ComparisonEntry["dimensions"];
  rankingEligibility: RankingEligibilityDTO | null;
  modelKey: string | null;
  modelVersion: number | null;
  seasonSlug: string | null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const mid = Math.floor(sortedValues.length / 2);
  const value =
    sortedValues.length % 2 === 0
      ? ((sortedValues[mid - 1] ?? 0) + (sortedValues[mid] ?? 0)) / 2
      : (sortedValues[mid] ?? 0);
  return round(value);
}

function isRankingIncluded(entry: ResolvedEntry, targetModelVersion: number): boolean {
  if (entry.overallScore == null) return false;
  if (entry.rankingEligibility) return entry.rankingEligibility.eligible;
  // Legacy snapshots without metadata: only include when already on the ranking model.
  return (entry.modelVersion ?? 0) >= 6 && targetModelVersion >= 6;
}

/**
 * Compares 2–10 character identities on a shared score model/season.
 * Ineligible profiles remain visible but are excluded from median/best ranking math.
 */
export class ComparisonService {
  constructor(private readonly container: ApiContainer) {}

  private get repositories() {
    return this.container.worker.repositories;
  }

  async compare(request: CharacterComparisonRequest): Promise<CharacterComparisonResponse> {
    if (request.characters.length < MIN_CHARACTERS || request.characters.length > MAX_CHARACTERS) {
      throw HttpError.badRequest(
        "INVALID_COMPARISON_SIZE",
        `A comparison requires between ${MIN_CHARACTERS} and ${MAX_CHARACTERS} characters (received ${request.characters.length})`,
      );
    }

    const activeModel = await this.repositories.score.getActiveModel(
      request.modelKey ?? this.container.env.ACTIVE_SCORE_MODEL_KEY,
    );
    const targetModelKey = request.modelKey ?? activeModel?.key ?? this.container.env.ACTIVE_SCORE_MODEL_KEY;
    const targetModelVersion =
      request.modelVersion ?? activeModel?.version ?? this.container.env.ACTIVE_SCORE_MODEL_VERSION;

    const resolved = await this.resolveEntries(request);
    this.assertModelVersionsMatch(resolved, targetModelKey, targetModelVersion);
    const seasonSlug = this.resolveSeasonSlug(request, resolved);

    const ranked = resolved.filter((entry) => isRankingIncluded(entry, targetModelVersion));
    const overallValues = ranked
      .map((entry) => entry.overallScore)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const overallMedian = median(overallValues);
    const overallBest = overallValues.length > 0 ? Math.max(...overallValues) : null;

    const dimensionMedian = new Map<ScoreDimension, number>();
    const dimensionBest = new Map<ScoreDimension, number>();
    for (const dimension of DIMENSIONS) {
      const values = ranked
        .map((entry) => entry.dimensions?.find((d) => d.dimension === dimension)?.score)
        .filter((value): value is number => typeof value === "number")
        .sort((a, b) => a - b);
      if (values.length > 0) {
        dimensionMedian.set(dimension, median(values) ?? 0);
        dimensionBest.set(dimension, Math.max(...values));
      }
    }

    const entries: ComparisonEntry[] = resolved.map((entry) => {
      const rankingIncluded = isRankingIncluded(entry, targetModelVersion);
      const deltasFromMedian: Record<string, number | null> = {
        overall:
          rankingIncluded && entry.overallScore !== null && overallMedian !== null
            ? round(entry.overallScore - overallMedian)
            : null,
      };
      const deltasFromBest: Record<string, number | null> = {
        overall:
          rankingIncluded && entry.overallScore !== null && overallBest !== null
            ? round(entry.overallScore - overallBest)
            : null,
      };
      for (const dimension of DIMENSIONS) {
        const value = entry.dimensions?.find((d) => d.dimension === dimension)?.score ?? null;
        const dimMedian = dimensionMedian.get(dimension);
        const dimBest = dimensionBest.get(dimension);
        deltasFromMedian[dimension] =
          rankingIncluded && value !== null && dimMedian !== undefined
            ? round(value - dimMedian)
            : null;
        deltasFromBest[dimension] =
          rankingIncluded && value !== null && dimBest !== undefined ? round(value - dimBest) : null;
      }
      return {
        identity: entry.identity,
        characterId: entry.characterId,
        overallScore: entry.overallScore,
        grade: entry.grade,
        confidence: entry.confidence,
        dimensions: entry.dimensions,
        rankingEligibility: entry.rankingEligibility,
        rankingIncluded,
        deltasFromMedian,
        deltasFromBest,
      };
    });

    return {
      modelKey: targetModelKey,
      modelVersion: targetModelVersion,
      seasonSlug,
      calculatedAt: new Date().toISOString(),
      entries,
    };
  }

  private async resolveEntries(request: CharacterComparisonRequest): Promise<ResolvedEntry[]> {
    const resolved: ResolvedEntry[] = [];
    for (const identity of request.characters) {
      const character = await this.repositories.character.findByIdentity(identity);
      if (!character) {
        resolved.push(emptyEntry(identity, null));
        continue;
      }
      const snapshot = await this.repositories.score.getLatestSnapshot(character.id);
      if (!snapshot) {
        resolved.push(emptyEntry(identity, character.id));
        continue;
      }
      const dto = mapScoreSnapshot(snapshot);
      resolved.push({
        identity,
        characterId: character.id,
        overallScore: dto.overallScore,
        grade: dto.grade,
        confidence: dto.confidence,
        dimensions: dto.dimensions,
        rankingEligibility: dto.rankingEligibility ?? null,
        modelKey: dto.modelKey,
        modelVersion: dto.modelVersion,
        seasonSlug: dto.seasonSlug,
      });
    }
    return resolved;
  }

  private assertModelVersionsMatch(resolved: ResolvedEntry[], modelKey: string, modelVersion: number): void {
    const mismatched = resolved.filter(
      (entry) => entry.modelKey !== null && (entry.modelKey !== modelKey || entry.modelVersion !== modelVersion),
    );
    if (mismatched.length > 0) {
      throw HttpError.conflict(
        "MODEL_VERSION_MISMATCH",
        "All characters in a comparison must share the same score model key/version",
        {
          expected: { modelKey, modelVersion },
          offending: mismatched.map((entry) => ({
            identity: entry.identity,
            modelKey: entry.modelKey,
            modelVersion: entry.modelVersion,
          })),
        },
      );
    }
  }

  private resolveSeasonSlug(request: CharacterComparisonRequest, resolved: ResolvedEntry[]): string {
    const seasonSlugs = new Set(
      resolved.map((entry) => entry.seasonSlug).filter((slug): slug is string => Boolean(slug)),
    );
    if (request.seasonSlug) {
      if (seasonSlugs.size > 0 && !seasonSlugs.has(request.seasonSlug)) {
        throw HttpError.conflict("SEASON_MISMATCH", "No resolved scores match the requested season", {
          requestedSeasonSlug: request.seasonSlug,
        });
      }
      return request.seasonSlug;
    }
    return [...seasonSlugs][0] ?? "unknown";
  }
}

function emptyEntry(identity: ComparisonEntry["identity"], characterId: string | null): ResolvedEntry {
  return {
    identity,
    characterId,
    overallScore: null,
    grade: null,
    confidence: null,
    dimensions: null,
    rankingEligibility: null,
    modelKey: null,
    modelVersion: null,
    seasonSlug: null,
  };
}
