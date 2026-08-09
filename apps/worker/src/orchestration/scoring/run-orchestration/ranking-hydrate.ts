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

export type { RankingParseEvidenceV2 };

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

/**
 * True when persisted ranking evidence carries a usable parse percentile.
 * ABSENT / unavailable rows must not shadow READY EvidenceDataset fallbacks.
 */
export function rankingEvidenceHasUsableParse(
  evidence: Pick<
    RankingParseEvidenceV2,
    "bracketPercent" | "rankPercent" | "amountPercent"
  >,
): boolean {
  return (
    (evidence.bracketPercent != null && Number.isFinite(evidence.bracketPercent)) ||
    (evidence.rankPercent != null && Number.isFinite(evidence.rankPercent)) ||
    (evidence.amountPercent != null && Number.isFinite(evidence.amountPercent))
  );
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Character-scoped ranking (encounterRankings / zone rankings for the scored
 * character) must not be copied onto other participants in the same fight.
 *
 * When evidence carries characterId / participantActorId, those win.
 * Legacy fight-scoped rows without identity still bind only to the scoring
 * target when targetCharacter is provided.
 */
export function rankingEvidenceAllowedForParticipant(input: {
  evidence: Pick<
    RankingParseEvidenceV2,
    "characterId" | "participantActorId"
  >;
  participantActorId: number;
  participantCharacterId?: string | null;
  participantCharacterName?: string | null;
  targetCharacterId?: string | null;
  targetCharacterName?: string | null;
}): boolean {
  const { evidence } = input;

  if (
    evidence.participantActorId != null &&
    Number.isFinite(evidence.participantActorId)
  ) {
    return evidence.participantActorId === input.participantActorId;
  }

  if (evidence.characterId != null && evidence.characterId.length > 0) {
    if (
      input.participantCharacterId != null &&
      input.participantCharacterId === evidence.characterId
    ) {
      return true;
    }
    return (
      input.targetCharacterId === evidence.characterId &&
      namesMatch(input.participantCharacterName, input.targetCharacterName)
    );
  }

  // Legacy fight-scoped EvidenceDataset: treat as target-character ranking only.
  if (input.targetCharacterId != null && input.targetCharacterId.length > 0) {
    if (
      input.participantCharacterId != null &&
      input.participantCharacterId === input.targetCharacterId
    ) {
      return true;
    }
    return namesMatch(input.participantCharacterName, input.targetCharacterName);
  }

  return true;
}
