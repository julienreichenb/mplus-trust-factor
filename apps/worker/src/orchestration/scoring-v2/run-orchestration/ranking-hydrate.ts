/**
 * Map persisted RankingParseEvidenceV2 → digest Performance ranking fields.
 * Never invents percentiles from event streams.
 */
import type {
  RankingParseEvidenceV2,
  RankingParseFactInput,
} from "@mplus/provider-warcraftlogs";
import {
  RANKING_PARSE_PROVIDER_CONTRACT,
  RANKING_PARSE_SCHEMA_VERSION,
} from "@mplus/provider-warcraftlogs";

export function rankingParseFactFromPersistedEvidence(input: {
  evidence: RankingParseEvidenceV2;
  artifactId: string | null;
  contentHash: string | null;
}): RankingParseFactInput {
  const { evidence } = input;
  const provenance = {
    providerContractVersion: RANKING_PARSE_PROVIDER_CONTRACT,
    schemaVersion: RANKING_PARSE_SCHEMA_VERSION,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    source: "PERSISTED_RANKING_PARSE" as const,
  };

  if (
    evidence.bracketPercent != null &&
    Number.isFinite(evidence.bracketPercent)
  ) {
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.bracketPercent)),
      parseSemantic: "BRACKET_PERCENT",
      partition: evidence.partition,
      rawDps: evidence.amount,
      rankingProvenance: provenance,
    };
  }
  if (evidence.rankPercent != null && Number.isFinite(evidence.rankPercent)) {
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.rankPercent)),
      parseSemantic: "RANK_PERCENT",
      partition: evidence.partition,
      rawDps: evidence.amount,
      rankingProvenance: provenance,
    };
  }
  if (
    evidence.amountPercent != null &&
    Number.isFinite(evidence.amountPercent)
  ) {
    return {
      parsePercentile: Math.max(0, Math.min(100, evidence.amountPercent)),
      parseSemantic: "RANK_PERCENT",
      partition: evidence.partition,
      rawDps: evidence.amount,
      rankingProvenance: provenance,
    };
  }
  return {
    parsePercentile: null,
    parseSemantic: "UNAVAILABLE",
    partition: evidence.partition,
    rawDps: evidence.amount,
    rankingProvenance: provenance,
  };
}

export function absentRankingParseFact(): RankingParseFactInput {
  return {
    parsePercentile: null,
    parseSemantic: "UNAVAILABLE",
    partition: null,
    rawDps: null,
    rankingProvenance: {
      providerContractVersion: RANKING_PARSE_PROVIDER_CONTRACT,
      schemaVersion: RANKING_PARSE_SCHEMA_VERSION,
      artifactId: null,
      contentHash: null,
      source: "ABSENT",
    },
  };
}

export function rankingParseCompatibilityKey(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
}): string {
  return [
    input.reportCode,
    String(input.fightId),
    String(input.reportRevision),
    "RANKING_PARSE",
    RANKING_PARSE_PROVIDER_CONTRACT,
  ].join(":");
}
