/**
 * Calibration acquire + evaluate — reuses the canonical WCL discovery candidate
 * build and scoreCharacter / orchestrateScoringRuns path.
 *
 * Isolation invariant: never writes CharacterScore / ScoreSnapshot / published scores.
 * Shared evidence (WclRunRaw, CharacterRunDigest) is persisted normally and reusable.
 */
import { randomUUID } from "node:crypto";
import type {
  CharacterIdentityInput,
  EvidenceCandidateMetadataV2,
  EvidenceRole,
  ProviderFetchContext,
  RegionCode,
  ScoreSnapshotDTO,
} from "@mplus/contracts";
import { CALIBRATION_EVIDENCE_SOURCE_CANONICAL } from "@mplus/contracts";
import { mythicRunToEvidenceCandidateMetadataList } from "@mplus/scoring";
import type { WorkerContainer } from "../../container.js";
import { resolveActiveRefreshContract } from "../build-refresh-contract.js";
import { requirePersistedCatalogWclZoneId } from "../active-mplus-season/catalog-metadata.js";
import { canonicalDungeonKey } from "../run-fusion.js";
import {
  buildCandidatesFromPersistedDigests,
  mergeEvidenceCandidates,
} from "./digest-candidates.js";
import { runAuthoritativeScoring } from "./refresh-bridge.js";
import { scoreCharacterResultToSnapshotDto } from "./snapshot-from-character-score.js";

/** @deprecated Prefer CALIBRATION_EVIDENCE_SOURCE_CANONICAL from @mplus/contracts. */
export const CALIBRATION_EVIDENCE_SOURCE = CALIBRATION_EVIDENCE_SOURCE_CANONICAL;

export type CalibrationAcquireFailureStage =
  | "BLIZZARD_RESOLUTION"
  | "WCL_DISCOVERY"
  | "WCL_ACQUISITION"
  | "MISSING_EVIDENCE"
  | "SCORING_EVALUATION"
  | "CALIBRATION_PERSISTENCE";

export class CalibrationAcquireEvaluateError extends Error {
  readonly stage: CalibrationAcquireFailureStage;
  readonly code: string;

  constructor(stage: CalibrationAcquireFailureStage, code: string, message: string) {
    super(message);
    this.name = "CalibrationAcquireEvaluateError";
    this.stage = stage;
    this.code = code;
  }
}

export interface CalibrationAcquireEvaluateInput {
  characterId: string;
  seasonId: string;
  /** Evaluation ScoreModel id (ACTIVE or DRAFT). */
  scoreModelId: string;
  scoreModelKey: string;
  scoreModelVersion: number;
  /** Frozen evaluation config from CalibrationRun (immutable for this run). */
  scoreModelConfig?: Record<string, unknown> | null;
  /** Optional pre-resolved role/class/spec (cohort member overrides). */
  role?: EvidenceRole | null;
  classSlug?: string | null;
  specSlug?: string | null;
  correlationId?: string | null;
  now?: Date;
}

export interface CalibrationAcquireEvaluateResult {
  snapshot: ScoreSnapshotDTO;
  characterScoreId: null;
  providerCalls: number;
  digestsCreated: number;
  digestsReused: number;
  packagesCreated: number;
  packagesReused: number;
  discoveredCandidateCount: number;
  digestCandidateCount: number;
  selectedSlotCount: number;
  expectedSlotCount: number;
}

function allowLiveWcl(container: WorkerContainer): boolean {
  return (
    container.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
    container.env.PROVIDER_MODE === "live" &&
    container.env.WCL_ENABLED === true &&
    !container.disabledProviders.has("warcraftlogs")
  );
}

