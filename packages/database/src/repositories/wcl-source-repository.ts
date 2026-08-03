/**
 * Durable WCL source digest / dataset-page / roster persistence.
 * Scoring-neutral: never stores scores, grades, weights, or calculator outputs.
 */
import {
  assertNeutralWclRunDigest,
  WCL_RAW_PAGE_RETENTION_DAYS,
  type WclParticipantMappingState,
  type WclRunSourceDigestDocument,
} from "@mplus/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultWclRawPageRetentionUntil(now = new Date()): Date {
  return new Date(now.getTime() + WCL_RAW_PAGE_RETENTION_DAYS * DAY_MS);
}

export interface UpsertWclRunSourceDigestInput {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  schemaVersion: string;
  providerContractVersion: string;
  contentFingerprint: string;
  digest: WclRunSourceDigestDocument;
  rawBytesStored?: bigint | number | null;
  digestBytes?: number | null;
  completenessState: string;
  visibilityState: string;
  region?: string | null;
  dungeonSlug?: string | null;
  keyLevel?: number | null;
  timed?: boolean | null;
  masterDataArtifactId?: string | null;
  acquiredAt: Date;
}

export interface UpsertWclRunParticipantInput {
  digestId: string;
  wclActorId: number;
  wclCanonicalId?: string | null;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
  ownedPetActorIds?: number[];
  /** Mapping fields only — never rewrite provider identity on conflict. */
  characterId?: string | null;
  blizzardCharacterId?: string | null;
  mappingState?: WclParticipantMappingState;
  mappingConfidence?: number | null;
}

export interface CreateEvidenceDatasetPageInput {
  datasetId?: string | null;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  datasetKey: string;
  pageIndex: number;
  pageCursor?: string | null;
  artifactId: string;
  contentHash: string;
  providerContractVersion: string;
  schemaVersion: string;
  eventCount?: number;
}

