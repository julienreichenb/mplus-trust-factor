import type { IsoDateTime, RegionCode, CharacterIdentityInput } from "./identity.js";
import type { ScoreSnapshotDTO, RedFlagDTO, Grade } from "./scoring.js";
import type { JobStatusDTO } from "./jobs.js";
import type { WclContributionType, WclDataState, WclVisibilityState } from "./warcraftlogs.js";
import type { CharacterProviderStateDTO, SourceDisagreementDTO } from "./fusion.js";

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    /** When true, client may retry with backoff. Optional for backward compatibility. */
    retryable?: boolean;
    details?: unknown;
  };
}

export interface SearchCharacterRequest {
  region: RegionCode;
  realmSlug: string;
  name: string;
}

export interface SearchCharacterResponse {
  characterId: string | null;
  identity: CharacterIdentityInput;
  refreshStatus: "FRESH" | "QUEUED" | "STALE" | "REFRESHING" | "FAILED" | "NOT_FOUND";
  job: JobStatusDTO | null;
  score: ScoreSnapshotDTO | null;
}

/** Exact character+realm resolution for the dual-field search flow. */
export type CharacterResolveStatus =
  | "READY"
  | "QUEUED"
  | "PROCESSING"
  | "PROFILE_ONLY"
  | "NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "FAILED";

export type CharacterResolveResponse =
  | {
      status: "READY";
      characterId: string;
      profilePath: string;
    }
  | {
      status: "QUEUED" | "PROCESSING";
      characterId: string;
      refreshId: string;
      profilePath: string;
      retryAfterMs: number;
    }
  | {
      /**
       * Navigable shell without a score refresh. Used when bootstrap is incomplete
       * (repairable) or when required Blizzard fields are present but refresh is
       * ineligible. Never means an active QUEUED job.
       */
      status: "PROFILE_ONLY";
      characterId: string;
      profilePath: string;
      reason: "BOOTSTRAP_INCOMPLETE" | "NOT_REFRESH_ELIGIBLE";
      bootstrapRepairRequired: boolean;
    }
  | {
      status: "NOT_FOUND";
      message: string;
    }
  | {
      status: "PROVIDER_UNAVAILABLE";
      retryable: true;
      message: string;
    }
  | {
      status: "FAILED";
      retryable: boolean;
      message: string;
    };

export interface CharacterResolveRequest {
  name: string;
  realmSlug: string;
  region: RegionCode;
  /**
   * Exact resolve retry — also the canonical Blizzard bootstrap repair trigger
   * for incomplete persisted shells / prior eligibility-UNKNOWN failures.
   */
  forceRetry?: boolean;
}

/** Combobox row from the retail realm catalog. */
export interface RealmCatalogOption {
  name: string;
  slug: string;
  region: RegionCode;
  locale: string | null;
  connectedRealmId: number | null;
  displayLabel: string;
  timezone?: string | null;
  category?: string | null;
}

export interface RealmCatalogResponse {
  realms: RealmCatalogOption[];
}

/** Autocomplete row kind: indexed hit, synthetic new-character resolve, or realm-missing hint. */
export type CharacterAutocompleteKind = "indexed" | "resolve" | "hint";

/** Internal fuzzy character search suggestion — not a Blizzard global search. */
export interface CharacterAutocompleteSuggestion {
  name: string;
  realmSlug: string;
  region: RegionCode;
  classSlug: string | null;
  specSlug: string | null;
  avatarUrl: string | null;
  classIconUrl: string | null;
  /** Prefer `kind`; legacy indexed sources remain for known characters. */
  source?: "character" | "alias" | "participant" | "resolve" | "hint";
  kind?: CharacterAutocompleteKind;
  /** Human realm label when resolved from the catalog (e.g. "Archimonde"). */
  realmName?: string | null;
  /** Display label override (e.g. "Search Wallidrixe — Archimonde"). */
  label?: string | null;
}

export interface CharacterAutocompleteResponse {
  suggestions: CharacterAutocompleteSuggestion[];
}

