import type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterProfileResponse,
  Grade,
  IsoDateTime,
  JobStatusDTO,
  MetaResponse,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  ScoreModelConfig,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
} from "@mplus/contracts";

/** Field visibility flags — launch may unlock everything. */
export interface Entitlements {
  detailsUnlocked: boolean;
  runsUnlocked: boolean;
  compareExpanded: boolean;
}

export interface ProfileWarning {
  code: string;
  message: string;
  severity: "INFO" | "WARN";
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

/**
 * Enriched profile view for the UI.
 * Embeds contract CharacterProfileResponse fields + Agent-6 interim enrichments.
 * @see doc/contracts/change-requests/06-profile-enrichment.md
 */
export interface CharacterProfileView extends CharacterProfileResponse {
  classSlug: string | null;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  itemLevel: number | null;
  lastAnalyzedRun: AnalyzedRunSummary | null;
  highestAnalyzedRun: AnalyzedRunSummary | null;
  equipment: EquipmentSummary | null;
  talents: TalentSummary | null;
  seasonSummary: SeasonSummary | null;
  entitlements: Entitlements;
  warnings: ProfileWarning[];
  /** True when Raider.IO contributed to rendered data (attribution gate). */
  raiderIoUsed: boolean;
}

export interface RealmOption {
  slug: string;
  name: string;
}

export interface ModelValidationResult {
  valid: boolean;
  errors: string[];
  weightSum: number;
}

export interface BacktestSummary {
  cohortSize: number;
  meanOverall: number;
  gradeDistribution: Record<Grade, number>;
  notes: string;
}

export interface EditableModelConfig extends ScoreModelConfig {
  nestedMetricWeights: {
    performance: Record<string, number>;
    survival: Record<string, number>;
    utility: Record<string, number>;
    experienceConsistency: Record<string, number>;
    mythicRaid: Record<string, number>;
  };
  confidenceParameters: {
    minRunsForFullConfidence: number;
    shrinkageFloor: number;
  };
  boostThresholds: {
    suspicionSoft: number;
    suspicionHard: number;
  };
}

export type ApiMode = "mock" | "live";

export interface MplusApiClient {
  getMeta(signal?: AbortSignal): Promise<MetaResponse>;
  searchRealms(region: RegionCode, query: string, signal?: AbortSignal): Promise<RealmOption[]>;
  getCharacterProfile(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
  ): Promise<CharacterProfileView>;
  refreshCharacter(
    identity: CharacterIdentityInput,
    signal?: AbortSignal,
  ): Promise<RefreshStatusResponse>;
  getRefreshStatus(characterId: string, signal?: AbortSignal): Promise<RefreshStatusResponse>;
  compareCharacters(
    request: CharacterComparisonRequest,
    signal?: AbortSignal,
  ): Promise<CharacterComparisonResponse>;
  listModels(signal?: AbortSignal): Promise<AdminScoreModelDTO[]>;
  cloneModel(modelId: string, signal?: AbortSignal): Promise<AdminScoreModelDTO>;
  updateModel(
    modelId: string,
    config: unknown,
    signal?: AbortSignal,
  ): Promise<AdminScoreModelDTO>;
  validateModel(modelId: string, config: unknown, signal?: AbortSignal): Promise<ModelValidationResult>;
  backtestModel(modelId: string, signal?: AbortSignal): Promise<BacktestSummary>;
  activateModel(modelId: string, signal?: AbortSignal): Promise<AdminScoreModelDTO>;
}

export type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  Grade,
  JobStatusDTO,
  MetaResponse,
  RedFlagDTO,
  RefreshStatusResponse,
  RegionCode,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
};
