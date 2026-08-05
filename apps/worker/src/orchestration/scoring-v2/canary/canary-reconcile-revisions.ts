/**
 * Metadata-only manifest revision reconciliation.
 * Fetches authoritative WCL report revisions; never acquires capability events,
 * packages, digests, or scores.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import type {
  CharacterSeasonEvidenceManifestV2,
  EvidenceRole,
} from "@mplus/contracts";
import {
  OPERATIONS,
  parseWithSchema,
  reportFightSchema,
  type WclGraphQlClient,
} from "@mplus/provider-warcraftlogs";
import { ensureDungeon } from "../../../persistence/run-repository.js";
import type { WorkerContainer } from "../../../container.js";
import { loadCompatibleFrozenManifest } from "./canary-live.js";
import type { CanarySeasonResolution } from "./canary-season.js";
import {
  reconcileManifestReportRevisions,
  type ReportRevisionObservation,
  type SupersedingManifestDocument,
} from "./canary-manifest-revision-reconcile.js";
import {
  carryForwardRankingLineage,
  type RankingLineageCarryForwardResult,
} from "./canary-ranking-lineage.js";

export const CANARY_RECONCILE_REVISIONS_SCHEMA =
  "scoring-v2-canary-reconcile-revisions-v1" as const;

export interface ReportMetadataObservationInput {
  reportCode: string;
  fightIds: number[];
  characterName: string;
}

export type FetchReportRevisionMetadata = (
  input: ReportMetadataObservationInput,
) => Promise<{
  reportCode: string;
  revision: number | null;
  fightIdsPresent: number[];
  characterActorIdsByFight: Record<number, number | null>;
  revisionResolvedAt: string;
}>;

export interface CanaryReconcileRevisionsReport {
  schemaVersion: typeof CANARY_RECONCILE_REVISIONS_SCHEMA;
  priorManifestId: string;
  supersedingManifestId: string | null;
  changed: boolean;
  supersedesManifestId: string;
  changes: Array<{
    slotId: string;
    reportCode: string;
    fightId: number;
    previousRevision: number;
    newRevision: number;
    revisionChangeReason: string;
  }>;
  staleSlotIds: string[];
  diagnostics: Array<{
    reportCode: string;
    fightId: number;
    discoveredRevision: number;
    revisionSource: string;
    revisionResolvedAt: string;
  }>;
  metadataProviderCalls: number;
  capabilityPackageAcquisitions: 0;
  packagesCreated: 0;
  participantDigestsCreated: 0;
  scoreCalculations: 0;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  priorContentHash: string;
  newContentHash: string | null;
  rankingLineage: RankingLineageCarryForwardResult | null;
}

function mapRoleForDb(role: EvidenceRole): "DPS" | "TANK" | "HEALER" {
  if (role === "TANK" || role === "HEALER" || role === "DPS") return role;
  return "DPS";
}

export function createGraphqlReportRevisionFetcher(
  client: WclGraphQlClient,
): FetchReportRevisionMetadata {
  return async (input) => {
    const revisionResolvedAt = new Date().toISOString();
    const reportResult = await client.request({
      operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
      query: OPERATIONS.ReportWithFightAndMasterData.query,
      variables: {
        code: input.reportCode,
        fightIDs: input.fightIds,
      },
    });
    const parsed = parseWithSchema(
      reportFightSchema,
      reportResult.response.data,
      "Report",
    );
    const report = parsed.reportData.report;
    if (!report) {
      return {
        reportCode: input.reportCode,
        revision: null,
        fightIdsPresent: [],
        characterActorIdsByFight: {},
        revisionResolvedAt,
      };
    }
    const revision =
      typeof report.revision === "number" && Number.isFinite(report.revision)
        ? report.revision
        : null;
    const fightIdsPresent = report.fights.map((f) => f.id);
    const actors = report.masterData?.actors ?? [];
    const nameLower = input.characterName.trim().toLowerCase();
    const characterActorIdsByFight: Record<number, number | null> = {};
    for (const fight of report.fights) {
      const friendly = new Set(fight.friendlyPlayers ?? []);
      const match = actors.find(
        (a) =>
          friendly.has(a.id) &&
          a.name.trim().toLowerCase() === nameLower &&
          (a.type === "Player" || a.type == null),
      );
      characterActorIdsByFight[fight.id] = match?.id ?? null;
    }
    return {
      reportCode: report.code,
      revision,
      fightIdsPresent,
      characterActorIdsByFight,
      revisionResolvedAt,
    };
  };
}

/**
 * Build per-slot observations from metadata fetches (one fetch per report code).
 */