export interface SelectedRunSummary {
  dungeonSlug: string;
  dungeonName: string;
  canonicalRunId: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  completedAt: IsoDateTime | null;
  wclReportMatched: boolean;
  selectionReason: "HIGHEST_KEY" | "HIGHEST_SCORE_TIEBREAK" | "LATEST_TIEBREAK" | null;
  coverageRatio: number | null;
}

export interface ScoringRunSelection {
  seasonSlug: string;
  expectedDungeonCount: number;
  selectedRuns: SelectedRunSummary[];
}

export interface AnalyzedRunSummary {
  runId: string;
  kind: "LATEST" | "HIGHEST" | "BOTH" | "SELECTED";
  dungeonName: string;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean;
  performanceSummary: string;
  coverageRatio: number;
}

/** One entry from the eight-run scoring selection exposed on the profile. */
export interface SelectedRunSummaryDTO {
  runId: string | null;
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number | null;
  completedAt: IsoDateTime | null;
  timed: boolean;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  selectionReason: "HIGHEST_KEY" | "HIGHEST_SCORE_TIEBREAK" | "LATEST_TIEBREAK" | null;
  parsePercentile: number | null;
  hasDetailedAnalysis: boolean;
  /**
   * Public Warcraft Logs report URL when a real source exists.
   * Never fabricated — null when unmatched or URL unknown.
   */
  wclUrl?: string | null;
}

/** Public equipment item — Blizzard-primary; missing fields stay null. */
export interface EquipmentItemDTO {
  slot: string;
  itemId: number | null;
  name: string | null;
  itemLevel: number | null;
  quality: string | null;
  iconUrl: string | null;
  enchantments: string[];
  gems: Array<{ name: string; itemId?: number | null }>;
  /** Blizzard equipped-item bonus IDs (scaling / crafted / sockets context). */
  bonusList?: number[];
}

export interface EquipmentSummary {
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  /** Full paperdoll slots in stable order when available. */
  items: EquipmentItemDTO[];
  /** High-signal subset (neck/rings/trinkets); also mirrored in items. */
  keyItems: EquipmentItemDTO[];
}

export type TalentTreeKind = "CLASS" | "SPEC" | "HERO" | "UNKNOWN";

/** Selected talent node from an active Blizzard loadout. */
export interface SelectedTalentDTO {
  id: number | null;
  name: string | null;
  spellId: number | null;
  rank: number | null;
  tree: TalentTreeKind;
  /** HTTPS icon when media enrichment succeeded. */
  iconUrl: string | null;
}

export interface TalentSummary {
  specializationSlug: string | null;
  loadoutCode: string | null;
  summary: string | null;
  loadoutName?: string | null;
  /** Active hero talent tree name (e.g. "Slayer"), when known. */
  heroTalentName?: string | null;
  selectedTalents?: SelectedTalentDTO[] | null;
  sourceProvider?: string | null;
  fetchedAt?: IsoDateTime | null;
}

/** Blizzard character media — HTTPS public assets only. */
export interface CharacterMediaDTO {
  avatarUrl: string | null;
  insetUrl: string | null;
  mainRawUrl: string | null;
}

export interface SeasonSummary {
  seasonSlug: string;
  seasonName?: string | null;
  /**
   * Unique canonical Mythic+ runs for this character in the season
   * (distinct MythicRun.canonicalFingerprint). Not provider source-reference count:
   * a single run sourced from both Raider.IO and WCL counts as 1.
   */
  runCount: number;
  mythicRating: number | null;
  priorSeasonRating: number | null;
  latestActivityAt?: IsoDateTime | null;
}

/** Sanitized PERFORMANCE explanation — no private report codes. */
export interface PerformanceExplanatoryRunDTO {
  runId: string;
  kind: "BEST" | "LATEST" | "BOTH";
  dungeonSlug: string;
  dungeonName: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean;
  parsePercentile: number | null;
  scoreValue: number | null;
  /**
   * Public Warcraft Logs report URL when a real source exists.
   * Never fabricated — null when unmatched or URL unknown.
   */
  wclUrl?: string | null;
}

