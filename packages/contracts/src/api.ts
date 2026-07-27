import type { IsoDateTime, RegionCode, CharacterIdentityInput } from "./identity.js";
import type { ScoreSnapshotDTO, RedFlagDTO, Grade } from "./scoring.js";
import type { JobStatusDTO } from "./jobs.js";

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

export interface EquipmentSummary {
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  keyItems: Array<{ slot: string; name: string; itemLevel: number | null }>;
}

export interface TalentSummary {
  specializationSlug: string | null;
  loadoutCode: string | null;
  summary: string | null;
}

export interface SeasonSummary {
  seasonSlug: string;
  runCount: number;
  mythicRating: number | null;
  priorSeasonRating: number | null;
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

/** Warcraft Logs visibility state surfaced on character profiles. */
export type WclVisibilityState =
  | "PUBLIC"
  | "HIDDEN"
  | "NO_PUBLIC_LOGS"
  | "PRIVATE_SKIPPED";

export interface CharacterProfileResponse {
  characterId: string;
  region: RegionCode;
  realmSlug: string;
  displayName: string;
  score: ScoreSnapshotDTO | null;
  redFlags: RedFlagDTO[];
  dataConfidence: number | null;
  lastAnalyzedRunId: string | null;
  highestAnalyzedRunId: string | null;
  sources: Array<{ provider: string; fetchedAt: IsoDateTime; url: string | null }>;
  refreshStatus: "FRESH" | "QUEUED" | "STALE";
  /** Profile enrichments (Agent 6 / CR-06) */
  classSlug?: string | null;
  specSlug?: string | null;
  role?: "DPS" | "TANK" | "HEALER" | null;
  itemLevel?: number | null;
  lastAnalyzedRun?: AnalyzedRunSummary | null;
  highestAnalyzedRun?: AnalyzedRunSummary | null;
  equipment?: EquipmentSummary | null;
  talents?: TalentSummary | null;
  seasonSummary?: SeasonSummary | null;
  entitlements?: ProfileEntitlements;
  warnings?: ProfileWarning[];
  raiderIoUsed?: boolean;
  wclVisibility?: WclVisibilityState | null;
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
