/**
 * Carry ranking_parse EvidenceDataset lineage onto a superseding manifest.
 * Ranking is stored independently of the frozen JSON document (slot-owned rows
 * sharing a reportCode+fightId+reportRevision compatibility key).
 *
 * Unchanged identities: rebind prior/compatible READY ranking rows.
 * Changed revisions: only bind ranking for the *new* revision key — never copy
 * incompatible prior-revision evidence.
 */
import type { PrismaClient } from "@mplus/database";
import {
  RANKING_PARSE_PROVIDER_CONTRACT,
  RANKING_PARSE_SCHEMA_VERSION,
} from "@mplus/provider-warcraftlogs";
import { rankingParseCompatibilityKey } from "../run-orchestration/ranking-hydrate.js";

export const RANKING_PARSE_DATASET_KEY = "ranking_parse" as const;

type RankingEvidencePort = {
  findDatasetByCompatibilityKey: (compatibilityKey: string) => Promise<{
    id: string;
    compatibilityKey: string;
    artifactId: string | null;
    schemaVersion: string;
    providerContractVersion: string;
    state: string;
    eventCount: number;
    pageCount: number;
    truncated: boolean;
    pointsConsumed: number | null;
    costSource: string | null;
    payloadFingerprint: string | null;
    fetchedAt: Date | null;
  } | null>;
  findDatasetBySlotAndKey: (input: {
    manifestSlotId: string;
    datasetKey: string;
  }) => Promise<{ id: string; payloadFingerprint: string | null } | null>;
  createDataset: (input: {
    manifestSlotId: string;
    datasetKey: string;
    compatibilityKey: string;
    artifactId?: string | null;
    schemaVersion: string;
    providerContractVersion: string;
    state: string;
    eventCount?: number;
    pageCount?: number;
    truncated?: boolean;
    pointsConsumed?: number | null;
    costSource?: string | null;
    payloadFingerprint?: string | null;
    fetchedAt?: Date | null;
  }) => Promise<{ id: string; payloadFingerprint: string | null }>;
};

export interface RankingLineageSlotDiagnostic {
  slotId: string;
  reportCode: string;
  fightId: number;
  priorRevision: number | null;
  newRevision: number;
  revisionChanged: boolean;
  priorRankingDatasetId: string | null;
  priorRankingFingerprint: string | null;
  newRankingDatasetId: string | null;
  newRankingFingerprint: string | null;
  lookupKey: string;
  outcome:
    | "CARRIED_FORWARD"
    | "REBOUND_BY_COMPAT_KEY"
    | "ALREADY_BOUND"
    | "MISSING"
    | "SKIPPED_INCOMPATIBLE_REVISION";
}

export interface RankingLineageCarryForwardResult {
  carriedForward: number;
  reboundByCompatKey: number;
  alreadyBound: number;
  missing: number;
  skippedIncompatibleRevision: number;
  diagnostics: RankingLineageSlotDiagnostic[];
}

function slotLabel(slot: {
  dungeon: { slug: string };
  slotIndex: number;
}): string {
  return `${slot.dungeon.slug}:${slot.slotIndex}`;
}

function fightIdentityKey(
  reportCode: string,
  fightId: number,
  reportRevision: number,
): string {
  return `${reportCode}:${fightId}:${reportRevision}`;
}

/**
 * Idempotently ensure each SELECTED target slot has a ranking_parse descriptor
 * when compatible READY evidence exists for its frozen revision identity.
 */