export interface PerformanceDungeonSummaryDTO {
  dungeonSlug: string;
  dungeonName: string;
  encounterId?: number | null;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
  keystoneLevel?: number | null;
  throughputBracket?: number | null;
  ratingPoints?: number | null;
  scoreRank?: number | null;
  regionRank?: number | null;
  serverRank?: number | null;
  scoreRankPercent?: number | null;
  specialization?: string | null;
  bestDps?: number | null;
  completion?: {
    fastestKillRaw: number | null;
    speedRaw: number | null;
    fightMetadataRaw: number | null;
    leaderboardRaw: number | null;
    affixesRaw: number | null;
    completionTimeMs: null;
    encodingStatus: "unverified_not_emitted";
    encodingNote: string;
  } | null;
  bestRun: PerformanceExplanatoryRunDTO | null;
  latestRun: PerformanceExplanatoryRunDTO | null;
}

export type PerformanceProvenance = "AGGREGATE_ZONE_RANKINGS" | "FIGHT_BOUND_PARSES" | "NONE";

export interface PerformanceCurrentSeasonSummaryDTO {
  peakScore: number | null;
  consistencyScore: number | null;
  score: number | null;
  confidence: number;
  dungeonCount: number;
  availableDungeonCount?: number;
  expectedDungeonCount: number;
  totalMythicPlusScore?: number | null;
  totalLoggedRuns?: number;
  partition?: number | null;
  zoneId?: number | null;
  latestObservedAt: IsoDateTime | null;
  /** Whether percentiles are aggregate zone rankings vs fight-bound selected-run parses. */
  provenance?: PerformanceProvenance;
  specRanks?: Array<{
    spec: string | null;
    points: number | null;
    possiblePoints: number | null;
    rank: number | null;
    regionRank: number | null;
    serverRank: number | null;
    scoreRankPercent: number | null;
    total: number | null;
    partition: number | null;
  }>;
  diagnostics?: {
    ratingPointsExcludedFromScore: true;
    keystoneLevelExcludedFromScore: true;
    scoreRankPercentExcludedFromScore: true;
    throughputSampleCountUnavailable: true;
    performanceState?: string | null;
    unavailableEncounters?: Array<{
      encounterID: number;
      encounterName: string | null;
      dungeonSlug: string | null;
      reason: string;
    }>;
  };
  dungeons: PerformanceDungeonSummaryDTO[];
}

export interface PerformanceHistoricalSeasonSummaryDTO {
  seasonSlug: string;
  averageBestParsePercentile: number;
  dungeonCount: number;
}

export interface PerformanceHistoricalSummaryDTO {
  score: number;
  seasonsUsed: number;
  seasons: PerformanceHistoricalSeasonSummaryDTO[];
}

export interface PerformanceSummaryDTO {
  currentSeason: PerformanceCurrentSeasonSummaryDTO;
  historical: PerformanceHistoricalSummaryDTO | null;
}

/** Public aggregate-only Survival V1.1.1 explanation. */
export interface SurvivalSummaryPublicDTO {
  score: number | null;
  confidence: number;
  availableDungeonCount: number;
  expectedDungeonCount: number;
  scoreMode: "FULL_BEHAVIORAL" | "PARTIAL_BEHAVIORAL" | "OUTCOME_ONLY" | null;
  analyzedRunCount?: number;
  cachedRunCount?: number;
  newlyFetchedRunCount?: number;
  components?: {
    outcome: number | null;
    defensiveResponse: number | null;
    emergencyRecovery: number | null;
  };
  pressureClusterCount?: number;
  deathCount?: number;
  defensiveCounts?: { covered: number; missed: number; na: number };
  recoveryCounts?: { covered: number; missed: number; na: number };
  maxHpDiagnostics?: {
    invalidOutlierCount: number;
    baselineResolvedRunCount: number;
  };
  dungeons: Array<{
    dungeonSlug: string;
    dungeonName?: string;
    medianBehavioralScore: number | null;
    runCount: number;
    bestRun: {
      runId: string;
      dungeonSlug: string;
      dungeonName?: string;
      keyLevel: number | null;
      behavioralSurvivalScore: number | null;
      deathCount: number;
      pressureClusterCount?: number;
      hasWclSource: boolean;
    } | null;
  }>;
  notes: string[];
  requestCost?: {
    wclRequestCount?: number;
    estimatedPageCountIncreaseVsCalibrationDamageTaken?: number | null;
    notes?: string[];
  };
  diagnostics?: {
    rejectedCandidates: Array<{ reason: string; runId?: string; dungeonSlug?: string }>;
    lateBoundRunCount?: number;
    bindPoolSize?: number;
  };
}

