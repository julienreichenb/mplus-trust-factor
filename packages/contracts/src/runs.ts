import type { IsoDateTime, RegionCode } from "./identity.js";

export interface RunSourceRefDTO {
  provider: "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDER_IO";
  externalRunId: string;
  externalUrl: string | null;
  reportCode: string | null;
  fightId: number | null;
  revision: number | null;
  /**
   * WCL parse percentile tied to this report/fight when known.
   * Never a character-wide best substitute for a different fight.
   */
  parsePercentile?: number | null;
  /** Bracket-aware rank percent when WCL provided it on the ranking row. */
  rankPercent?: number | null;
  /** WCL keystone bracket when the ranking row was bracket-aware. */
  bracket?: number | null;
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
