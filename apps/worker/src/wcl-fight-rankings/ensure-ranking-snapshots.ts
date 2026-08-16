/**
 * Best-effort ranking-v2 snapshots for already-frozen canonical WCL identities.
 * Does not select runs, rewrite raw/digest packages, or fetch combat events.
 */
import { WclFightRankingRepository, type PrismaClient } from "@mplus/database";
import { OPERATIONS, type WclGraphQlClient } from "@mplus/provider-warcraftlogs";
import { pickUniqueRaw } from "../boost-assessment/pick-unique-raw.js";
import { persistWclFightRankingsFromReport } from "./persist-from-report.js";

export interface RankingSnapshotIdentity {
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
}

export interface RankingReportPayload {
  rankings: unknown;
  masterData: unknown;
  friendlyPlayers: unknown;
}

export type FetchRankingReport = (
  identity: RankingSnapshotIdentity,
) => Promise<RankingReportPayload>;

export interface EnsureRankingSnapshotsResult {
  uniqueIdentities: number;
  skippedExisting: number;
  skippedNoRaw: number;
  skippedNoLive: number;
  persisted: number;
  failed: number;
  providerCalls: number;
}

function identityKey(id: RankingSnapshotIdentity): string {
  return `${id.reportCode}:${id.fightId}:${id.reportRevision ?? ""}`;
}

export function uniqueRankingIdentities(
  identities: RankingSnapshotIdentity[],
): RankingSnapshotIdentity[] {
  const seen = new Set<string>();
  const out: RankingSnapshotIdentity[] = [];
  for (const id of identities) {
    if (typeof id.reportCode !== "string" || id.reportCode.length === 0) continue;
    if (typeof id.fightId !== "number" || !Number.isInteger(id.fightId)) continue;
    const key = identityKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      reportCode: id.reportCode,
      fightId: id.fightId,
      reportRevision: id.reportRevision,
    });
  }
  return out;
}

export function createFetchRankingReport(
  client: WclGraphQlClient,
  region: string,
): FetchRankingReport {
  return async (identity) => {
    const result = await client.requestPermissive<{
      reportData?: {
        report?: {
          fights?: Array<{ id?: number; friendlyPlayers?: unknown }>;
          masterData?: unknown;
          rankings?: unknown;
        } | null;
      };
    }>({
      operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
      query: OPERATIONS.ReportWithFightAndMasterData.query,
      variables: { code: identity.reportCode, fightIDs: [identity.fightId] },
      region,
    });
    const report = result.response.data?.reportData?.report;
    const fight = (report?.fights ?? []).find((f) => f.id === identity.fightId);
    return {
      rankings: report?.rankings ?? null,
      masterData: report?.masterData ?? null,
      friendlyPlayers: fight?.friendlyPlayers ?? null,
    };
  };
}

export function createEnsureRankingSnapshotsHook(input: {
  prisma: PrismaClient;
  client: WclGraphQlClient;
  region: string;
}): (identities: RankingSnapshotIdentity[]) => Promise<{ providerCalls: number }> {
  const fetchReport = createFetchRankingReport(input.client, input.region);
  return async (identities) => {
    const result = await ensureRankingSnapshotsForIdentities({
      prisma: input.prisma,
      identities,
      fetchReport,
    });
    return { providerCalls: result.providerCalls };
  };
}

export async function ensureRankingSnapshotsForIdentities(input: {
  prisma: PrismaClient;
  identities: RankingSnapshotIdentity[];
  fetchReport?: FetchRankingReport;
}): Promise<EnsureRankingSnapshotsResult> {
  const unique = uniqueRankingIdentities(input.identities);
  const summary: EnsureRankingSnapshotsResult = {
    uniqueIdentities: unique.length,
    skippedExisting: 0,
    skippedNoRaw: 0,
    skippedNoLive: 0,
    persisted: 0,
    failed: 0,
    providerCalls: 0,
  };
  const rankingRepo = new WclFightRankingRepository(input.prisma);
  const rawFindMany = input.prisma.wclRunRaw?.findMany;

  for (const identity of unique) {
    try {
      if (typeof rawFindMany !== "function") {
        summary.skippedNoRaw += 1;
        continue;
      }
      const rawCandidates = await rawFindMany.call(input.prisma.wclRunRaw, {
        where: { reportCode: identity.reportCode, fightId: identity.fightId },
      });
      const raw = pickUniqueRaw(rawCandidates ?? [], identity.reportRevision);
      if (!raw || raw === "ambiguous") {
        summary.skippedNoRaw += 1;
        continue;
      }
      const existing = await rankingRepo.findLatestSnapshotForRawRun(raw.id);
      if (existing) {
        summary.skippedExisting += 1;
        continue;
      }
      if (!input.fetchReport) {
        summary.skippedNoLive += 1;
        continue;
      }
      const report = await input.fetchReport(identity);
      summary.providerCalls += 1;
      const persist = await persistWclFightRankingsFromReport({
        prisma: input.prisma,
        rawRunId: raw.id,
        rankings: report.rankings,
        masterData: report.masterData,
        friendlyPlayers: report.friendlyPlayers,
        fightId: identity.fightId,
        fetchedAt: new Date(),
      });
      if (persist.status === "persisted") {
        summary.persisted += 1;
      }
    } catch (err) {
      summary.failed += 1;
      console.warn(
        JSON.stringify({
          event: "wcl_ranking_snapshot_enrichment_failed",
          reportCode: identity.reportCode,
          fightId: identity.fightId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  console.info(
    JSON.stringify({
      event: "wcl_ranking_snapshot_enrichment",
      ...summary,
    }),
  );
  return summary;
}
