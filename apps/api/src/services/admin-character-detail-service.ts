import { presentWowClass, WOW_CLASS_COLORS } from "@mplus/config";
import {
  projectScoreExplainabilityAudit,
  tryParsePersistedScoreExplainability,
} from "@mplus/scoring";
import type { ScoreExplainabilityV1 } from "@mplus/contracts";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";

function wclFightUrl(reportCode: string, fightId: number): string {
  return `https://www.warcraftlogs.com/reports/${encodeURIComponent(reportCode)}?fight=${fightId}`;
}

function readAvatar(rawSummary: unknown): string | null {
  if (!rawSummary || typeof rawSummary !== "object") return null;
  const media = (rawSummary as { media?: { avatarUrl?: unknown } }).media;
  return typeof media?.avatarUrl === "string" ? media.avatarUrl : null;
}

/** Persisted job/score catalog pin — never inferred from current ACTIVE. */
export type AdminCatalogIdentityDTO = {
  executionMode: string | null;
  releaseKey: string | null;
  contentDigest: string | null;
  contentDigestShort: string | null;
  releaseId: string | null;
  versionId: string | null;
};

function catalogIdentityFromRow(row: {
  abilityCatalogExecutionMode?: string | null;
  abilityCatalogReleaseKey?: string | null;
  abilityCatalogContentDigest?: string | null;
  abilityCatalogReleaseId?: string | null;
  abilityCatalogVersionId?: string | null;
}): AdminCatalogIdentityDTO {
  const digest =
    typeof row.abilityCatalogContentDigest === "string" && row.abilityCatalogContentDigest.length > 0
      ? row.abilityCatalogContentDigest
      : null;
  return {
    executionMode: row.abilityCatalogExecutionMode ?? null,
    releaseKey: row.abilityCatalogReleaseKey ?? null,
    contentDigest: digest,
    contentDigestShort: digest ? digest.slice(0, 12) : null,
    releaseId: row.abilityCatalogReleaseId ?? null,
    versionId: row.abilityCatalogVersionId ?? null,
  };
}

function readDigestRunMeta(sourceMetadata: unknown): {
  dungeonSlug: string | null;
  keyLevel: number | null;
} {
  const root =
    sourceMetadata && typeof sourceMetadata === "object"
      ? (sourceMetadata as Record<string, unknown>)
      : null;
  const digest =
    root && root.digest && typeof root.digest === "object"
      ? (root.digest as Record<string, unknown>)
      : root;
  const dungeonRaw = typeof digest?.dungeonSlug === "string" ? digest.dungeonSlug.trim() : "";
  const keyLevel =
    typeof digest?.keyLevel === "number" && Number.isFinite(digest.keyLevel)
      ? digest.keyLevel
      : null;
  return {
    dungeonSlug: dungeonRaw || null,
    keyLevel,
  };
}

