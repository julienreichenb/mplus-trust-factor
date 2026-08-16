/**
 * Public projection of the persisted overall calculation for this snapshot.
 */

export interface ScoreCalculationComponentPublicDTO {
  key: string;
  label: string;
  score: number | null;
  effectiveWeight: number | null;
  contribution: number | null;
}

export interface ScoreCalculationPerformanceMixPublicDTO {
  damageParse: number;
  healingParse: number;
  cooldown: number;
}

export interface ScoreCalculationPublicDTO {
  overallFormula: string | null;
  role: "DPS" | "TANK" | "HEALER" | null;
  components: ScoreCalculationComponentPublicDTO[];
  performanceMix: ScoreCalculationPerformanceMixPublicDTO | null;
}

export type RunCooldownEventTargetKind =
  | "SELF"
  | "FRIENDLY_PLAYER"
  | "FRIENDLY_OTHER"
  | "HOSTILE"
  | "UNKNOWN";

export interface RunCooldownEventTargetPublicDTO {
  kind: RunCooldownEventTargetKind;
  name: string | null;
  classSlug: string | null;
  iconName: string | null;
  portraitUrl: string | null;
}

export interface RunCooldownEventPublicDTO {
  kind: "COOLDOWN";
  timestampMs: number;
  dimension: "PERFORMANCE" | "UTILITY" | "SURVIVAL";
  type: string;
  abilityId: number | null;
  abilityName: string | null;
  iconName?: string | null;
  iconUrl: string | null;
  segmentIndex?: number | null;
  target?: RunCooldownEventTargetPublicDTO | null;
}

export interface RunDeathTimelineEventPublicDTO {
  kind: "DEATH";
  timestampMs: number;
  playerName: string;
  classSlug: string | null;
  segmentIndex: number | null;
}

export type RunTimelineEventPublicDTO = RunCooldownEventPublicDTO | RunDeathTimelineEventPublicDTO;

export type RunCooldownTimelineStatus = "UNAVAILABLE" | "EMPTY" | "AVAILABLE";

export interface RunCooldownCombatSegmentPublicDTO {
  index: number;
  startMs: number;
  endMs: number;
  bossName?: string | null;
  bossPortraitUrl?: string | null;
}

export interface RunCooldownTimelinePublicDTO {
  status: RunCooldownTimelineStatus;
  durationMs: number | null;
  events: RunTimelineEventPublicDTO[];
  truncated?: boolean;
  totalEventCount?: number;
  segments?: RunCooldownCombatSegmentPublicDTO[];
}

export interface CanonicalEvidenceReportPublicDTO {
  identity: "PRIMARY" | "SECONDARY";
  keyLevel: number | null;
  completedAt: string | null;
  wclUrl: string | null;
  cooldownTimeline?: RunCooldownTimelinePublicDTO | null;
}

export interface CanonicalDungeonEvidencePublicDTO {
  dungeonSlug: string;
  dungeonName: string;
  reports: CanonicalEvidenceReportPublicDTO[];
}