async function discoverWclCandidates(input: {
  container: WorkerContainer;
  identity: CharacterIdentityInput;
  activeDungeonSlugs: string[];
  correlationId: string | null;
  now: Date;
}): Promise<{ candidates: EvidenceCandidateMetadataV2[]; providerCalls: number }> {
  const { container, identity, activeDungeonSlugs, correlationId, now } = input;
  if (!allowLiveWcl(container)) {
    return { candidates: [], providerCalls: 0 };
  }

  const ctx: ProviderFetchContext = {
    region: identity.region,
    requestId: randomUUID(),
    correlationId,
    forceRefresh: false,
    now: now.toISOString(),
    targetCharacter: identity,
    ...(activeDungeonSlugs.length > 0 ? { wclActiveDungeonSlugs: activeDungeonSlugs } : {}),
  };

  try {
    const result = await container.providers.warcraftlogs.discoverCharacterRuns(identity, ctx);
    const candidates = result.data.flatMap((run) =>
      mythicRunToEvidenceCandidateMetadataList(run, { discoverySource: "wcl-discovery" }),
    );
    return { candidates, providerCalls: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CalibrationAcquireEvaluateError(
      "WCL_DISCOVERY",
      "WCL_DISCOVERY_FAILED",
      message.slice(0, 500),
    );
  }
}

/**
 * Acquire reusable WCL evidence (as needed) and evaluate the selected ScoreModel
 * without writing operational CharacterScore.
 */
export async function acquireAndEvaluateCalibrationMember(
  container: WorkerContainer,
  input: CalibrationAcquireEvaluateInput,
): Promise<CalibrationAcquireEvaluateResult> {
  const now = input.now ?? new Date();
  const character = await container.prisma.character.findUnique({
    where: { id: input.characterId },
    include: {
      region: true,
      realm: true,
      gameClass: true,
      activeSpec: true,
    },
  });
  if (!character) {
    throw new CalibrationAcquireEvaluateError(
      "BLIZZARD_RESOLUTION",
      "CHARACTER_NOT_FOUND",
      `Character ${input.characterId} was not found`,
    );
  }
  if (!character.region || !character.realm) {
    throw new CalibrationAcquireEvaluateError(
      "BLIZZARD_RESOLUTION",
      "CHARACTER_IDENTITY_INCOMPLETE",
      `Character ${input.characterId} is missing region/realm`,
    );
  }

  const season = await container.prisma.season.findUnique({ where: { id: input.seasonId } });
  if (!season) {
    throw new CalibrationAcquireEvaluateError(
      "MISSING_EVIDENCE",
      "SEASON_NOT_FOUND",
      `Season ${input.seasonId} was not found`,
    );
  }

  const model = await container.prisma.scoreModel.findUnique({
    where: { id: input.scoreModelId },
    select: { id: true, key: true, version: true, status: true },
  });
  if (!model) {
    throw new CalibrationAcquireEvaluateError(
      "SCORING_EVALUATION",
      "SCORE_MODEL_NOT_FOUND",
      `Score model ${input.scoreModelId} was not found`,
    );
  }

  const seasonDungeonRows = await container.prisma.seasonDungeon.findMany({
    where: { seasonId: season.id },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });
  const activeDungeonSlugs = seasonDungeonRows.map((row) =>
    canonicalDungeonKey(row.dungeon.slug),
  );

  const identity: CharacterIdentityInput = {
    region: character.region.code as RegionCode,
    realmSlug: character.realm.slug,
    name: character.displayName,
  };

  const digestCandidates = await buildCandidatesFromPersistedDigests({
    prisma: container.prisma,
    characterId: character.id,
  });

  let discoveryProviderCalls = 0;
  let discoveredCandidates: EvidenceCandidateMetadataV2[] = [];
  // Warm: digests alone may suffice. Cold: discovery fills the candidate pool.
  // Always attempt discovery when live WCL is allowed so selection matches production.
  if (allowLiveWcl(container)) {
    const discovered = await discoverWclCandidates({
      container,
      identity,
      activeDungeonSlugs,
      correlationId: input.correlationId ?? null,
      now,
    });
    discoveredCandidates = discovered.candidates;
    discoveryProviderCalls = discovered.providerCalls;
  }

  const candidates = mergeEvidenceCandidates(discoveredCandidates, digestCandidates);
  if (candidates.length === 0) {
    throw new CalibrationAcquireEvaluateError(
      "MISSING_EVIDENCE",
      "NO_SCORING_CANDIDATES",
      "No WCL discovery or persisted digest candidates available for scoring",
    );
  }

  const roleFromSpec = character.activeSpec?.role ?? null;
  const role =
    input.role ??
    (roleFromSpec as EvidenceRole | null) ??
    (character.role as EvidenceRole | null) ??
    "UNKNOWN";
  const classSlug = input.classSlug ?? character.gameClass?.slug ?? null;
  const specSlug = input.specSlug ?? character.activeSpec?.slug ?? null;

  const { contract: refreshContract } = resolveActiveRefreshContract({
    scoringModelKey: input.scoreModelKey,
    scoringModelVersion: input.scoreModelVersion,
    activeSeasonId: season.slug,
    providerMode: container.env.PROVIDER_MODE,
    zoneId: requirePersistedCatalogWclZoneId(season),
  });

  let scoringOutcome;
  try {
    scoringOutcome = await runAuthoritativeScoring({
      container,
      characterId: character.id,
      seasonId: season.id,
      seasonSlug: season.slug,
      role,
      classSlug,
      specSlug,
      refreshContract,
      evidenceCutoffAt: now.toISOString(),
      highKeyPolicyId: "high-key-policy-v1",
      activeDungeonSlugs,
      candidates,
      scoreModelKey: input.scoreModelKey,
      scoreModelVersion: input.scoreModelVersion,
      scoreModelId: input.scoreModelId,
      calculatedAt: now.toISOString(),
      region: identity.region,
      realm: identity.realmSlug,
      characterName: identity.name,
      // Calibration must never write operational CharacterScore.
      persistCharacterScore: false,
      scoreModelConfig: input.scoreModelConfig,
    });
  } catch (error) {
    if (error instanceof CalibrationAcquireEvaluateError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const stage: CalibrationAcquireFailureStage =
      /acquire|ReportEvents|capability|WCL/i.test(message)
        ? "WCL_ACQUISITION"
        : "SCORING_EVALUATION";
    throw new CalibrationAcquireEvaluateError(
      stage,
      stage === "WCL_ACQUISITION" ? "WCL_ACQUISITION_FAILED" : "SCORING_EVALUATION_FAILED",
      message.slice(0, 500),
    );
  }

  if (scoringOutcome.disabled || !scoringOutcome.scoreResult) {
    throw new CalibrationAcquireEvaluateError(
      "SCORING_EVALUATION",
      "SCORING_DISABLED",
      "Scoring is disabled — calibration cannot evaluate",
    );
  }

  if (scoringOutcome.scoreResult.characterScoreId != null) {
    throw new CalibrationAcquireEvaluateError(
      "CALIBRATION_PERSISTENCE",
      "CHARACTER_SCORE_WRITE_FORBIDDEN",
      "Calibration path wrote CharacterScore — aborting",
    );
  }

  const orch = scoringOutcome.scoreResult.orchestration;
  if (orch.selectedSlotCount === 0 && orch.fightFailures.length > 0) {
    throw new CalibrationAcquireEvaluateError(
      "WCL_ACQUISITION",
      "WCL_ACQUISITION_FAILED",
      orch.fightFailures.map((f) => f.message).join("; ").slice(0, 500) ||
        "Selected fight acquisition failed",
    );
  }

  const fingerprint = `calibration:${character.id}:${season.id}:${input.scoreModelId}:${now.toISOString()}`;
  const snapshot = scoreCharacterResultToSnapshotDto({
    result: scoringOutcome.scoreResult,
    characterId: character.id,
    seasonSlug: season.slug,
    scoreModelKey: input.scoreModelKey,
    scoreModelVersion: input.scoreModelVersion,
    calculatedAt: now.toISOString(),
    inputFingerprint: fingerprint,
    publicationEnabled: false,
  });

  return {
    snapshot,
    characterScoreId: null,
    providerCalls: scoringOutcome.providerCalls + discoveryProviderCalls,
    digestsCreated: orch.accounting.digestsCreated,
    digestsReused: orch.accounting.digestsReused,
    packagesCreated: orch.accounting.packagesCreated,
    packagesReused: orch.accounting.packagesReused,
    discoveredCandidateCount: discoveredCandidates.length,
    digestCandidateCount: digestCandidates.length,
    selectedSlotCount: orch.selectedSlotCount,
    expectedSlotCount: orch.expectedSlotCount,
  };
}