export type AdminCharacterDetailDTO = {
  character: {
    id: string;
    region: string;
    realmSlug: string;
    realmName: string;
    name: string;
    classSlug: string | null;
    classColor: string | null;
    avatarUrl: string | null;
    classIconUrl: string | null;
    mythicPlusScore: number | null;
    lastSeenAt: string | null;
    lastPublicRefreshAt: string | null;
    publicPath: string;
  };
  digests: Array<{
    id: string;
    participantActorId: number;
    characterName: string;
    realmSlug: string | null;
    regionCode: string | null;
    classSlug: string | null;
    specSlug: string | null;
    role: string | null;
    extractorVersion: string;
    dungeonSlug: string | null;
    keyLevel: number | null;
    createdAt: string;
    updatedAt: string;
    offensive: unknown;
    utility: unknown;
    survival: unknown;
    sourceMetadata: unknown;
    raw: {
      id: string;
      reportCode: string;
      fightId: number;
      reportRevision: number;
      acquisitionVersion: string;
      fetchedAt: string;
      providerCost: unknown;
      payloadBytes: number | null;
      payloadKeys: string[];
      wclUrl: string;
    };
  }>;
  characterScores: Array<{
    id: string;
    seasonId: string;
    seasonSlug: string | null;
    scoringVersion: string;
    performance: number | null;
    utility: number | null;
    survival: number | null;
    experience: number | null;
    composite: number | null;
    confidence: number | null;
    tier: string | null;
    dimensionDetails: unknown;
    selectedRuns: unknown;
    calculatedAt: string;
    createdAt: string;
    updatedAt: string;
    /**
     * Canonical ScoreExplainabilityV1 audit projection (bounded).
     * Null on legacy rows without persisted explainability.
     * Distinct from Scoring V2 EvidenceManifest forensics.
     */
    scoreExplainabilityAudit: ScoreExplainabilityV1 | null;
    catalog: AdminCatalogIdentityDTO;
  }>;
  scoreSnapshots: Array<{
    id: string;
    seasonId: string;
    seasonSlug: string | null;
    scoreModelId: string;
    scoreModelKey: string | null;
    scoreModelVersion: number | null;
    scopeType: string;
    scopeKey: string | null;
    overallScore: number;
    grade: string;
    skillScore: number;
    authenticityScore: number;
    confidence: number;
    calculatedAt: string;
    publicationStatus: string;
    isPublic: boolean;
    coverageState: string | null;
    rejectionReason: string | null;
    publishedAt: string | null;
    explanation: unknown;
    catalog: AdminCatalogIdentityDTO;
  }>;
};

export type AdminWclRawPayloadDTO = {
  id: string;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  acquisitionVersion: string;
  fetchedAt: string;
  providerCost: unknown;
  wclUrl: string;
  payload: unknown;
};

/** Admin-only character inspection: digests, raw WCL metadata, score history. */
export class AdminCharacterDetailService {
  constructor(private readonly container: ApiContainer) {}

  private prisma() {
    return this.container.worker.prisma;
  }