export interface ProfileEntitlements {
  detailsUnlocked: boolean;
  runsUnlocked: boolean;
  compareExpanded: boolean;
}

export interface ProfileWarning {
  code: string;
  message: string;
  severity: "INFO" | "WARN";
}

export interface CharacterProfileResponse {
  characterId: string;
  region: RegionCode;
  realmSlug: string;
  /** Human-readable realm name when available. */
  realmName?: string | null;
  displayName: string;
  score: ScoreSnapshotDTO | null;
  redFlags: RedFlagDTO[];
  dataConfidence: number | null;
  lastAnalyzedRunId: string | null;
  highestAnalyzedRunId: string | null;
  sources: Array<{
    provider: string;
    fetchedAt: IsoDateTime;
    url: string | null;
    /** True when this provider contributed observations to the current score snapshot. */
    contributedToScore?: boolean;
    /** How this provider contributed (WCL: zone rankings and/or combat facts). */
    contributionTypes?: WclContributionType[];
  }>;
  /**
   * Coarse profile status (must agree with `/refresh-status` terminal semantics).
   * - FRESH: within score TTL
   * - QUEUED: an active durable refresh job exists (or was just enqueued) and no usable score yet
   * - STALE: published score usable but requires updating
   * - REFRESHING: published score usable while an in-flight refresh runs
   * - FAILED: latest refresh terminal-failed / blocked with no active job (repairable when bootstrap incomplete)
   */
  refreshStatus: "FRESH" | "QUEUED" | "STALE" | "REFRESHING" | "FAILED";
  /**
   * When true, exact `POST /characters/resolve` with `forceRetry: true` can repair
   * Blizzard bootstrap evidence for this character. Never set from GET provider work.
   */
  bootstrapRepairRequired?: boolean;
  /** Profile enrichments (Agent 6 / CR-06 / Agent 16) */
  classSlug?: string | null;
  specSlug?: string | null;
  role?: "DPS" | "TANK" | "HEALER" | null;
  faction?: string | null;
  level?: number | null;
  profileUrl?: string | null;
  itemLevel?: number | null;
  /** Score-snapshot freshness 0–1 when available (from explanation coverage). */
  freshness?: number | null;
  lastAnalyzedRun?: AnalyzedRunSummary | null;
  highestAnalyzedRun?: AnalyzedRunSummary | null;
  /** Wave 4 — one highest run per active-season dungeon, typically eight. */
  scoringRunSelection?: ScoringRunSelection | null;
  /** Serialized current-season eight-run selection for the profile UI. */
  selectedRuns?: SelectedRunSummaryDTO[];
  selectedRunCount?: number;
  detailedRunCount?: number;
  equipment?: EquipmentSummary | null;
  talents?: TalentSummary | null;
  media?: CharacterMediaDTO | null;
  seasonSummary?: SeasonSummary | null;
  /** Current-season WCL execution summary (aggregate only; no private report codes). */
  performanceSummary?: PerformanceSummaryDTO | null;
  /** Current-season WCL Survival V1.1.1 summary (aggregate only). */
  survivalSummary?: SurvivalSummaryPublicDTO | null;
  entitlements?: ProfileEntitlements;
  warnings?: ProfileWarning[];
  raiderIoUsed?: boolean;
  /** Explicit WCL profile visibility only: PUBLIC | HIDDEN | null. */
  wclVisibility?: WclVisibilityState | null;
  /** Matching / rankings / availability outcome — never a visibility substitute. */
  wclDataState?: WclDataState | null;
  /** Character-level provider lifecycle (present even when no runs exist). */
  providerStates?: CharacterProviderStateDTO[];
  sourceDisagreements?: SourceDisagreementDTO[];
}

export interface CharacterComparisonRequest {
  characters: CharacterIdentityInput[];
  seasonSlug?: string;
  modelKey?: string;
  modelVersion?: number;
}

