/**
 * Injectable evidence transport for Scoring V2 acquisition.
 * Production may call WCL; tests inject fixtures that never touch the network.
 */

import type { ProviderFetchContext } from "@mplus/contracts";
import type {
  RankingParseEvidenceV2,
  WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";

export interface ScoringV2FightDetailsResult {
  data: unknown;
  reportRevision: number;
  playerActorId: number | null;
  ownedPetActorIds: number[];
  startTime: number | null;
  endTime: number | null;
  dungeonSlug: string | null;
  /** Provider round-trips performed for this call (0 = cache/fixture reuse). */
  providerCalls: number;
}

export interface ScoringV2SharedEvidenceResult {
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

export interface ScoringV2RankingParseResult {
  evidence: RankingParseEvidenceV2 | null;
  providerCalls: number;
  unavailableReason: string | null;
}

export interface ScoringV2ProfilePayloadResult {
  payload: unknown | null;
  providerCalls: number;
  unavailableReason: string | null;
}

/**
 * Acquisition-only transport. Calculators and finalizers must not use this.
 * Implementations must not perform network I/O when serving from fixtures/cache.
 */
export interface ScoringV2EvidenceTransport {
  getReportFightDetails(input: {
    reportCode: string;
    fightId: number;
    ctx: ProviderFetchContext;
    /** Hint from discovery/candidate — enables durable reuse before WCL. */
    expectedReportRevision?: number | null;
  }): Promise<ScoringV2FightDetailsResult>;

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
  }): Promise<ScoringV2SharedEvidenceResult>;

  getRankingParse(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
    dungeonSlug: string;
    keyLevel: number | null;
    ctx: ProviderFetchContext;
  }): Promise<ScoringV2RankingParseResult>;

  getPointsAndDamageProfile(input: {
    ctx: ProviderFetchContext;
  }): Promise<ScoringV2ProfilePayloadResult>;
}

/** Fixture/mock transport — records call counts; never opens sockets. */
export class FixtureScoringV2EvidenceTransport implements ScoringV2EvidenceTransport {
  private fightDetailsCalls = 0;
  private sharedEvidenceCalls = 0;
  private rankingCalls = 0;
  private profileCalls = 0;
  private networkBlocked = true;

  constructor(
    private readonly fixtures: {
      fightDetails?: ScoringV2FightDetailsResult;
      sharedEvidence?: ScoringV2SharedEvidenceResult;
      rankingParse?: ScoringV2RankingParseResult;
      profile?: ScoringV2ProfilePayloadResult;
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

  async getReportFightDetails(): Promise<ScoringV2FightDetailsResult> {
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

  async acquireSharedEvidence(): Promise<ScoringV2SharedEvidenceResult> {
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

  async getRankingParse(): Promise<ScoringV2RankingParseResult> {
    this.assertNoNetworkReachable();
    this.rankingCalls += 1;
    return (
      this.fixtures.rankingParse ?? {
        evidence: null,
        providerCalls: 0,
        unavailableReason: "fixture_ranking_parse_absent",
      }
    );
  }

  async getPointsAndDamageProfile(): Promise<ScoringV2ProfilePayloadResult> {
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
