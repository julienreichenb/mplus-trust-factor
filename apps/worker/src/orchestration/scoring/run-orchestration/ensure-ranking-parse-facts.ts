/**
 * Ensure RunRankingFact rows for selected fights from one CharacterZoneRankings
 * (playerscore) payload. Provider-free resolveRankingParseForParticipant stays
 * read-only; this hydrate step is the sole live write path on cold refresh.
 */
import type { PrismaClient } from "@mplus/database";
import { RunRankingFactRepository } from "@mplus/database";
import type { CharacterIdentityInput, RegionCode } from "@mplus/contracts";
import {
  resolveRankingParseFromZoneRankings,
  type ZoneRankingsPayload,
} from "@mplus/provider-warcraftlogs";
import type {
  LiveProviderPermission,
  SourceFightIdentity,
} from "./orchestrator.js";
import { rankingEvidenceHasUsableParse } from "./ranking-hydrate.js";

/** Must match production-ports SCORING_RANKING_VERSION. */
const DEFAULT_RANKING_VERSION = "ranking-parse-v1";

export interface FetchCharacterZoneRankingsParseProvider {
  fetchCharacterZoneRankingsParse(input: {
    character: CharacterIdentityInput;
    zoneId: number;
    ctx: {
      region: RegionCode;
      requestId: string;
      correlationId: string | null;
      forceRefresh: boolean;
      now: string;
      targetCharacter?: CharacterIdentityInput;
    };
  }): Promise<{
    payload: ZoneRankingsPayload | null;
    providerCalls: number;
    unavailableReason: string | null;
  }>;
}

export interface EnsureRankingParseFactInput {
  rawRunId: string;
  characterId: string;
  sourceFight: SourceFightIdentity;
  dungeonSlug: string | null;
  keyLevel: number | null;
  zoneId: number;
  character: {
    name: string;
    realmSlug: string;
    region: RegionCode;
  };
  liveProviderPermission: LiveProviderPermission;
  provider?: FetchCharacterZoneRankingsParseProvider | null;
  requestId?: string;
  correlationId?: string | null;
  now?: Date;
}

export type EnsureRankingParseFactResult =
  | {
      status: "HIT" | "WRITTEN" | "ABSENT_WRITTEN";
      providerCalls: number;
      unavailableReason: string | null;
    }
  | {
      status: "SKIPPED";
      reason: string;
      providerCalls: number;
      unavailableReason: string | null;
    };

type ZoneRankingsCache = {
  payload: ZoneRankingsPayload | null;
  providerCalls: number;
  unavailableReason: string | null;
};

/**
 * Factory with per-scoring-operation zoneRankings cache (at most one WCL call).
 */
export function createEnsureRankingParseFacts(deps: {
  prisma: PrismaClient;
  rankingVersion?: string;
}): {
  ensure: (input: EnsureRankingParseFactInput) => Promise<EnsureRankingParseFactResult>;
  resetCache: () => void;
} {
  const rankings = new RunRankingFactRepository(deps.prisma);
  const rankingVersion = deps.rankingVersion ?? DEFAULT_RANKING_VERSION;
  let cache: ZoneRankingsCache | undefined;

  function resetCache() {
    cache = undefined;
  }

  async function loadOrFetchPayload(
    input: EnsureRankingParseFactInput,
  ): Promise<ZoneRankingsCache> {
    if (cache) {
      return { ...cache, providerCalls: 0 };
    }
    if (!input.provider?.fetchCharacterZoneRankingsParse) {
      cache = {
        payload: null,
        providerCalls: 0,
        unavailableReason: "ranking_parse_provider_absent",
      };
      return cache;
    }
    const characterIdentity: CharacterIdentityInput = {
      name: input.character.name,
      realmSlug: input.character.realmSlug,
      region: input.character.region,
    };
    const fetched = await input.provider.fetchCharacterZoneRankingsParse({
      character: characterIdentity,
      zoneId: input.zoneId,
      ctx: {
        region: input.character.region,
        requestId: input.requestId ?? `ranking-parse:${input.characterId}`,
        correlationId: input.correlationId ?? null,
        forceRefresh: false,
        now: (input.now ?? new Date()).toISOString(),
        targetCharacter: characterIdentity,
      },
    });
    cache = {
      payload: fetched.payload,
      providerCalls: fetched.providerCalls,
      unavailableReason: fetched.unavailableReason,
    };
    return cache;
  }

  async function ensure(
    input: EnsureRankingParseFactInput,
  ): Promise<EnsureRankingParseFactResult> {
    const existing = await rankings.find({
      rawRunId: input.rawRunId,
      characterId: input.characterId,
      rankingVersion,
    });
    if (existing) {
      const existingEvidence = existing.payload as {
        bracketPercent?: number | null;
        rankPercent?: number | null;
        amountPercent?: number | null;
        unavailableReason?: string | null;
      } | null;
      // Usable HIT only. ABSENT / empty percentile rows must not permanently
      // block EvidenceDataset fallback or a later successful hydrate.
      if (
        existingEvidence &&
        rankingEvidenceHasUsableParse({
          bracketPercent: existingEvidence.bracketPercent ?? null,
          rankPercent: existingEvidence.rankPercent ?? null,
          amountPercent: existingEvidence.amountPercent ?? null,
        })
      ) {
        return {
          status: "HIT",
          providerCalls: 0,
          unavailableReason: null,
        };
      }
    }

    if (input.liveProviderPermission === "FORBIDDEN") {
      return {
        status: "SKIPPED",
        reason: "provider_forbidden",
        providerCalls: 0,
        unavailableReason: null,
      };
    }

    const zone = await loadOrFetchPayload(input);
    const resolved = resolveRankingParseFromZoneRankings({
      payload: zone.payload,
      zoneId: input.zoneId,
      reportCode: input.sourceFight.reportCode,
      fightId: input.sourceFight.fightId,
      reportRevision: input.sourceFight.reportRevision,
      dungeonSlug: input.dungeonSlug ?? "unknown",
      keyLevel: input.keyLevel,
    });

    const unavailableReason =
      resolved.unavailableReason ?? zone.unavailableReason;

    // Do not persist ABSENT poison rows. Resolve falls through to EvidenceDataset.
    if (!resolved.evidence || !rankingEvidenceHasUsableParse(resolved.evidence)) {
      return {
        status: "SKIPPED",
        reason: unavailableReason ?? "ranking_parse_row_absent",
        providerCalls: zone.providerCalls,
        unavailableReason: unavailableReason ?? "ranking_parse_row_absent",
      };
    }

    await rankings.save({
      rawRunId: input.rawRunId,
      characterId: input.characterId,
      rankingVersion,
      payload: resolved.evidence as never,
      fetchedAt: input.now ?? new Date(),
    });

    return {
      status: "WRITTEN",
      providerCalls: zone.providerCalls,
      unavailableReason: null,
    };
  }

  return { ensure, resetCache };
}
