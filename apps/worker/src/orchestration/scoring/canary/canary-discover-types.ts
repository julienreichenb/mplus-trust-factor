/**
 * Discovery-only canary report + effect contracts.
 */
import type {
  EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
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
  reportsListed: number;
  reportsHydrated: number;
  fightsExamined: number;
  graphqlRequestCount: number;
  /** Detailed capability / combat event pages — must remain 0. */
  capabilityEventPageRequestCount: number;
  measuredPoints: number | null;
  estimatedPoints: number | null;
  /** Reports listed but never hydrated, with exact omission reason. */
  omittedReports?: Array<{
    reportCode: string;
    reason: string;
    dungeonSlug: string | null;
    listedOrderIndex?: number | null;
  }>;
  unhydratedReportCount?: number;
  iterativeHydration?: {
    initialHydrationBudget: number;
    reportsHydratedInitial: number;
    incrementalBatchCount: number;
    reportsHydratedIncrementally: number;
    totalReportsHydrated: number;
    totalReportsListed: number;
    reportsRemaining: number;
    incrementalProviderCalls: number;
    incrementalEstimatedPoints: number;
    terminalHydrationReason: string;
    listedReportOrder: string[];
    initialHydrationOrder: string[];
  } | null;
  discoveryStrategy?:
    | "encounter_rankings"
    | "encounter_rankings_with_hydration_fallback"
    | "recent_reports_hydration";
  hydrationFallbackReason?: string | null;
  providerCallBreakdown?: {
    zoneCatalog: number;
    characterDiscovery: number;
    reportHydration: number;
  };

  /**
   * Post-hydration diagnostics: where hydrated fights survive the
   * normalization filters before becoming EvidenceCandidateMetadataV2.
   */
  hydratedFightCandidates?: {
    total: number;
    fightUnknown: number;
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
  reportsListed: number;
  reportsHydrated: number;
  unhydratedReportCount: number;
  fightsExamined: number;
  /** Unique discovery candidates observed (alias of historical candidateCount). */
  discoveredCandidateCount: number;
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
  /**
   * Counter definitions (unambiguous):
   * - discoveredCandidateCount: unique discovery candidates observed
   * - uniqueEligibleCandidateCount: unique eligible plan identities (not per-slot sum)
   * - selectedSourceFightCount: SELECTED slots with distinct reportCode:fightId
   * - rejectedCandidateCount: rejectedCandidates length
   * - unhydratedReportCount: listed stubs never fetched
   */
  counterDefinitions: {
    discoveredCandidateCount: "unique_discovered_candidates";
    uniqueEligibleCandidateCount: "unique_eligible_plan_identities";
    selectedSourceFightCount: "selected_distinct_source_fights";
    rejectedCandidateCount: "rejected_candidates";
    unhydratedReportCount: "listed_not_hydrated_reports";
    candidateCountPerDungeon: "unique_discovered_candidates_per_dungeon";
    eligibleCandidateCountPerDungeon: "unique_eligible_plan_identities_per_dungeon";
  };
  omittedReports: Array<{
    reportCode: string;
    reason: string;
    dungeonSlug: string | null;
    listedOrderIndex?: number | null;
  }>;
  analysisStatus: "EMPTY" | "PARTIAL" | "COMPLETE";
  supersedesManifestId: string | null;
  /** Iterative hydration accounting (null when complete-manifest reuse skipped discovery). */
  iterativeHydration: {
    initialHydrationBudget: number;
    reportsHydratedInitial: number;
    incrementalBatchCount: number;
    reportsHydratedIncrementally: number;
    totalReportsHydrated: number;
    totalReportsListed: number;
    reportsRemaining: number;
    incrementalProviderCalls: number;
    incrementalEstimatedPoints: number;
    terminalHydrationReason: string;
  } | null;

  /**
   * Post-hydration diagnostics: where hydrated fights survive the
   * normalization filters before becoming EvidenceCandidateMetadataV2.
   */
  hydratedFightCandidates?: {
    total: number;
    fightUnknown: number;
    invalidFightId: number;
    missingDungeonSlug: number;
    dungeonSlugNotInActivePool: number;
    invalidKeyLevel: number;
    visibilityExcluded: number;
    byDungeonSlug: Record<string, number>;
  };
  targetReportTrace: {
    reportCode: string;
    listed: boolean;
    listedOrderIndex: number | null;
    inInitialHydrationSet: boolean;
    omitted: boolean;
    omissionReason: string | null;
    terminalState: string;
  } | null;
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
  rateAdmission: "ALLOW" | "WARN_ALLOW" | "DEFER" | "STOP" | "NOT_EVALUATED";
  rateAdmissionReasons: string[];
  bootstrap: CanaryRateSnapshotBootstrapReport | null;
  discoveryAdmission: CanaryDiscoveryAdmissionReport | null;
  capabilityPackageAcquisitions: 0;
  capabilityPackagesCreated: 0;
  participantDigestsCreated: 0;
  scoreCalculations: 0;
  publicationEnabled: false;
  publicScorePointerMutated: false;
  reusedExistingManifest: boolean;
  providerCallsBeforeDiscovery: number;
}
