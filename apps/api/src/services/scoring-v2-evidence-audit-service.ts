/**
 * Admin Scoring V2 evidence audit — DB-only, provider-free.
 * Loads a frozen EvidenceManifest and produces a bounded lineage audit JSON.
 */

import type { ScoringV2EvidenceAuditDocument } from "@mplus/contracts";
import {
  buildScoringV2EvidenceAudit,
  replayScoringV2Dimensions,
  type AuditDatasetInput,
  type AuditDatasetPageInput,
  type AuditFactSetInput,
  type PersistedFactSetRef,
  type ScoringV2PublicDimension,
} from "@mplus/scoring";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";

function decimalToNumber(value: { toString(): string } | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ScoringV2EvidenceAuditService {
  constructor(private readonly container: ApiContainer) {}

  private get prisma() {
    return this.container.worker.prisma;
  }

  async getEvidenceAudit(manifestId: string): Promise<ScoringV2EvidenceAuditDocument> {
    const manifest = await this.prisma.evidenceManifest.findUnique({
      where: { id: manifestId },
      include: {
        slots: {
          include: {
            dungeon: { select: { slug: true } },
            datasets: {
              include: {
                pages: {
                  select: {
                    pageIndex: true,
                    artifactId: true,
                    contentHash: true,
                    eventCount: true,
                    scopeFingerprint: true,
                    reportCode: true,
                    fightId: true,
                    reportRevision: true,
                    datasetKey: true,
                  },
                  orderBy: { pageIndex: "asc" },
                },
              },
            },
            factSets: true,
          },
          orderBy: [{ dungeonId: "asc" }, { slotIndex: "asc" }],
        },
        dimensionComputations: true,
      },
    });

    if (!manifest) {
      throw HttpError.notFound("EVIDENCE_MANIFEST_NOT_FOUND", "Evidence manifest not found");
    }

    const identities = manifest.slots
      .filter(
        (s) =>
          s.reportCode != null &&
          s.fightId != null &&
          s.reportRevision != null,
      )
      .map((s) => ({
        reportCode: s.reportCode!,
        fightId: s.fightId!,
        reportRevision: s.reportRevision!,
      }));

    const uniqueIdentities = [
      ...new Map(
        identities.map((i) => [`${i.reportCode}:${i.fightId}:${i.reportRevision}`, i] as const),
      ).values(),
    ];

    const digests =
      uniqueIdentities.length === 0
        ? []
        : await this.prisma.wclRunSourceDigest.findMany({
            where: {
              OR: uniqueIdentities.map((i) => ({
                reportCode: i.reportCode,
                fightId: i.fightId,
                reportRevision: i.reportRevision,
              })),
            },
            select: {
              id: true,
              reportCode: true,
              fightId: true,
              reportRevision: true,
              masterDataArtifactId: true,
              contentFingerprint: true,
            },
          });

    const pagesByIdentity: AuditDatasetPageInput[] =
      uniqueIdentities.length === 0
        ? []
        : (
            await this.prisma.evidenceDatasetPage.findMany({
              where: {
                OR: uniqueIdentities.map((i) => ({
                  reportCode: i.reportCode,
                  fightId: i.fightId,
                  reportRevision: i.reportRevision,
                })),
              },
              select: {
                pageIndex: true,
                artifactId: true,
                contentHash: true,
                eventCount: true,
                scopeFingerprint: true,
                reportCode: true,
                fightId: true,
                reportRevision: true,
                datasetKey: true,
              },
              orderBy: [{ datasetKey: "asc" }, { pageIndex: "asc" }],
              take: 5_000,
            })
          ).map((p) => ({
            pageIndex: p.pageIndex,
            artifactId: p.artifactId,
            contentHash: p.contentHash,
            eventCount: p.eventCount,
            scopeFingerprint: p.scopeFingerprint,
            reportCode: p.reportCode,
            fightId: p.fightId,
            reportRevision: p.reportRevision,
            datasetKey: p.datasetKey,
          }));

    const datasets: AuditDatasetInput[] = manifest.slots.flatMap((slot) =>
      slot.datasets.map((ds) => ({
        id: ds.id,
        manifestSlotId: ds.manifestSlotId,
        datasetKey: ds.datasetKey,
        compatibilityKey: ds.compatibilityKey,
        artifactId: ds.artifactId,
        schemaVersion: ds.schemaVersion,
        providerContractVersion: ds.providerContractVersion,
        state: ds.state,
        eventCount: ds.eventCount,
        pageCount: ds.pageCount,
        truncated: ds.truncated,
        payloadFingerprint: ds.payloadFingerprint,
        pages: ds.pages.map((p) => ({
          pageIndex: p.pageIndex,
          artifactId: p.artifactId,
          contentHash: p.contentHash,
          eventCount: p.eventCount,
          scopeFingerprint: p.scopeFingerprint,
          reportCode: p.reportCode,
          fightId: p.fightId,
          reportRevision: p.reportRevision,
          datasetKey: p.datasetKey,
        })),
      })),
    );

    const factSets: AuditFactSetInput[] = manifest.slots.flatMap((slot) =>
      slot.factSets.map((fs) => ({
        id: fs.id,
        manifestSlotId: fs.manifestSlotId,
        extractorFamily: fs.extractorFamily,
        extractorVersion: fs.extractorVersion,
        schemaVersion: fs.schemaVersion,
        inputFingerprint: fs.inputFingerprint,
        facts: fs.facts,
        coverage: fs.coverage,
        limitations: fs.limitations,
        relationReportCode: slot.reportCode,
        relationFightId: slot.fightId,
        relationReportRevision: slot.reportRevision,
        dungeonSlug: slot.dungeon.slug,
        slotIndex: slot.slotIndex,
      })),
    );

    const artifactIdSet = new Set<string>();
    for (const ds of datasets) {
      if (ds.artifactId) artifactIdSet.add(ds.artifactId);
    }
    for (const page of pagesByIdentity) {
      if (page.artifactId) artifactIdSet.add(page.artifactId);
    }
    for (const fs of factSets) {
      if (isRecord(fs.coverage) && Array.isArray(fs.coverage.artifactIds)) {
        for (const id of fs.coverage.artifactIds) {
          if (typeof id === "string" && id.length > 0) artifactIdSet.add(id);
        }
      }
    }
    for (const d of digests) {
      if (d.masterDataArtifactId) artifactIdSet.add(d.masterDataArtifactId);
    }

    const artifactRows =
      artifactIdSet.size === 0
        ? []
        : await this.prisma.rawArtifact.findMany({
            where: { id: { in: [...artifactIdSet] } },
            select: {
              id: true,
              provider: true,
              artifactClass: true,
              contentHash: true,
              sizeBytes: true,
              uncompressedSizeBytes: true,
            },
            take: 2_000,
          });
    const artifactsById = Object.fromEntries(
      artifactRows.map((a) => [
        a.id,
        {
          id: a.id,
          provider: String(a.provider),
          artifactClass: a.artifactClass,
          contentHash: a.contentHash,
          byteLength:
            a.uncompressedSizeBytes != null
              ? Number(a.uncompressedSizeBytes)
              : Number(a.sizeBytes),
        },
      ]),
    );

    const dimensions = manifest.dimensionComputations.map((d) => ({
      dimension: d.dimension,
      score: decimalToNumber(d.score),
      confidence: Number(d.confidence.toString()),
      state: d.state,
      inputFingerprint: d.inputFingerprint,
      metrics: d.metrics,
      explanation: d.explanation,
      manifestId: d.manifestId,
      scoreModelId: d.scoreModelId,
    }));

    const factRefs: PersistedFactSetRef[] = factSets.map((f) => ({
      extractorFamily: f.extractorFamily,
      extractorVersion: f.extractorVersion,
      schemaVersion: f.schemaVersion,
      inputFingerprint: f.inputFingerprint,
      facts: f.facts,
      limitations: f.limitations,
      manifestSlotId: f.manifestSlotId,
      reportCode: f.relationReportCode,
      fightId: f.relationFightId,
      reportRevision: f.relationReportRevision,
      dungeonSlug: f.dungeonSlug,
      slotIndex: f.slotIndex,
    }));

    const scoreModelId =
      dimensions.find((d) => d.scoreModelId)?.scoreModelId ??
      (
        await this.prisma.scoreModel.findFirst({
          where: { status: { in: ["ACTIVE", "DRAFT"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      )?.id ??
      "00000000-0000-0000-0000-000000000000";

    const providerCallCounter = { count: 0 };
    const replay = replayScoringV2Dimensions({
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestId: manifest.id,
      scoreModelId,
      manifestDocument: manifest.document,
      expectedManifestContentHash: manifest.contentHash,
      factSets: factRefs,
      persistedDimensions: dimensions
        .filter((d): d is typeof d & { dimension: ScoringV2PublicDimension } =>
          ["PERFORMANCE", "SURVIVAL", "UTILITY"].includes(d.dimension),
        )
        .map((d) => ({
          dimension: d.dimension as ScoringV2PublicDimension,
          score: d.score,
          confidence: d.confidence,
          state:
            isRecord(d.metrics) && typeof d.metrics.availabilityState === "string"
              ? d.metrics.availabilityState
              : d.state,
          inputFingerprint: d.inputFingerprint,
          metrics: d.metrics,
          explanation: d.explanation,
          scoreModelId: d.scoreModelId,
        })),
      enabledDimensions: ["PERFORMANCE", "SURVIVAL", "UTILITY"],
      providerCallCounter,
    });

    return buildScoringV2EvidenceAudit({
      manifestId: manifest.id,
      characterId: manifest.characterId,
      seasonId: manifest.seasonId,
      manifestDocument: manifest.document,
      coverageState: manifest.coverageState,
      expectedSlotCount: manifest.expectedSlotCount,
      selectedSlotCount: manifest.selectedSlotCount,
      slotRows: manifest.slots.map((s) => {
        const reasons =
          isRecord(s.dimensionValidity) && Array.isArray(s.dimensionValidity.reasons)
            ? s.dimensionValidity.reasons.filter(
                (r): r is string => typeof r === "string",
              )
            : [];
        return {
          id: s.id,
          dungeonSlug: s.dungeon.slug,
          slotIndex: s.slotIndex,
          state: s.state,
          reportCode: s.reportCode,
          fightId: s.fightId,
          reportRevision: s.reportRevision,
          keyLevel: s.keyLevel,
          selectionReason: s.selectionReason,
          candidateRank: s.candidateRank,
          dimensionValidityReasons: reasons,
        };
      }),
      datasets,
      factSets,
      dimensions,
      masterDataByIdentity: digests.map((d) => ({
        reportCode: d.reportCode,
        fightId: d.fightId,
        reportRevision: d.reportRevision,
        digestId: d.id,
        masterDataArtifactId: d.masterDataArtifactId,
        contentFingerprint: d.contentFingerprint,
      })),
      pagesByIdentity,
      artifactsById,
      replay,
    });
  }
}