export async function carryForwardRankingLineage(input: {
  prisma: PrismaClient;
  evidence: RankingEvidencePort;
  /** Manifest that owned the prior ranking_parse rows (may be null). */
  sourceManifestId: string | null;
  targetManifestId: string;
}): Promise<RankingLineageCarryForwardResult> {
  const targetSlots = await input.prisma.evidenceManifestSlot.findMany({
    where: { manifestId: input.targetManifestId, state: "SELECTED" },
    include: {
      dungeon: { select: { slug: true } },
      datasets: {
        where: { datasetKey: RANKING_PARSE_DATASET_KEY },
      },
    },
  });

  const sourceSlots = input.sourceManifestId
    ? await input.prisma.evidenceManifestSlot.findMany({
        where: { manifestId: input.sourceManifestId, state: "SELECTED" },
        include: {
          dungeon: { select: { slug: true } },
          datasets: {
            where: { datasetKey: RANKING_PARSE_DATASET_KEY, state: "READY" },
          },
        },
      })
    : [];

  const sourceByIdentity = new Map<
    string,
    (typeof sourceSlots)[number]
  >();
  const sourceByFight = new Map<string, (typeof sourceSlots)[number]>();
  for (const slot of sourceSlots) {
    if (slot.reportCode == null || slot.fightId == null || slot.reportRevision == null) {
      continue;
    }
    sourceByIdentity.set(
      fightIdentityKey(slot.reportCode, slot.fightId, slot.reportRevision),
      slot,
    );
    sourceByFight.set(`${slot.reportCode}:${slot.fightId}`, slot);
  }

  const result: RankingLineageCarryForwardResult = {
    carriedForward: 0,
    reboundByCompatKey: 0,
    alreadyBound: 0,
    missing: 0,
    skippedIncompatibleRevision: 0,
    diagnostics: [],
  };

  for (const target of targetSlots) {
    if (
      target.reportCode == null ||
      target.fightId == null ||
      target.reportRevision == null
    ) {
      continue;
    }
    const lookupKey = rankingParseCompatibilityKey({
      reportCode: target.reportCode,
      fightId: target.fightId,
      reportRevision: target.reportRevision,
    });
    const sourceSameIdentity = sourceByIdentity.get(
      fightIdentityKey(target.reportCode, target.fightId, target.reportRevision),
    );
    const sourceSameFight = sourceByFight.get(
      `${target.reportCode}:${target.fightId}`,
    );
    const priorRevision = sourceSameFight?.reportRevision ?? null;
    const revisionChanged =
      priorRevision != null && priorRevision !== target.reportRevision;

    const existingOnTarget = target.datasets.find(
      (d) => d.state === "READY" && d.artifactId != null,
    );
    if (existingOnTarget) {
      result.alreadyBound += 1;
      result.diagnostics.push({
        slotId: `${slotLabel(target)}`,
        reportCode: target.reportCode,
        fightId: target.fightId,
        priorRevision,
        newRevision: target.reportRevision,
        revisionChanged,
        priorRankingDatasetId: sourceSameIdentity?.datasets[0]?.id ?? null,
        priorRankingFingerprint:
          sourceSameIdentity?.datasets[0]?.payloadFingerprint ?? null,
        newRankingDatasetId: existingOnTarget.id,
        newRankingFingerprint: existingOnTarget.payloadFingerprint,
        lookupKey,
        outcome: "ALREADY_BOUND",
      });
      continue;
    }

    // Never copy ranking across incompatible revisions.
    if (revisionChanged) {
      const compat = await input.evidence.findDatasetByCompatibilityKey(lookupKey);
      if (compat && compat.state === "READY" && compat.artifactId) {
        const created = await bindRankingDataset({
          evidence: input.evidence,
          manifestSlotId: target.id,
          source: compat,
        });
        result.reboundByCompatKey += 1;
        result.diagnostics.push({
          slotId: `${slotLabel(target)}`,
          reportCode: target.reportCode,
          fightId: target.fightId,
          priorRevision,
          newRevision: target.reportRevision,
          revisionChanged: true,
          priorRankingDatasetId: sourceSameFight?.datasets[0]?.id ?? null,
          priorRankingFingerprint:
            sourceSameFight?.datasets[0]?.payloadFingerprint ?? null,
          newRankingDatasetId: created.id,
          newRankingFingerprint: created.payloadFingerprint,
          lookupKey,
          outcome: "REBOUND_BY_COMPAT_KEY",
        });
      } else {
        result.skippedIncompatibleRevision += 1;
        result.diagnostics.push({
          slotId: `${slotLabel(target)}`,
          reportCode: target.reportCode,
          fightId: target.fightId,
          priorRevision,
          newRevision: target.reportRevision,
          revisionChanged: true,
          priorRankingDatasetId: sourceSameFight?.datasets[0]?.id ?? null,
          priorRankingFingerprint:
            sourceSameFight?.datasets[0]?.payloadFingerprint ?? null,
          newRankingDatasetId: null,
          newRankingFingerprint: null,
          lookupKey,
          outcome: "SKIPPED_INCOMPATIBLE_REVISION",
        });
      }
      continue;
    }

    const priorRanking =
      sourceSameIdentity?.datasets.find(
        (d) => d.state === "READY" && d.artifactId != null,
      ) ?? null;

    if (priorRanking) {
      const created = await bindRankingDataset({
        evidence: input.evidence,
        manifestSlotId: target.id,
        source: priorRanking,
      });
      result.carriedForward += 1;
      result.diagnostics.push({
        slotId: `${slotLabel(target)}`,
        reportCode: target.reportCode,
        fightId: target.fightId,
        priorRevision,
        newRevision: target.reportRevision,
        revisionChanged: false,
        priorRankingDatasetId: priorRanking.id,
        priorRankingFingerprint: priorRanking.payloadFingerprint,
        newRankingDatasetId: created.id,
        newRankingFingerprint: created.payloadFingerprint,
        lookupKey,
        outcome: "CARRIED_FORWARD",
      });
      continue;
    }

    const compat = await input.evidence.findDatasetByCompatibilityKey(lookupKey);
    if (compat && compat.state === "READY" && compat.artifactId) {
      const created = await bindRankingDataset({
        evidence: input.evidence,
        manifestSlotId: target.id,
        source: compat,
      });
      result.reboundByCompatKey += 1;
      result.diagnostics.push({
        slotId: `${slotLabel(target)}`,
        reportCode: target.reportCode,
        fightId: target.fightId,
        priorRevision,
        newRevision: target.reportRevision,
        revisionChanged: false,
        priorRankingDatasetId: null,
        priorRankingFingerprint: null,
        newRankingDatasetId: created.id,
        newRankingFingerprint: created.payloadFingerprint,
        lookupKey,
        outcome: "REBOUND_BY_COMPAT_KEY",
      });
      continue;
    }

    result.missing += 1;
    result.diagnostics.push({
      slotId: `${slotLabel(target)}`,
      reportCode: target.reportCode,
      fightId: target.fightId,
      priorRevision,
      newRevision: target.reportRevision,
      revisionChanged: false,
      priorRankingDatasetId: null,
      priorRankingFingerprint: null,
      newRankingDatasetId: null,
      newRankingFingerprint: null,
      lookupKey,
      outcome: "MISSING",
    });
  }

  return result;
}

