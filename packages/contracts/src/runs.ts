import type { IsoDateTime, RegionCode } from "./identity.js";

export interface RunSourceRefDTO {
  provider: "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO";
  externalRunId: string;
  externalUrl: string | null;
  reportCode: string | null;
  fightId: number | null;
  revision: number | null;
}

export interface RunParticipantDTO {
  providerCharacterKey: string;
  displayName: string;
  realmSlug: string;
  region: RegionCode;
  classSlug: string | null;
  specSlug: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  itemLevel: number | null;
  mythicRatingAtRun: number | null;
  isTargetCharacter: boolean;
  characterId: string | null;
}

export interface MythicRunDTO {
  id: string;
  region: RegionCode;
  seasonSlug: string;
  dungeonSlug: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  durationMs: number;
  timerMs: number | null;
  timed: boolean;
  scoreValue: number | null;
  canonicalFingerprint: string;
  affixes: unknown;
  participants: RunParticipantDTO[];
  sources: RunSourceRefDTO[];
}

/**
 * Detailed run selection for expensive log analysis.
 * If LATEST and HIGHEST resolve to the same run, analyze once (dedupe).
 */
export type DetailedRunSelectionKind = "LATEST" | "HIGHEST";

export interface DetailedRunSelection {
  kinds: DetailedRunSelectionKind[];
  /** When true, identical LATEST/HIGHEST runs are analyzed once. Default: true. */
  dedupeIdentical: boolean;
}

export type ScoringRunSelectionReason =
  | "HIGHEST_KEY"
  | "HIGHEST_SCORE_TIEBREAK"
  | "LATEST_TIEBREAK";

export interface ScoringRunSelectionEntry {
  dungeonSlug: string;
  canonicalRunId: string;
  keyLevel: number;
  timed: boolean | null;
  completedAt: IsoDateTime;
  durationMs: number | null;
  raiderIoScore: number | null;
  wclReportMatched: boolean;
  wclCoverageRatio: number | null;
  selectionReason: ScoringRunSelectionReason;
}

export interface ScoringRunSelection {
  seasonSlug: string;
  expectedDungeonCount: number;
  selectedRuns: ScoringRunSelectionEntry[];
}
