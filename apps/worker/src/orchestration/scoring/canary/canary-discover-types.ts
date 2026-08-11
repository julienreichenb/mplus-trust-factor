/**
 * Discovery-only canary report + effect contracts (encounterRankings architecture).
 */
import type { EvidenceCandidateMetadataV2 } from "@mplus/contracts";
import type {
  RankingParseEvidenceV2,
  WclRateLimitSnapshot,
} from "@mplus/provider-warcraftlogs";
import type { CanaryCharacterResolution, CanaryRepositoryMode } from "./canary-deps.js";
import type {
  CanaryDiscoveryAdmissionReport,
  CanaryRateSnapshotBootstrapReport,
} from "./canary-rate-snapshot.js";

export const CANARY_DISCOVERY_REPORT_SCHEMA =
  "scoring-canary-discovery-v1" as const;

/** Ranking evidence may omit reportRevision until selected-fight revision resolve. */
export type CanaryDiscoveryRankingEvidence = Omit<
  RankingParseEvidenceV2,
  "reportRevision"
> & {
  reportRevision: number | null;
};

export interface CanaryDiscoveryCandidateSource {
  candidates: EvidenceCandidateMetadataV2[];
  rankingEvidence: CanaryDiscoveryRankingEvidence[];
  fightsExamined: number;
  graphqlRequestCount: number;
  /** Detailed capability / combat event pages — must remain 0. */
  capabilityEventPageRequestCount: number;
  measuredPoints: number | null;
  estimatedPoints: number | null;
  discoveryStrategy?: "encounter_rankings";
  providerCallBreakdown?: {
    zoneCatalog: number;
    characterDiscovery: number;
  };
  candidateNormalization?: {
    total: number;
    invalidFightId: number;
    missingDungeonSlug: number;
    dungeonSlugNotInActivePool: number;
    invalidKeyLevel: number;
    visibilityExcluded: number;
    byDungeonSlug: Record<string, number>;
  };
}

export interface CanaryDiscoveryForbiddenEffects {
  capabilityPackageAcquisitions: number;
  capabilityPackagesCreated: number;
  participantDigestsCreated: number;
  scoreCalculations: number;
  publicationEnabled: false;
  publicScorePointerMutated: false;
}

export interface CanaryDiscoveryReport {
  schemaVersion: typeof CANARY_DISCOVERY_REPORT_SCHEMA;
  repositoryMode: CanaryRepositoryMode;
  characterId: string;
  characterResolutionSource: CanaryCharacterResolution["characterResolutionSource"];
  seasonResolutionMode: "AUTO" | "PINNED";
  applicationSeasonId: string;
  seasonSlug: string;
  wclZoneId: number;
  catalogVersion: string;
  dungeonPoolHash: string;
  dungeonSlugs: string[];
  fightsExamined: number;
  /** Unique discovery candidates observed. */
  discoveredCandidateCount: number;
  candidateCount: number;
  eligibleCandidateCount: number;
  /** Unique eligible plan identities per dungeon (not summed across slots). */
  uniqueEligibleCandidateCount: number;
  selectedSourceFightCount: number;
  rejectedCandidateCount: number;
  candidateCountPerDungeon: Record<string, number>;
  eligibleCandidateCountPerDungeon: Record<string, number>;
  selectedRunsPerDungeon: Record<string, number>;
  selectedSlotCount: number;
  expectedSlotCount: number;
  missingSlots: Array<{ slotId: string; reason: string }>;
  counterDefinitions: {
    discoveredCandidateCount: "unique_discovered_candidates";
    uniqueEligibleCandidateCount: "unique_eligible_plan_identities";
    selectedSourceFightCount: "selected_distinct_source_fights";
    rejectedCandidateCount: "rejected_candidates";
    candidateCountPerDungeon: "unique_discovered_candidates_per_dungeon";
    eligibleCandidateCountPerDungeon: "unique_eligible_plan_identities_per_dungeon";
  };
  analysisStatus: "EMPTY" | "PARTIAL" | "COMPLETE";
  supersedesManifestId: string | null;
  candidateNormalization?: CanaryDiscoveryCandidateSource["candidateNormalization"];
  rankingEvidenceFound: number;
  rankingEvidenceFetched: number;
  rankingEvidencePersisted: number;
  manifestId: string | null;
  manifestStatus: "CREATED" | "REUSED" | "INCOMPLETE" | "FAILED";
  manifestCompatibilityFingerprint: string | null;
  /** Discovery-phase GraphQL calls (excludes bootstrap RateLimitData). */
  graphqlRequestCount: number;
  /** Bootstrap RateLimitData calls only. */
  bootstrapProviderCalls: number;
  eventPageRequestCount: number;
  measuredWclPoints: number | null;
  estimatedWclPoints: number | null;
  rateLimitSnapshot: WclRateLimitSnapshot | null;
  rateAdmission: "ALLOW" | "WARN" | "DEFER" | "STOP" | "NOT_EVALUATED";
  rateAdmissionReasons: string[];
  /** Null on complete-manifest reuse (provider path skipped). */
  bootstrap: CanaryRateSnapshotBootstrapReport | null;
  discoveryAdmission: CanaryDiscoveryAdmissionReport | null;
  forbiddenEffects: CanaryDiscoveryForbiddenEffects;
  publicationEnabled: false;
  publicScorePointerMutated: false;
}