export class WclSourceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findWclRunSourceDigest(
    reportCode: string,
    fightId: number,
    reportRevision: number,
  ) {
    return this.prisma.wclRunSourceDigest.findUnique({
      where: {
        reportCode_fightId_reportRevision: { reportCode, fightId, reportRevision },
      },
      include: { participants: true },
    });
  }

  /**
   * Idempotent upsert. Same identity + fingerprint → reuse.
   * Same identity + different fingerprint → fail closed (immutable revision evidence).
   */
  async upsertWclRunSourceDigest(input: UpsertWclRunSourceDigestInput) {
    const digestDoc = assertNeutralWclRunDigest(input.digest);
    const existing = await this.findWclRunSourceDigest(
      input.reportCode,
      input.fightId,
      input.reportRevision,
    );
    if (existing) {
      if (existing.contentFingerprint !== input.contentFingerprint) {
        throw new Error(
          [
            "wcl_run_source_digest_fingerprint_conflict",
            `report=${input.reportCode}`,
            `fight=${input.fightId}`,
            `revision=${input.reportRevision}`,
            `existing=${existing.contentFingerprint}`,
            `incoming=${input.contentFingerprint}`,
          ].join(":"),
        );
      }
      return { row: existing, created: false };
    }

    try {
      const row = await this.prisma.wclRunSourceDigest.create({
        data: {
          reportCode: input.reportCode,
          fightId: input.fightId,
          reportRevision: input.reportRevision,
          schemaVersion: input.schemaVersion,
          providerContractVersion: input.providerContractVersion,
          contentFingerprint: input.contentFingerprint,
          digest: digestDoc as unknown as Prisma.InputJsonValue,
          rawBytesStored:
            input.rawBytesStored == null ? null : BigInt(input.rawBytesStored),
          digestBytes: input.digestBytes ?? null,
          completenessState: input.completenessState,
          visibilityState: input.visibilityState,
          region: input.region ?? null,
          dungeonSlug: input.dungeonSlug ?? null,
          keyLevel: input.keyLevel ?? null,
          timed: input.timed ?? null,
          masterDataArtifactId: input.masterDataArtifactId ?? null,
          acquiredAt: input.acquiredAt,
        },
        include: { participants: true },
      });
      return { row, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.findWclRunSourceDigest(
          input.reportCode,
          input.fightId,
          input.reportRevision,
        );
        if (raced && raced.contentFingerprint === input.contentFingerprint) {
          return { row: raced, created: false };
        }
      }
      throw error;
    }
  }

  async upsertWclRunParticipant(input: UpsertWclRunParticipantInput) {
    const existing = await this.prisma.wclRunParticipant.findUnique({
      where: {
        digestId_wclActorId: {
          digestId: input.digestId,
          wclActorId: input.wclActorId,
        },
      },
    });

    if (existing) {
      // Provider identity is immutable; only mapping fields may change.
      return this.prisma.wclRunParticipant.update({
        where: { id: existing.id },
        data: {
          characterId: input.characterId !== undefined ? input.characterId : existing.characterId,
          blizzardCharacterId:
            input.blizzardCharacterId !== undefined
              ? input.blizzardCharacterId
              : existing.blizzardCharacterId,
          mappingState: input.mappingState ?? existing.mappingState,
          mappingConfidence:
            input.mappingConfidence !== undefined
              ? input.mappingConfidence
              : existing.mappingConfidence,
        },
      });
    }

    return this.prisma.wclRunParticipant.create({
      data: {
        digestId: input.digestId,
        wclActorId: input.wclActorId,
        wclCanonicalId: input.wclCanonicalId ?? null,
        characterName: input.characterName,
        realmSlug: input.realmSlug,
        regionCode: input.regionCode,
        classSlug: input.classSlug ?? null,
        specSlug: input.specSlug ?? null,
        role: input.role ?? null,
        characterId: input.characterId ?? null,
        blizzardCharacterId: input.blizzardCharacterId ?? null,
        mappingState: input.mappingState ?? "UNRESOLVED",
        mappingConfidence: input.mappingConfidence ?? null,
        ownedPetActorIds: (input.ownedPetActorIds ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findDigestsByCharacterId(characterId: string) {
    return this.prisma.wclRunSourceDigest.findMany({
      where: { participants: { some: { characterId } } },
      include: { participants: true },
      orderBy: { acquiredAt: "desc" },
    });
  }

  async findDigestsByBlizzardCharacterId(blizzardCharacterId: string) {
    return this.prisma.wclRunSourceDigest.findMany({
      where: { participants: { some: { blizzardCharacterId } } },
      include: { participants: true },
      orderBy: { acquiredAt: "desc" },
    });
  }

  async findDigestsByWclCanonicalId(wclCanonicalId: string) {
    return this.prisma.wclRunSourceDigest.findMany({
      where: { participants: { some: { wclCanonicalId } } },
      include: { participants: true },
      orderBy: { acquiredAt: "desc" },
    });
  }

  async findDigestsByRegionRealmName(input: {
    regionCode: string;
    realmSlug: string;
    characterName: string;
  }) {
    return this.prisma.wclRunSourceDigest.findMany({
      where: {
        participants: {
          some: {
            regionCode: input.regionCode,
            realmSlug: input.realmSlug,
            characterName: input.characterName,
          },
        },
      },
      include: { participants: true },
      orderBy: { acquiredAt: "desc" },
    });
  }

  async createEvidenceDatasetPage(input: CreateEvidenceDatasetPageInput) {
    return this.prisma.evidenceDatasetPage.upsert({
      where: {
        reportCode_fightId_reportRevision_datasetKey_pageIndex_providerContractVersion_schemaVersion:
          {
            reportCode: input.reportCode,
            fightId: input.fightId,
            reportRevision: input.reportRevision,
            datasetKey: input.datasetKey,
            pageIndex: input.pageIndex,
            providerContractVersion: input.providerContractVersion,
            schemaVersion: input.schemaVersion,
          },
      },
      create: {
        datasetId: input.datasetId ?? null,
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
        datasetKey: input.datasetKey,
        pageIndex: input.pageIndex,
        pageCursor: input.pageCursor ?? null,
        artifactId: input.artifactId,
        contentHash: input.contentHash,
        providerContractVersion: input.providerContractVersion,
        schemaVersion: input.schemaVersion,
        eventCount: input.eventCount ?? 0,
      },
      update: {
        // Immutable page identity — only attach datasetId if previously null.
        datasetId: input.datasetId ?? undefined,
      },
    });
  }

  async findEvidenceDatasetPages(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    datasetKey: string;
  }) {
    return this.prisma.evidenceDatasetPage.findMany({
      where: {
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
        datasetKey: input.datasetKey,
      },
      orderBy: { pageIndex: "asc" },
    });
  }

  /** Latest digest revision for a report+fight (for fight-details reuse probes). */
  async findLatestDigestRevision(reportCode: string, fightId: number): Promise<number | null> {
    const row = await this.prisma.wclRunSourceDigest.findFirst({
      where: { reportCode, fightId },
      orderBy: { acquiredAt: "desc" },
      select: { reportRevision: true },
    });
    return row?.reportRevision ?? null;
  }

  /** Latest fight-details page revision for report+fight. */
  async findLatestDatasetPageRevision(
    reportCode: string,
    fightId: number,
    datasetKey: string,
  ): Promise<number | null> {
    const row = await this.prisma.evidenceDatasetPage.findFirst({
      where: { reportCode, fightId, datasetKey },
      orderBy: { createdAt: "desc" },
      select: { reportRevision: true },
    });
    return row?.reportRevision ?? null;
  }

  /**
   * Persistent cache probe: complete page set for a source identity + dataset.
   */
  async findCompletePersistedSource(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    datasetKey: string;
    expectedPageCount?: number;
  }) {
    const pages = await this.findEvidenceDatasetPages(input);
    if (pages.length === 0) return null;
    if (
      input.expectedPageCount != null &&
      pages.length < input.expectedPageCount
    ) {
      return null;
    }
    const digest = await this.findWclRunSourceDigest(
      input.reportCode,
      input.fightId,
      input.reportRevision,
    );
    return { pages, digest };
  }
}
