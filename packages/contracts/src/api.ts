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
