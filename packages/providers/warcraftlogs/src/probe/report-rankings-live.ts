/**
 * Live WCL report-rankings discovery fetch (probe only).
 * Reuses WclGraphQlClient. Does not persist.
 */
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { OPERATIONS } from "../operations/queries.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import type { WclRateLimitSnapshot } from "../types.js";
import {
  alignRankingRowsToFightActors,
  parseReportRankingsJson,
  type FightRankingRow,
  type ReportActorRef,
} from "./report-rankings-parse.js";

export interface ReportFightRankingsLiveResult {
  reportCode: string;
  reportRevision: number | null;
  visibility: string | null;
  fight: {
    id: number;
    encounterID: number | null;
    name: string | null;
    keystoneLevel: number | null;
    friendlyPlayers: unknown;
  } | null;
  actors: ReportActorRef[];
  rankingsRaw: unknown;
  rows: FightRankingRow[];
  rawShape: string;
  roleBuckets: string[];
  graphqlErrors: string[];
  rankingsCostUnits: number | null;
  rankingsDurationMs: number;
  rateLimitBefore: WclRateLimitSnapshot | null;
  rateLimitAfter: WclRateLimitSnapshot | null;
}

async function fetchRateLimit(
  client: WclGraphQlClient,
): Promise<WclRateLimitSnapshot | null> {
  const result = await client.requestPermissive<{
    rateLimitData?: {
      limitPerHour: number;
      pointsSpentThisHour: number;
      pointsResetIn?: number;
    };
  }>({
    operationName: OPERATIONS.RateLimitData.operationName,
    query: OPERATIONS.RateLimitData.query,
  });
  const rl = result.response.data?.rateLimitData;
  if (!rl) return null;
  return parseRateLimitSnapshot(rl);
}

export async function fetchReportFightRankingsProbe(input: {
  client: WclGraphQlClient;
  reportCode: string;
  fightId: number;
}): Promise<ReportFightRankingsLiveResult> {
  const rateLimitBefore = await fetchRateLimit(input.client);
  const result = await input.client.requestPermissive<{
    reportData?: {
      report?: {
        code?: string;
        revision?: number;
        visibility?: string;
        fights?: Array<{
          id: number;
          encounterID?: number | null;
          name?: string | null;
          keystoneLevel?: number | null;
          friendlyPlayers?: unknown;
        }>;
        masterData?: {
          actors?: Array<{
            id: number;
            name: string;
            type: string;
            subType?: string | null;
            server?: string | null;
          }>;
        };
        rankings?: unknown;
      } | null;
    };
  }>({
    operationName: OPERATIONS.ReportFightRankingsProbe.operationName,
    query: OPERATIONS.ReportFightRankingsProbe.query,
    variables: { code: input.reportCode, fightIDs: [input.fightId] },
  });

  const graphqlErrors = (result.response.errors ?? []).map((e) => e.message);
  const report = result.response.data?.reportData?.report ?? null;
  const fight = report?.fights?.find((f) => f.id === input.fightId) ?? report?.fights?.[0] ?? null;
  const actors: ReportActorRef[] = (report?.masterData?.actors ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    subType: a.subType ?? null,
    server: a.server ?? null,
  }));
  const parsed = parseReportRankingsJson({
    rankings: report?.rankings ?? null,
    fightId: input.fightId,
  });
  const rows = fight
    ? alignRankingRowsToFightActors({
        rows: parsed.rows,
        actors,
        friendlyPlayers: fight.friendlyPlayers,
      })
    : parsed.rows;

  const rateLimitAfter = await fetchRateLimit(input.client);

  return {
    reportCode: report?.code ?? input.reportCode,
    reportRevision: report?.revision ?? null,
    visibility: report?.visibility ?? null,
    fight: fight
      ? {
          id: fight.id,
          encounterID: fight.encounterID ?? null,
          name: fight.name ?? null,
          keystoneLevel: fight.keystoneLevel ?? null,
          friendlyPlayers: fight.friendlyPlayers ?? null,
        }
      : null,
    actors,
    rankingsRaw: report?.rankings ?? null,
    rows,
    rawShape: parsed.rawShape,
    roleBuckets: parsed.roleBuckets,
    graphqlErrors,
    rankingsCostUnits: result.costUnits,
    rankingsDurationMs: result.durationMs,
    rateLimitBefore,
    rateLimitAfter,
  };
}
