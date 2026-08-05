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
  "scoring-v2-canary-discovery-v1" as const;

export interface CanaryDiscoveryCandidateSource {
  candidates: EvidenceCandidateMetadataV2[];
  rankingEvidence: RankingParseEvidenceV2[];
  reportsListed: number;
  reportsHydrated: number;
  fightsExamined: number;
  graphqlRequestCount: number;
  /** Detailed capability / combat event pages — must remain 0. */
  capabilityEventPageRequestCount: number;
  measuredPoints: number | null;
  estimatedPoints: number | null;
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
  fightsExamined: number;
  candidateCountPerDungeon: Record<string, number>;
  eligibleCandidateCountPerDungeon: Record<string, number>;
  selectedRunsPerDungeon: Record<string, number>;
  selectedSlotCount: number;
  expectedSlotCount: number;
  missingSlots: Array<{ slotId: string; reason: string }>;
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