export async function resolveAuthoritativeRevisionObservations(input: {
  document: CharacterSeasonEvidenceManifestV2;
  characterName: string;
  fetchMetadata: FetchReportRevisionMetadata;
}): Promise<{
  observations: ReportRevisionObservation[];
  metadataProviderCalls: number;
  unresolved: Array<{ reportCode: string; fightId: number }>;
}> {
  const selected = input.document.slots.filter(
    (s) => s.state === "SELECTED" && s.identity,
  );
  const byReport = new Map<string, number[]>();
  for (const slot of selected) {
    const code = slot.identity!.reportCode;
    const list = byReport.get(code) ?? [];
    list.push(slot.identity!.fightId);
    byReport.set(code, list);
  }

  const observations: ReportRevisionObservation[] = [];
  const unresolved: Array<{ reportCode: string; fightId: number }> = [];
  let metadataProviderCalls = 0;

  for (const [reportCode, fightIds] of byReport) {
    metadataProviderCalls += 1;
    const meta = await input.fetchMetadata({
      reportCode,
      fightIds: [...new Set(fightIds)],
      characterName: input.characterName,
    });
    if (meta.revision == null || !Number.isFinite(meta.revision) || meta.revision < 0) {
      for (const fightId of fightIds) {
        unresolved.push({ reportCode, fightId });
      }
      continue;
    }
    const present = new Set(meta.fightIdsPresent);
    for (const fightId of fightIds) {
      observations.push({
        reportCode,
        fightId,
        authoritativeRevision: meta.revision,
        revisionSource: "wcl_report_metadata",
        revisionResolvedAt: meta.revisionResolvedAt,
        fightPresent: present.has(fightId),
        characterPresent: meta.characterActorIdsByFight[fightId] != null,
      });
    }
  }

  return { observations, metadataProviderCalls, unresolved };
}

