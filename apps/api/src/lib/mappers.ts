import type { Character, IngestionJob, MechanicRule, ScoreModel } from "@mplus/database";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import {
  QUEUE_NAMES,
  type AdminScoreModelDTO,
  type CharacterIdentityInput,
  type CharacterProfileResponse,
  type IsoDateTime,
  type JobStatus,
  type JobStatusDTO,
  type QueueName,
  type ScoreSnapshotDTO,
  type WclContributionType,
} from "@mplus/contracts";
import type { RedFlagDTO } from "@mplus/contracts";
import { sanitizeSensitiveDeep } from "@mplus/observability";
import type { MythicRunWithRelations, ScoreSnapshotWithRelations } from "@mplus/worker";

const QUEUE_NAME_VALUES = new Set<string>(Object.values(QUEUE_NAMES));

function isQueueName(value: string): value is QueueName {
  return QUEUE_NAME_VALUES.has(value);
}

const JOB_STATUS_MAP: Record<IngestionJob["status"], JobStatus> = {
  QUEUED: "queued",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  // The JobStatusDTO union has no dedicated "cancelled" value; "failed" is the closest terminal,
  // unsuccessful state a client should react to the same way.
  CANCELLED: "failed",
};

function extractErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const sanitized = sanitizeSensitiveDeep({ message }) as { message: string };
  return sanitized.message;
}

function extractRedFlags(explanation: unknown): RedFlagDTO[] {
  if (!explanation || typeof explanation !== "object") return [];
  const stored = (explanation as { redFlags?: unknown }).redFlags;
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (flag): flag is RedFlagDTO =>
      Boolean(flag) &&
      typeof flag === "object" &&
      "key" in flag &&
      typeof (flag as RedFlagDTO).key === "string",
  );
}

function readCoverageMeta(explanation: unknown): Pick<
  ScoreSnapshotDTO,
  | "overallState"
  | "availableModelWeight"
  | "totalModelWeight"
  | "modelCoverageRatio"
  | "provisionalReason"
> {
  if (!explanation || typeof explanation !== "object") return {};
  const coverage = (explanation as { coverage?: Record<string, unknown> }).coverage;
  if (!coverage || typeof coverage !== "object") return {};
  const overallState = coverage.overallState;
  return {
    overallState:
      overallState === "DEFINITIVE" || overallState === "PROVISIONAL" ? overallState : undefined,
    availableModelWeight:
      typeof coverage.availableModelWeight === "number" ? coverage.availableModelWeight : undefined,
    totalModelWeight:
      typeof coverage.totalModelWeight === "number" ? coverage.totalModelWeight : undefined,
    modelCoverageRatio:
      typeof coverage.modelCoverageRatio === "number" ? coverage.modelCoverageRatio : undefined,
    provisionalReason:
      typeof coverage.provisionalReason === "string" ? coverage.provisionalReason : undefined,
  };
}

function readRankingEligibility(
  explanation: unknown,
): ScoreSnapshotDTO["rankingEligibility"] {
  if (!explanation || typeof explanation !== "object") return null;
  const raw = (explanation as { rankingEligibility?: unknown }).rankingEligibility;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  return {
    eligible: rec.eligible === true,
    scoreModelVersion: typeof rec.scoreModelVersion === "number" ? rec.scoreModelVersion : 0,
    utilityEligible: rec.utilityEligible === true,
    reasons: Array.isArray(rec.reasons)
      ? rec.reasons.filter((r): r is string => typeof r === "string")
      : [],
  };
}

const PUBLIC_EXPLANATION_FORBIDDEN_KEYS = new Set([
  "reportcode",
  "client_secret",
  "clientsecret",
  "access_token",
  "accesstoken",
  "refreshtoken",
  "refresh_token",
  "authorization",
]);

/** Strip private provider identifiers from score explanations before public API responses. */
export function sanitizePublicExplanation(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePublicExplanation(entry));
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (PUBLIC_EXPLANATION_FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    out[key] = sanitizePublicExplanation(entry);
  }
  return out;
}

/** Maps a persisted `ScoreSnapshot` (+ dimensions/model/season relations) to the public DTO. */
export function mapScoreSnapshot(snapshot: ScoreSnapshotWithRelations): ScoreSnapshotDTO {
  const redFlags = extractRedFlags(snapshot.explanation);
  const coverageMeta = readCoverageMeta(snapshot.explanation);
  const rankingEligibility = readRankingEligibility(snapshot.explanation);
  return {
    characterId: snapshot.characterId,
    seasonSlug: snapshot.season.slug,
    modelKey: snapshot.scoreModel.key,
    modelVersion: snapshot.scoreModel.version,
    scopeType: snapshot.scopeType,
    scopeKey: snapshot.scopeKey,
    overallScore: Number(snapshot.overallScore),
    grade: snapshot.grade as ScoreSnapshotDTO["grade"],
    skillScore: Number(snapshot.skillScore),
    authenticityScore: Number(snapshot.authenticityScore),
    confidence: Number(snapshot.confidence),
    overallState: coverageMeta.overallState,
    availableModelWeight: coverageMeta.availableModelWeight,
    totalModelWeight: coverageMeta.totalModelWeight,
    modelCoverageRatio: coverageMeta.modelCoverageRatio,
    provisionalReason: coverageMeta.provisionalReason,
    rankingEligibility,
    calculatedAt: snapshot.calculatedAt.toISOString(),
    inputFingerprint: snapshot.inputFingerprint,
    dimensions: snapshot.dimensionScores
      .filter((dimension) => Number(dimension.weight) > 0)
      .map((dimension) => {
      const rawState = (dimension as { state?: string }).state;
      const confidence = Number(dimension.confidence);
      const score = dimension.score == null ? null : Number(dimension.score);
      const state =
        rawState === "AVAILABLE" ||
        rawState === "PARTIAL" ||
        rawState === "UNAVAILABLE" ||
        rawState === "PROCESSING" ||
        rawState === "ERROR"
          ? rawState
          : confidence <= 0 || score == null
            ? "UNAVAILABLE"
            : confidence < 0.35
              ? "PARTIAL"
              : "AVAILABLE";
      return {
        dimension: dimension.dimension,
        score,
        confidence,
        weight: Number(dimension.weight),
        state,
        reason: (dimension as { reason?: string | null }).reason ?? null,
        contributors: dimension.contributors,
      };
    }),
    redFlags,
    explanation: sanitizePublicExplanation(snapshot.explanation),
  };
}