export interface CharacterComparisonResponse {
  modelKey: string;
  modelVersion: number;
  seasonSlug: string;
  calculatedAt: IsoDateTime;
  entries: Array<{
    identity: CharacterIdentityInput;
    characterId: string | null;
    overallScore: number | null;
    grade: Grade | null;
    confidence: number | null;
    dimensions: ScoreSnapshotDTO["dimensions"] | null;
    rankingEligibility: ScoreSnapshotDTO["rankingEligibility"];
    /** True when this entry is included in median/best ranking math. */
    rankingIncluded: boolean;
    deltasFromMedian: Record<string, number | null>;
    deltasFromBest: Record<string, number | null>;
  }>;
}

export interface RefreshStatusResponse {
  characterId: string;
  refreshStatus: "FRESH" | "QUEUED" | "STALE" | "IN_PROGRESS" | "FAILED";
  job: JobStatusDTO | null;
  cooldownSecondsRemaining: number;
  /**
   * When true, call exact resolve with `forceRetry: true` (canonical repair path).
   * Admin rerun routes through the same repair for incomplete / UNKNOWN shells.
   */
  bootstrapRepairRequired?: boolean;
}

export interface AdminScoreModelDTO {
  id: string;
  key: string;
  version: number;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  config: unknown;
  createdAt: IsoDateTime;
  activatedAt: IsoDateTime | null;
}

/** Response after deleting a DRAFT score model. */
export interface DeleteScoreModelResponse {
  id: string;
  key: string;
  version: number;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

/** Safe (count-only) dependency breakdown surfaced on 409 SCORE_MODEL_DRAFT_IN_USE. */
export interface ScoreModelDependencyCounts {
  scoreSnapshots: number;
  characterRedFlags: number;
  addonExports: number;
  analysisBatches: number;
  bulkOperations: number;
}

/** Response after transactional activation (includes bulk recalculation hook). */
export interface ActivateScoreModelResponse extends AdminScoreModelDTO {
  previousActiveId: string | null;
  previousActiveVersion: number | null;
  /** Enqueued RECALCULATE_ONLY bulk operation id, when enqueue succeeded. */
  bulkOperationId: string | null;
  /**
   * When set, activation committed but bulk enqueue failed.
   * Retry via Admin Bulk Processing with this score model id.
   */
  bulkEnqueueError: string | null;
}

/**
 * Canonical HTTP response row for POST /api/v1/admin/misc/realms/sync.
 * Distinct from the worker's internal `RealmSyncResult` — always mapped explicitly.
 * Uses `indexEntries` (not ambiguous `indexed`).
 */
export interface AdminRealmSyncResult {
  region: string;
  indexEntries: number;
  rejectedAtIndex: number;
  detailCandidates: number;
  detailsFetched: number;
  eligible: number;
  rejectedTournament: number;
  rejectedInternal: number;
  detailFailures: number;
  retainedLastKnownGood: number;
  newlyDeactivated: number;
  activeCatalogCount: number;
  rejectedSamples: string[];
  /** Prefer `eligible` for new callers; retained for compatibility. */
  upserted: number;
  minimallyUpserted: number;
  enriched: number;
  enrichmentFailures: number;
  skippedDetails: number;
  errors: string[];
}

export interface AdminRealmSyncResponse {
  ok: true;
  results: AdminRealmSyncResult[];
}

/** Property names required on every AdminRealmSyncResult (API + OpenAPI + Fastify serialize). */
export const ADMIN_REALM_SYNC_RESULT_FIELDS = [
  "region",
  "indexEntries",
  "rejectedAtIndex",
  "detailCandidates",
  "detailsFetched",
  "eligible",
  "rejectedTournament",
  "rejectedInternal",
  "detailFailures",
  "retainedLastKnownGood",
  "newlyDeactivated",
  "activeCatalogCount",
  "rejectedSamples",
  "upserted",
  "minimallyUpserted",
  "enriched",
  "enrichmentFailures",
  "skippedDetails",
  "errors",
] as const satisfies ReadonlyArray<keyof AdminRealmSyncResult>;

export interface MetaResponse {
  name: string;
  version: string;
  environment: string;
  providerMode: "fixture" | "live";
  activeScoreModel: {
    key: string;
    version: number;
  };
}