async function bindRankingDataset(input: {
  evidence: RankingEvidencePort;
  manifestSlotId: string;
  source: {
    compatibilityKey: string;
    artifactId: string | null;
    schemaVersion: string;
    providerContractVersion: string;
    state: string;
    eventCount: number;
    pageCount: number;
    truncated: boolean;
    pointsConsumed: number | null;
    costSource: string | null;
    payloadFingerprint: string | null;
    fetchedAt: Date | null;
  };
}): Promise<{ id: string; payloadFingerprint: string | null }> {
  const existing = await input.evidence.findDatasetBySlotAndKey({
    manifestSlotId: input.manifestSlotId,
    datasetKey: RANKING_PARSE_DATASET_KEY,
  });
  if (existing) {
    return { id: existing.id, payloadFingerprint: existing.payloadFingerprint };
  }
  const created = await input.evidence.createDataset({
    manifestSlotId: input.manifestSlotId,
    datasetKey: RANKING_PARSE_DATASET_KEY,
    compatibilityKey: input.source.compatibilityKey,
    artifactId: input.source.artifactId,
    schemaVersion: input.source.schemaVersion || RANKING_PARSE_SCHEMA_VERSION,
    providerContractVersion:
      input.source.providerContractVersion || RANKING_PARSE_PROVIDER_CONTRACT,
    state: "READY",
    eventCount: input.source.eventCount,
    pageCount: input.source.pageCount,
    truncated: input.source.truncated,
    pointsConsumed: input.source.pointsConsumed,
    costSource: input.source.costSource ?? "ranking_lineage_carry_forward",
    payloadFingerprint: input.source.payloadFingerprint,
    fetchedAt: input.source.fetchedAt,
  });
  return { id: created.id, payloadFingerprint: created.payloadFingerprint };
}