  async getDetail(characterId: string): Promise<AdminCharacterDetailDTO> {
    const prisma = this.prisma();
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      include: {
        region: true,
        realm: true,
        gameClass: true,
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 1,
          select: { rawSummary: true, mythicRating: true },
        },
      },
    });
    if (!character) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character not found");
    }

    const classSlug = character.gameClass?.slug ?? null;
    const presented = classSlug ? presentWowClass({ classSlug }) : null;
    const latestSnapshot = character.snapshots[0];
    const mythicPlusScore =
      latestSnapshot?.mythicRating != null ? Number(latestSnapshot.mythicRating) : null;

    const digests = await prisma.characterRunDigest.findMany({
      where: { characterId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        rawRun: {
          select: {
            id: true,
            reportCode: true,
            fightId: true,
            reportRevision: true,
            acquisitionVersion: true,
            fetchedAt: true,
            providerCost: true,
          },
        },
      },
    });

    const characterScores = await prisma.characterScore.findMany({
      where: { characterId },
      orderBy: { calculatedAt: "desc" },
      take: 50,
      include: { season: { select: { slug: true } } },
    });

    const scoreSnapshots = await prisma.scoreSnapshot.findMany({
      where: { characterId },
      orderBy: { calculatedAt: "desc" },
      take: 50,
      include: {
        season: { select: { slug: true } },
        scoreModel: { select: { key: true, version: true } },
      },
    });

    const region = character.region.code;
    const realmSlug = character.realm.slug;

    return {
      character: {
        id: character.id,
        region,
        realmSlug,
        realmName: character.realm.name,
        name: character.displayName,
        classSlug,
        classColor: classSlug ? (WOW_CLASS_COLORS[classSlug] ?? null) : null,
        avatarUrl: readAvatar(latestSnapshot?.rawSummary),
        classIconUrl: presented?.iconUrl ?? null,
        mythicPlusScore,
        lastSeenAt: character.lastSeenAt?.toISOString() ?? null,
        lastPublicRefreshAt: character.lastPublicRefreshAt?.toISOString() ?? null,
        publicPath: `/character/${region}/${realmSlug}/${encodeURIComponent(character.displayName)}`,
      },
      digests: digests.map((d) => {
        const runMeta = readDigestRunMeta(d.sourceMetadata);
        return {
          id: d.id,
          participantActorId: d.participantActorId,
          characterName: d.characterName,
          realmSlug: d.realmSlug,
          regionCode: d.regionCode,
          classSlug: d.classSlug,
          specSlug: d.specSlug,
          role: d.role,
          extractorVersion: d.extractorVersion,
          dungeonSlug: runMeta.dungeonSlug,
          keyLevel: runMeta.keyLevel,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
          offensive: d.offensive,
          utility: d.utility,
          survival: d.survival,
          sourceMetadata: d.sourceMetadata,
          raw: {
            id: d.rawRun.id,
            reportCode: d.rawRun.reportCode,
            fightId: d.rawRun.fightId,
            reportRevision: d.rawRun.reportRevision,
            acquisitionVersion: d.rawRun.acquisitionVersion,
            fetchedAt: d.rawRun.fetchedAt.toISOString(),
            providerCost: d.rawRun.providerCost,
            payloadBytes: null as number | null,
            payloadKeys: [] as string[],
            wclUrl: wclFightUrl(d.rawRun.reportCode, d.rawRun.fightId),
          },
        };
      }),
      characterScores: characterScores.map((s) => {
        const details =
          s.dimensionDetails && typeof s.dimensionDetails === "object"
            ? (s.dimensionDetails as { explainability?: unknown })
            : null;
        const canonical = tryParsePersistedScoreExplainability(details?.explainability);
        return {
          id: s.id,
          seasonId: s.seasonId,
          seasonSlug: s.season.slug,
          scoringVersion: s.scoringVersion,
          performance: s.performance,
          utility: s.utility,
          survival: s.survival,
          experience: s.experience,
          composite: s.composite,
          confidence: s.confidence,
          tier: s.tier,
          dimensionDetails: s.dimensionDetails,
          selectedRuns: s.selectedRuns,
          calculatedAt: s.calculatedAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          scoreExplainabilityAudit: canonical
            ? projectScoreExplainabilityAudit(canonical)
            : null,
          catalog: catalogIdentityFromRow(s),
        };
      }),
      scoreSnapshots: scoreSnapshots.map((s) => ({
        id: s.id,
        seasonId: s.seasonId,
        seasonSlug: s.season.slug,
        scoreModelId: s.scoreModelId,
        scoreModelKey: s.scoreModel.key,
        scoreModelVersion: s.scoreModel.version,
        scopeType: s.scopeType,
        scopeKey: s.scopeKey,
        overallScore: Number(s.overallScore),
        grade: s.grade,
        skillScore: Number(s.skillScore),
        authenticityScore: Number(s.authenticityScore),
        confidence: Number(s.confidence),
        calculatedAt: s.calculatedAt.toISOString(),
        publicationStatus: s.publicationStatus,
        isPublic: s.isPublic,
        coverageState: s.coverageState,
        rejectionReason: s.rejectionReason,
        publishedAt: s.publishedAt?.toISOString() ?? null,
        explanation: s.explanation,
        catalog: catalogIdentityFromRow(s),
      })),
    };
  }

  async getRawPayload(characterId: string, rawRunId: string): Promise<AdminWclRawPayloadDTO> {
    const prisma = this.prisma();
    const linked = await prisma.characterRunDigest.findFirst({
      where: { characterId, rawRunId },
      select: { id: true },
    });
    if (!linked) {
      throw HttpError.notFound("WCL_RAW_NOT_FOUND", "Raw WCL run not linked to this character");
    }
    const raw = await prisma.wclRunRaw.findUnique({ where: { id: rawRunId } });
    if (!raw) {
      throw HttpError.notFound("WCL_RAW_NOT_FOUND", "Raw WCL run not found");
    }
    return {
      id: raw.id,
      reportCode: raw.reportCode,
      fightId: raw.fightId,
      reportRevision: raw.reportRevision,
      acquisitionVersion: raw.acquisitionVersion,
      fetchedAt: raw.fetchedAt.toISOString(),
      providerCost: raw.providerCost,
      wclUrl: wclFightUrl(raw.reportCode, raw.fightId),
      payload: raw.payload,
    };
  }
}