/** Maps a persisted `IngestionJob` row to the public job-status DTO. Never includes raw payload/secrets. */
export function mapJobStatus(job: IngestionJob): JobStatusDTO {
  return {
    jobId: job.id,
    queue: isQueueName(job.jobType) ? job.jobType : QUEUE_NAMES.refreshCharacter,
    status: JOB_STATUS_MAP[job.status] ?? "unknown",
    dedupeKey: job.dedupeKey,
    createdAt: job.scheduledAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.completedAt?.toISOString() ?? null,
    errorMessage: extractErrorMessage(job.error),
  };
}

export interface CharacterSourceAttribution {
  provider: string;
  fetchedAt: IsoDateTime;
  url: string | null;
  contributedToScore?: boolean;
  contributionTypes?: WclContributionType[];
}

export interface CharacterProfileMapInput {
  character: Character;
  identity: CharacterIdentityInput;
  snapshot: ScoreSnapshotWithRelations | null;
  latestRunId: string | null;
  highestRunId: string | null;
  sources: CharacterSourceAttribution[];
  refreshStatus: CharacterProfileResponse["refreshStatus"];
}

/** Maps character + latest score + run/source metadata into the public profile response. */
export function mapCharacterProfile(input: CharacterProfileMapInput): CharacterProfileResponse {
  const score = input.snapshot ? mapScoreSnapshot(input.snapshot) : null;
  return {
    characterId: input.character.id,
    region: normalizeRegion(input.identity.region),
    realmSlug: normalizeRealmSlug(input.identity.realmSlug),
    displayName: input.character.displayName,
    score,
    redFlags: score?.redFlags ?? [],
    dataConfidence: score?.confidence ?? null,
    lastAnalyzedRunId: input.latestRunId,
    highestAnalyzedRunId: input.highestRunId,
    sources: input.sources,
    refreshStatus: input.refreshStatus,
  };
}

/** Maps a persisted `ScoreModel` row for admin surfaces (config is not secret, safe to expose to admins). */
export function mapAdminScoreModel(model: ScoreModel): AdminScoreModelDTO {
  return {
    id: model.id,
    key: model.key,
    version: model.version,
    name: model.name,
    status: model.status,
    config: model.config,
    createdAt: model.createdAt.toISOString(),
    activatedAt: model.activatedAt?.toISOString() ?? null,
  };
}

export interface RunSourceDTO {
  provider: string;
  externalUrl: string | null;
}

/** Compact run summary for the `/runs` route — not the full internal `MythicRunDTO` shape. */
export interface RunSummaryDTO {
  runId: string;
  dungeonSlug: string;
  seasonSlug: string;
  keyLevel: number;
  completedAt: IsoDateTime;
  durationMs: number;
  timerMs: number | null;
  timed: boolean;
  scoreValue: number | null;
  sources: RunSourceDTO[];
}

export function mapRunSummary(run: MythicRunWithRelations): RunSummaryDTO {
  return {
    runId: run.id,
    dungeonSlug: run.dungeon.slug,
    seasonSlug: run.season.slug,
    keyLevel: run.keyLevel,
    completedAt: run.completedAt.toISOString(),
    durationMs: run.durationMs,
    timerMs: run.timerMs,
    timed: run.timed,
    scoreValue: run.scoreValue,
    sources: run.sources.map((source) => ({ provider: source.provider, externalUrl: source.externalUrl })),
  };
}

export interface MechanicRuleDTO {
  id: string;
  seasonId: string;
  dungeonId: string;
  npcId: number | null;
  spellId: number;
  ruleType: MechanicRule["ruleType"];
  severity: number;
  applicableRoles: Array<"DPS" | "TANK" | "HEALER">;
  responseSpellIds: number[];
  notes: string | null;
  source: string;
  version: string;
  active: boolean;
}

export function mapMechanicRule(rule: MechanicRule): MechanicRuleDTO {
  return {
    id: rule.id,
    seasonId: rule.seasonId,
    dungeonId: rule.dungeonId,
    npcId: rule.npcId !== null ? Number(rule.npcId) : null,
    spellId: Number(rule.spellId),
    ruleType: rule.ruleType,
    severity: Number(rule.severity),
    applicableRoles: (rule.applicableRoles ?? []) as Array<"DPS" | "TANK" | "HEALER">,
    responseSpellIds: (rule.responseSpellIds ?? []) as number[],
    notes: rule.notes,
    source: rule.source,
    version: rule.version,
    active: rule.active,
  };
}

export { normalizeName, normalizeRealmSlug, normalizeRegion };
