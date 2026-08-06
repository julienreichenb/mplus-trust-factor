/**
 * Injectable evidence transport for Scoring V2 acquisition.
 * Production may call WCL; tests inject fixtures that never touch the network.
 */

import type { ProviderFetchContext } from "@mplus/contracts";
import type {
  RankingParseEvidenceV2,
  WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";

export interface ScoringFightDetailsResult {
  data: unknown;
  reportRevision: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  startTime: number | null;
  endTime: number | null;
  dungeonSlug: string | null;
  /** Report-local actor IDs from fight.friendlyPlayers. */
  fightFriendlyPlayerActorIds?: number[];
  /** Ownership proof — false when target is not in the fight roster. */
  targetInFight?: boolean;
  /** Structured ownership rejection when targetInFight is false. */
  ownershipRejectionReason?:
    | "TARGET_NOT_IN_REPORT"
    | "TARGET_NOT_IN_FIGHT"
    | "TARGET_AMBIGUOUS"
    | "FIGHT_NOT_MYTHIC_PLUS"
    | "FIGHT_INCOMPLETE"
    | null;
  /** Provider round-trips performed for this call (0 = cache/fixture reuse). */
  providerCalls: number;
}

export interface ScoringSharedEvidenceResult {
  bundle: WclRunEvidenceBundle | null;
  providerCalls: number;
  cacheHits: number;
  /** Singleflight ready/waiter served without becoming fetch owner. */
  singleflightReuse?: number;
  /** Measured/estimated points from bundle accounting when known. */
  pointsConsumed?: number | null;
  pages?: number;
  unavailableReason: string | null;
}

export interface ScoringRankingParseResult {
  evidence: RankingParseEvidenceV2 | null;
  providerCalls: number;
  unavailableReason: string | null;
}

export interface ScoringProfilePayloadResult {
  payload: unknown | null;
  providerCalls: number;
  unavailableReason: string | null;
}

/**
 * Acquisition-only transport. Calculators and finalizers must not use this.
 * Implementations must not perform network I/O when serving from fixtures/cache.
 */
export interface ScoringEvidenceTransport {
  getReportFightDetails(input: {
    reportCode: string;
    fightId: number;
    ctx: ProviderFetchContext;
    /** Hint from discovery/candidate — enables durable reuse before WCL. */
    expectedReportRevision?: number | null;
    /** Report-local actor from discovery — scopes fight-details cache. */
    expectedActorId?: number | null;
  }): Promise<ScoringFightDetailsResult>;

  acquireSharedEvidence(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    playerActorId: number | null;
    ownedPetActorIds: number[];
    dungeonSlug: string;
    startTime: number | null;
    endTime: number | null;
    datasetKeys: string[];
    ctx: ProviderFetchContext;
  }): Promise<ScoringSharedEvidenceResult>;

  getRankingParse(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    dungeonSlug: string;
    keyLevel: number | null;
    ctx: ProviderFetchContext;
  }): Promise<ScoringRankingParseResult>;

  getPointsAndDamageProfile(input: {
    ctx: ProviderFetchContext;
  }): Promise<ScoringProfilePayloadResult>;
}

/** Fixture/mock transport — records call counts; never opens sockets. */
export class FixtureScoringEvidenceTransport implements ScoringEvidenceTransport {
  private fightDetailsCalls = 0;
  private sharedEvidenceCalls = 0;
  private rankingCalls = 0;
  private profileCalls = 0;
  private networkBlocked = true;

  constructor(
    private readonly fixtures: {
      fightDetails?: ScoringFightDetailsResult;
      sharedEvidence?: ScoringSharedEvidenceResult;
      rankingParse?: ScoringRankingParseResult;
      /** When set, getRankingParse throws after counting the call (transport failure). */
      rankingParseThrow?: Error;
      profile?: ScoringProfilePayloadResult;
    } = {},
  ) {}

  /** Assert helpers for tests — proves no external network path. */
  assertNoNetworkReachable(): void {
    if (!this.networkBlocked) {
      throw new Error("network_path_was_enabled");
    }
  }

  getProviderCallCounts(): {
    fightDetails: number;
    sharedEvidence: number;
    rankingParse: number;
    profile: number;
    total: number;
  } {
    const total =
      this.fightDetailsCalls +
      this.sharedEvidenceCalls +
      this.rankingCalls +
      this.profileCalls;
    return {
      fightDetails: this.fightDetailsCalls,
      sharedEvidence: this.sharedEvidenceCalls,
      rankingParse: this.rankingCalls,
      profile: this.profileCalls,
      total,
    };
  }

  async getReportFightDetails(): Promise<ScoringFightDetailsResult> {
    this.assertNoNetworkReachable();
    this.fightDetailsCalls += 1;
    if (!this.fixtures.fightDetails) {
      return {
        data: null,
        reportRevision: 0,
        playerActorId: null,
        ownedPetActorIds: [],
        startTime: null,
        endTime: null,
        dungeonSlug: null,
        providerCalls: 0,
      };
    }
    return { ...this.fixtures.fightDetails };
  }

  async acquireSharedEvidence(): Promise<ScoringSharedEvidenceResult> {
    this.assertNoNetworkReachable();
    this.sharedEvidenceCalls += 1;
    return (
      this.fixtures.sharedEvidence ?? {
        bundle: null,
        providerCalls: 0,
        cacheHits: 0,
        unavailableReason: "fixture_shared_evidence_absent",
      }
    );
  }

  async getRankingParse(): Promise<ScoringRankingParseResult> {
    this.assertNoNetworkReachable();
    this.rankingCalls += 1;
    if (this.fixtures.rankingParseThrow) {
      throw this.fixtures.rankingParseThrow;
    }
    return (
      this.fixtures.rankingParse ?? {
        evidence: null,
        providerCalls: 0,
        unavailableReason: "fixture_ranking_parse_absent",
      }
    );
  }

  async getPointsAndDamageProfile(): Promise<ScoringProfilePayloadResult> {
    this.assertNoNetworkReachable();
    this.profileCalls += 1;
    return (
      this.fixtures.profile ?? {
        payload: null,
        providerCalls: 0,
        unavailableReason: "fixture_profile_absent",
      }
    );
  }
}
