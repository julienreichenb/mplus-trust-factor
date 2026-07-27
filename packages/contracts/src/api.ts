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
  refreshStatus: "FRESH" | "QUEUED" | "STALE" | "NOT_FOUND";
  job: JobStatusDTO | null;
  score: ScoreSnapshotDTO | null;
}

export interface AnalyzedRunSummary {
  runId: string;
  kind: "LATEST" | "HIGHEST" | "BOTH";
  dungeonName: string;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  timed: boolean;
  performanceSummary: string;
  coverageRatio: number;
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
}

export interface EquipmentSummary {
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  /** Full paperdoll slots in stable order when available. */
  items: EquipmentItemDTO[];
  /** High-signal subset (neck/rings/trinkets); also mirrored in items. */
  keyItems: EquipmentItemDTO[];
}

export interface TalentSummary {
  specializationSlug: string | null;
  loadoutCode: string | null;
  summary: string | null;
  loadoutName?: string | null;
  selectedTalents?: Array<{ id: number | null; name: string | null }> | null;
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
}

export interface PerformanceDungeonSummaryDTO {
  dungeonSlug: string;
  dungeonName: string;
  bestParsePercentile: number | null;
  medianParsePercentile: number | null;
  loggedRunCount: number;
  bestRun: PerformanceExplanatoryRunDTO | null;
  latestRun: PerformanceExplanatoryRunDTO | null;
}

export interface PerformanceCurrentSeasonSummaryDTO {
  peakScore: number | null;
  consistencyScore: number | null;
  score: number | null;
  confidence: number;
  dungeonCount: number;
  expectedDungeonCount: number;
  latestObservedAt: IsoDateTime | null;
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
  refreshStatus: "FRESH" | "QUEUED" | "STALE";
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
  equipment?: EquipmentSummary | null;
  talents?: TalentSummary | null;
  media?: CharacterMediaDTO | null;
  seasonSummary?: SeasonSummary | null;
  /** Current-season WCL execution summary (aggregate only; no private report codes). */
  performanceSummary?: PerformanceSummaryDTO | null;
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
    deltasFromMedian: Record<string, number | null>;
    deltasFromBest: Record<string, number | null>;
  }>;
}

export interface RefreshStatusResponse {
  characterId: string;
  refreshStatus: "FRESH" | "QUEUED" | "STALE" | "IN_PROGRESS" | "FAILED";
  job: JobStatusDTO | null;
  cooldownSecondsRemaining: number;
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