export async function runScoringV2CanaryReconcileRevisions(input: {
  prisma: PrismaClient;
  container: WorkerContainer;
  characterId: string;
  characterName: string;
  seasonResolution: CanarySeasonResolution;
  role: EvidenceRole;
  fetchMetadata: FetchReportRevisionMetadata;
  /** When set, reconcile this exact manifest id instead of latest compatible. */
  priorManifestId?: string;
  outputDir?: string;
}): Promise<{
  report: CanaryReconcileRevisionsReport;
  reportPath: string;
  document: SupersedingManifestDocument | null;
}> {
  const season = input.seasonResolution;
  if (!season.seasonId || !season.dungeonPoolHash) {
    throw Object.assign(new Error("season_identity_incomplete_for_reconcile"), {
      code: "SEASON_IDENTITY_INCOMPLETE",
      seasonId: season.seasonId,
      dungeonPoolHash: season.dungeonPoolHash,
    });
  }
  const seasonId = season.seasonId;
  const dungeonPoolHash = season.dungeonPoolHash;
  let frozen = await loadCompatibleFrozenManifest({
    prisma: input.prisma,
    characterId: input.characterId,
    seasonId,
    expectedDungeonSlugs: season.activeDungeonSlugs,
    dungeonPoolHash,
  });

  if (input.priorManifestId) {
    const row = await input.prisma.evidenceManifest.findUnique({
      where: { id: input.priorManifestId },
    });
    if (!row?.document || typeof row.document !== "object") {
      throw Object.assign(new Error("prior_manifest_not_found"), {
        code: "PRIOR_MANIFEST_NOT_FOUND",
        priorManifestId: input.priorManifestId,
      });
    }
    frozen = {
      rowId: row.id,
      document: row.document as CharacterSeasonEvidenceManifestV2,
    };
  }

  if (!frozen) {
    throw Object.assign(new Error("compatible_manifest_not_available"), {
      code: "CANARY_RECONCILE_MANIFEST_NOT_AVAILABLE",
    });
  }

  const priorDocument = structuredClone(frozen.document);
  const priorContentHash = priorDocument.contentHash;

  const { observations, metadataProviderCalls, unresolved } =
    await resolveAuthoritativeRevisionObservations({
      document: priorDocument,
      characterName: input.characterName,
      fetchMetadata: input.fetchMetadata,
    });

  if (unresolved.length > 0) {
    throw Object.assign(
      new Error(
        `REPORT_REVISION_UNRESOLVED:${unresolved
          .map((u) => `${u.reportCode}:${u.fightId}`)
          .join(",")}`,
      ),
      {
        code: "REPORT_REVISION_UNRESOLVED",
        unresolved,
      },
    );
  }

  const reconciled = reconcileManifestReportRevisions({
    priorManifestId: frozen.rowId,
    document: priorDocument,
    observations,
  });

  // Prove prior frozen row was not mutated.
  const reloaded = await input.prisma.evidenceManifest.findUnique({
    where: { id: frozen.rowId },
  });
  const reloadedHash =
    reloaded?.document && typeof reloaded.document === "object"
      ? (reloaded.document as CharacterSeasonEvidenceManifestV2).contentHash
      : null;
  if (reloadedHash !== priorContentHash) {
    throw Object.assign(new Error("prior_manifest_mutated_in_place"), {
      code: "PRIOR_MANIFEST_MUTATED",
    });
  }

  let supersedingManifestId: string | null = null;
  let newContentHash: string | null = null;

  if (reconciled.changed) {
    const doc = reconciled.document;
    const dungeonSlugs = [
      ...new Set(doc.slots.map((s) => s.dungeonSlug.toLowerCase())),
    ];
    for (const slug of dungeonSlugs) {
      await ensureDungeon(input.prisma, slug);
    }
    const dungeonRows = await input.prisma.dungeon.findMany({
      where: { slug: { in: dungeonSlugs } },
      select: { id: true, slug: true },
    });
    const dungeonIdBySlug = new Map(dungeonRows.map((d) => [d.slug, d.id]));

    const fingerprint = createHash("sha256")
      .update(
        [
          seasonId,
          dungeonPoolHash,
          season.catalogVersion ?? "n/a",
          doc.contentHash,
        ].join("|"),
        "utf8",
      )
      .digest("hex");

    const documentForPersist = {
      ...doc,
      dungeonPoolHash,
      catalogVersion: season.catalogVersion,
      compatibilityFingerprint: fingerprint,
    };

    const { manifest } =
      await input.container.repositories.evidence.createFrozenManifest({
        characterId: input.characterId,
        seasonId,
        specializationId: null,
        role: mapRoleForDb(input.role),
        refreshContractHash: doc.refreshContractHash,
        selectorVersion: doc.selectorVersion,
        highKeyPolicyId: doc.highKeyPolicyId,
        evidenceCutoffAt: new Date(doc.evidenceCutoffAt),
        expectedSlotCount: doc.expectedSlotCount,
        selectedSlotCount: doc.selectedSlotCount,
        coverageState: doc.coverage.state,
        schemaVersion: doc.schemaVersion,
        contentHash: doc.contentHash,
        document: documentForPersist as unknown as object,
        frozenAt: new Date(),
        slots: doc.slots.map((slot) => ({
          dungeonId: dungeonIdBySlug.get(slot.dungeonSlug)!,
          slotIndex: slot.slotIndex,
          reportCode: slot.identity?.reportCode ?? null,
          fightId: slot.identity?.fightId ?? null,
          reportRevision: slot.identity?.reportRevision ?? null,
          keyLevel: slot.keyLevel,
          candidateRank: slot.selectedRank,
          state: slot.state,
          selectionReason:
            slot.state === "SELECTED"
              ? slot.fallbackReason
                ? "SELECTED_WITH_FALLBACK"
                : "SELECTED"
              : slot.state,
          dimensionValidity: slot.dimensionValidity ?? {},
          invalidReasons: slot.fallbackReason
            ? [`fallbackReason:${slot.fallbackReason}`]
            : [],
          providerDataAsOf: null,
        })),
      });
    supersedingManifestId = manifest.id;
    newContentHash = doc.contentHash;
  }

  const targetManifestId = supersedingManifestId ?? frozen.rowId;
  const docFields = frozen.document as Record<string, unknown>;
  const priorSupersedes =
    typeof docFields.supersedesManifestId === "string"
      ? docFields.supersedesManifestId
      : null;
  const sourceManifestId = reconciled.changed
    ? frozen.rowId
    : priorSupersedes ?? input.priorManifestId ?? null;

  const rankingLineage = await carryForwardRankingLineage({
    prisma: input.prisma,
    evidence: input.container.repositories.evidence,
    sourceManifestId,
    targetManifestId,
  });

  // Prove prior frozen row was not mutated by ranking rebind either.
  const reloadedAfterRanking = await input.prisma.evidenceManifest.findUnique({
    where: { id: frozen.rowId },
  });
  const reloadedHashAfter =
    reloadedAfterRanking?.document &&
    typeof reloadedAfterRanking.document === "object"
      ? (reloadedAfterRanking.document as CharacterSeasonEvidenceManifestV2)
          .contentHash
      : null;
  if (reloadedHashAfter !== priorContentHash) {
    throw Object.assign(new Error("prior_manifest_mutated_in_place"), {
      code: "PRIOR_MANIFEST_MUTATED",
    });
  }

  const report: CanaryReconcileRevisionsReport = {
    schemaVersion: CANARY_RECONCILE_REVISIONS_SCHEMA,
    priorManifestId: frozen.rowId,
    supersedingManifestId,
    changed: reconciled.changed,
    supersedesManifestId: frozen.rowId,
    changes: reconciled.changes,
    staleSlotIds: reconciled.staleSlotIds,
    diagnostics: reconciled.document.revisionReconciliation.diagnostics,
    metadataProviderCalls,
    capabilityPackageAcquisitions: 0,
    packagesCreated: 0,
    participantDigestsCreated: 0,
    scoreCalculations: 0,
    publicationEnabled: false,
    publicScorePointerMutated: false,
    priorContentHash,
    newContentHash,
    rankingLineage,
  };

  const outDir =
    input.outputDir ?? join(process.cwd(), "artifacts", "scoring-v2-canary");
  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "reconcile-revisions-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  return {
    report,
    reportPath,
    document: reconciled.changed ? reconciled.document : null,
  };
}
