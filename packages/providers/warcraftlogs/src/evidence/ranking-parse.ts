/**
 * First-class per-run RANKING_PARSE evidence.
 * Bound to reportCode + fightId + reportRevision (+ optional actor).
 * Uses character zoneRankings rows that reference the specific fight — not dungeon aggregates.
 */
import { z } from "zod";
import type { RankingParseEvidenceV2 } from "../extractors/v2/types.js";
import { mapZoneRankings, type ZoneRankingsPayload } from "../discovery/run-discovery.js";

export const RANKING_PARSE_PROVIDER_CONTRACT = "wcl-ranking-parse-v1" as const;
export const RANKING_PARSE_SCHEMA_VERSION = "1.0.0" as const;

export const rankingParseRequestSchema = z.object({
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  reportRevision: z.number().int().nonnegative(),
  dungeonSlug: z.string().min(1),
  keyLevel: z.number().int().positive().nullable(),
  playerActorId: z.number().int().nonnegative().nullable().optional(),
  zoneId: z.number().int().positive(),
});
export type RankingParseRequest = z.infer<typeof rankingParseRequestSchema>;

export type RankingParseUnavailableReason =
  | "ranking_parse_row_absent"
  | "ranking_parse_zone_payload_empty"
  | "ranking_parse_provider_capability_absent"
  | "ranking_parse_identity_incomplete"
  | "ranking_parse_revision_mismatch";

export interface RankingParseLookupResult {
  evidence: RankingParseEvidenceV2 | null;
  unavailableReason: RankingParseUnavailableReason | null;
  /** Estimated WCL point cost for this lookup when fetched live. */
  estimatedPointsCost: number;
  matchedReportCode: string | null;
  matchedFightId: number | null;
}

/**
 * Resolve per-run parse evidence from a zoneRankings payload.
 * Requires an exact reportCode + fightId match — never invents from aggregates.
 */
export function resolveRankingParseFromZoneRankings(input: {
  payload: ZoneRankingsPayload | null | undefined;
  zoneId: number;
  reportCode: string;
  fightId: number;
  reportRevision: number;
  dungeonSlug: string;
  keyLevel: number | null;
}): RankingParseLookupResult {
  if (!input.payload?.rankings?.length) {
    return {
      evidence: null,
      unavailableReason: "ranking_parse_zone_payload_empty",
      estimatedPointsCost: 1,
      matchedReportCode: null,
      matchedFightId: null,
    };
  }

  const rows = mapZoneRankings(input.payload, input.zoneId);
  const match = rows.find(
    (r) => r.reportCode === input.reportCode && r.fightId === input.fightId,
  );
  if (!match) {
    return {
      evidence: null,
      unavailableReason: "ranking_parse_row_absent",
      estimatedPointsCost: 1,
      matchedReportCode: null,
      matchedFightId: null,
    };
  }

  const evidence: RankingParseEvidenceV2 = {
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel ?? match.keyLevel ?? 0,
    bracketPercent: match.bracketPercent ?? null,
    rankPercent: match.rankPercent ?? match.percentile ?? null,
    amountPercent: null,
    amount: match.amount ?? null,
    partition: null,
  };

  return {
    evidence,
    unavailableReason: null,
    estimatedPointsCost: 1,
    matchedReportCode: match.reportCode,
    matchedFightId: match.fightId,
  };
}
