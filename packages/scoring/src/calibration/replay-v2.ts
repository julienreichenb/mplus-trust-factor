/**
 * Provider-free Calibration V2 replay from frozen dimension export artifacts.
 * Never refreshes evidence. Does not activate score models.
 *
 * Active-versus-draft evaluates ACTIVE and DRAFT dimension configs against
 * identical frozen facts/evidence references.
 */

import { createHash } from "node:crypto";
import {
  computePerformanceV2,
  type PerformanceV2CalibrationExport,
  type PerformanceV2ComputeInput,
  type PerformanceV2ModelConfig,
} from "../performance/v2/index.js";
import {
  computeExperienceV3,
  type ExperienceV3CalibrationExport,
  type ExperienceV3ComputeInput,
  type ExperienceV3ModelConfig,
} from "../experience/v3/index.js";
import {
  computeSurvivalV2,
  type SurvivalV2CalibrationExport,
  type SurvivalV2ComputeInput,
  type SurvivalV2ModelConfig,
} from "../survival/v2/index.js";
import {
  computeUtilityV2,
  type UtilityV2CalibrationExport,
  type UtilityV2ComputeInput,
  type UtilityV2ModelConfig,
} from "../utility/v2/index.js";
import type { ScoringV2PublicDimension } from "../dimensions/v2/shadow-record.js";
import { ModelConfigValidationError } from "../model-config/validate.js";
import { stableStringify } from "../model-config/stable-hash.js";
import {
  preflightCalibrationBundleV2,
  resolveFrozenDimensionConfigsForModel,
  type ArtifactResolverV2,
  type CalibrationInputBundleV2,
  type CalibrationPreflightIssueV2,
  type FrozenDimensionModelConfigsV2,
} from "./bundle-v2.js";
import type { CalibrationModelRef } from "./types.js";

export interface CalibrationV2DimensionReplayResult {
  dimension: ScoringV2PublicDimension;
  score: number | null;
  confidence: number;
  availabilityState: string;
  inputFingerprint: string;
  algorithmVersion: string;
  modelConfigFingerprint: string | null;
  /** Fact/manifest identity shared across active and draft sides. */
  evidenceFingerprint: string | null;
}

export interface CalibrationV2MemberReplayResult {
  memberId: string;
  expectedLabel: string;
  dimensions: CalibrationV2DimensionReplayResult[];
  errors: string[];
}

export interface CalibrationV2ReplayReport {
  schemaVersion: "calibration-replay-v2";
  bundleHash: string;
  deterministicSeed: number;
  mode: string;
  activeModelKey: string | null;
  evaluationModelKey: string | null;
  members: CalibrationV2MemberReplayResult[];
  preflightIssues: CalibrationPreflightIssueV2[];
  contentHash: string;
  providerCalls: 0;
  refreshCalls: 0;
  modelActivated: false;
  publicationMutated: false;
}

export interface CalibrationV2ActiveVersusDraftDimensionDelta {
  dimension: ScoringV2PublicDimension;
  activeScore: number | null;
  draftScore: number | null;
  scoreDelta: number | null;
  activeConfidence: number | null;
  draftConfidence: number | null;
  confidenceDelta: number | null;
  activeAvailability: string | null;
  draftAvailability: string | null;
  availabilityChanged: boolean;
  activeConfigFingerprint: string | null;
  draftConfigFingerprint: string | null;
  evidenceFingerprintActive: string | null;
  evidenceFingerprintDraft: string | null;
  identicalEvidence: boolean;
}

export interface CalibrationV2ActiveVersusDraftMemberResult {
  memberId: string;
  expectedLabel: string;
  overallActive: number | null;
  overallDraft: number | null;
  overallDelta: number | null;
  dimensions: CalibrationV2ActiveVersusDraftDimensionDelta[];
  errors: string[];
}

export interface CalibrationV2ActiveVersusDraftReport {
  schemaVersion: "calibration-active-draft-v2";
  bundleHash: string;
  deterministicSeed: number;
  activeModelKey: string;
  activeModelVersion: number;
  draftModelKey: string;
  draftModelVersion: number;
  activeConfigFingerprints: FrozenDimensionModelConfigsV2["fingerprints"];
  draftConfigFingerprints: FrozenDimensionModelConfigsV2["fingerprints"];
  algorithmVersions: FrozenDimensionModelConfigsV2["algorithmVersions"];
  members: CalibrationV2ActiveVersusDraftMemberResult[];
  meanOverallDelta: number | null;
  contentHash: string;
  providerCalls: 0;
  refreshCalls: 0;
  modelActivated: false;
  publicationMutated: false;
  identicalEvidence: true;
  sourceModelsImmutable: true;
}

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function deepFreezeProbe<T>(value: T): T {
  return structuredClone(value);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function overallFromDims(dims: CalibrationV2DimensionReplayResult[]): number | null {
  return mean(dims.map((d) => d.score).filter((s): s is number => s != null));
}

/**
 * Enforce DRAFT-only evaluation model creation semantics.
 * Replay never activates. ACTIVE references are allowed only as immutable activeModel.
 */
export function assertDraftOnlyCreation(
  model: CalibrationModelRef | null,
  field: "activeModel" | "evaluationModel",
): void {
  if (!model) return;

  if (field === "activeModel") {
    if (model.status === "DRAFT" && model.isActive) {
      throw new Error(
        "DRAFT_MODEL_CREATION_FORBIDDEN: activeModel cannot be DRAFT with isActive=true",
      );
    }
    return;
  }

  if (model.status === "ACTIVE" || model.isActive) {
    throw new Error(
      `DRAFT_MODEL_CREATION_FORBIDDEN: evaluationModel must be DRAFT (got status=${model.status} isActive=${model.isActive})`,
    );
  }
  if (model.status !== "DRAFT" && model.status !== "FIXTURE") {
    throw new Error(
      `DRAFT_MODEL_CREATION_FORBIDDEN: evaluationModel must be DRAFT or FIXTURE (got status=${model.status})`,
    );
  }
}

function evidenceFingerprintFromExport(
  dim: ScoringV2PublicDimension,
  doc:
    | PerformanceV2CalibrationExport
    | SurvivalV2CalibrationExport
    | UtilityV2CalibrationExport
    | ExperienceV3CalibrationExport,
): string | null {
  try {
    if (dim === "PERFORMANCE") {
      const input = (doc as PerformanceV2CalibrationExport).input;
      return createHash("sha256")
        .update(
          stableStringify({
            manifestContentHash: input.manifest.contentHash,
            runParseFacts: input.runParseFacts,
            profile: input.profileAggregate,
          }),
        )
        .digest("hex");
    }
    if (dim === "SURVIVAL") {
      const input = (doc as SurvivalV2CalibrationExport).input;
      return createHash("sha256")
        .update(
          stableStringify({
            manifestContentHash: input.manifest.contentHash,
            factSets: input.factSets.map((f) => ({
              dungeonSlug: f.dungeonSlug,
              slotIndex: f.slotIndex,
              identity: f.identity,
              extractorVersion: f.extractorVersion,
            })),
          }),
        )
        .digest("hex");
    }
    if (dim === "UTILITY") {
      const input = (doc as UtilityV2CalibrationExport).input;
      return createHash("sha256")
        .update(
          stableStringify({
            manifestContentHash: input.manifest.contentHash,
            factSets: input.factSets.map((f) => ({
              slotId: f.slotId,
              reportCode: f.reportCode,
              fightId: f.fightId,
              reportRevision: f.reportRevision,
            })),
          }),
        )
        .digest("hex");
    }
    const input = (doc as ExperienceV3CalibrationExport).input;
    return createHash("sha256")
      .update(
        stableStringify({
          manifestContentHash: input.manifest.contentHash,
          currentExposure: input.currentExposure,
          previousSeason: input.previousSeason,
          eliteHistory: input.eliteHistory,
          historicalRank: input.historicalRank,
        }),
      )
      .digest("hex");
  } catch {
    return null;
  }
}

function replayPerformance(
  exportDoc: PerformanceV2CalibrationExport,
  modelConfig: PerformanceV2ModelConfig,
): CalibrationV2DimensionReplayResult {
  const result = computePerformanceV2(exportDoc.input as PerformanceV2ComputeInput, {
    modelConfig,
  });
  return {
    dimension: "PERFORMANCE",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
    modelConfigFingerprint: result.modelConfigFingerprint,
    evidenceFingerprint: evidenceFingerprintFromExport("PERFORMANCE", exportDoc),
  };
}

function replaySurvival(
  exportDoc: SurvivalV2CalibrationExport,
  modelConfig: SurvivalV2ModelConfig,
): CalibrationV2DimensionReplayResult {
  const result = computeSurvivalV2(exportDoc.input as SurvivalV2ComputeInput, {
    modelConfig,
  });
  return {
    dimension: "SURVIVAL",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
    modelConfigFingerprint: result.modelConfigFingerprint,
    evidenceFingerprint: evidenceFingerprintFromExport("SURVIVAL", exportDoc),
  };
}

function replayUtility(
  exportDoc: UtilityV2CalibrationExport,
  modelConfig: UtilityV2ModelConfig,
): CalibrationV2DimensionReplayResult {
  const result = computeUtilityV2(exportDoc.input as UtilityV2ComputeInput, {
    modelConfig,
  });
  return {
    dimension: "UTILITY",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.availabilityState,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
    modelConfigFingerprint: result.modelConfigFingerprint,
    evidenceFingerprint: evidenceFingerprintFromExport("UTILITY", exportDoc),
  };
}

function replayExperience(
  exportDoc: ExperienceV3CalibrationExport,
  modelConfig: ExperienceV3ModelConfig,
): CalibrationV2DimensionReplayResult {
  const input: ExperienceV3ComputeInput = {
    ...(exportDoc.input as ExperienceV3ComputeInput),
    config: modelConfig,
  };
  const result = computeExperienceV3(input);
  return {
    dimension: "EXPERIENCE",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
    modelConfigFingerprint: result.modelConfigFingerprint,
    evidenceFingerprint: evidenceFingerprintFromExport("EXPERIENCE", exportDoc),
  };
}

function resolveSideConfigs(
  bundle: CalibrationInputBundleV2,
  side: "active" | "evaluation",
  strict: boolean,
): FrozenDimensionModelConfigsV2 {
  const frozen =
    side === "active" ? bundle.activeDimensionConfigs : bundle.evaluationDimensionConfigs;
  if (frozen) return frozen;
  const model = side === "active" ? bundle.activeModel : bundle.evaluationModel;
  return resolveFrozenDimensionConfigsForModel(
    model,
    strict ? "calibration-strict" : "phase1-default",
  );
}

/**
 * Replay a frozen V2 bundle through dimension calculators only (export replay).
 * When modelSide configs are present / resolvable, they are applied.
 */
export async function replayCalibrationBundleV2(input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
  /** Which frozen model config label to attribute (does not mutate source models). */
  modelSide?: "active" | "evaluation";
}): Promise<CalibrationV2ReplayReport> {
  const activeSnapshot = input.bundle.activeModel
    ? deepFreezeProbe(input.bundle.activeModel)
    : null;
  const evaluationSnapshot = input.bundle.evaluationModel
    ? deepFreezeProbe(input.bundle.evaluationModel)
    : null;

  assertDraftOnlyCreation(input.bundle.activeModel, "activeModel");
  assertDraftOnlyCreation(input.bundle.evaluationModel, "evaluationModel");

  const preflight = await preflightCalibrationBundleV2({
    bundle: input.bundle,
    resolver: input.resolver,
  });
  if (!preflight.ok) {
    throw new Error(
      `Calibration V2 preflight blocked: ${preflight.blocking.map((b) => b.message).join("; ")}`,
    );
  }

  const modelSide = input.modelSide ?? "evaluation";
  let sideConfigs: FrozenDimensionModelConfigsV2 | null = null;
  try {
    sideConfigs = resolveSideConfigs(input.bundle, modelSide, false);
  } catch {
    sideConfigs = null;
  }

  const members: CalibrationV2MemberReplayResult[] = [];

  for (const member of input.bundle.members.filter((m) => m.included)) {
    const dimensions: CalibrationV2DimensionReplayResult[] = [];
    const errors: string[] = [];

    for (const [dim, ref] of Object.entries(member.dimensionExports ?? {}) as Array<
      [ScoringV2PublicDimension, NonNullable<(typeof member.dimensionExports)[ScoringV2PublicDimension]>]
    >) {
      if (!ref) continue;
      const resolved = await input.resolver.resolve(ref.contentHash);
      if (!resolved) {
        errors.push(`missing_export:${dim}`);
        continue;
      }
      try {
        const doc = decodeJson(resolved.bytes) as
          | PerformanceV2CalibrationExport
          | SurvivalV2CalibrationExport
          | UtilityV2CalibrationExport
          | ExperienceV3CalibrationExport;
        if (dim === "PERFORMANCE") {
          dimensions.push(
            replayPerformance(
              doc as PerformanceV2CalibrationExport,
              sideConfigs?.configs.performance ??
                (doc as PerformanceV2CalibrationExport).modelConfig,
            ),
          );
        } else if (dim === "SURVIVAL") {
          dimensions.push(
            replaySurvival(
              doc as SurvivalV2CalibrationExport,
              sideConfigs?.configs.survival ??
                (doc as SurvivalV2CalibrationExport).modelConfig,
            ),
          );
        } else if (dim === "UTILITY") {
          dimensions.push(
            replayUtility(
              doc as UtilityV2CalibrationExport,
              sideConfigs?.configs.utility ??
                (doc as UtilityV2CalibrationExport).modelConfig,
            ),
          );
        } else if (dim === "EXPERIENCE") {
          dimensions.push(
            replayExperience(
              doc as ExperienceV3CalibrationExport,
              sideConfigs?.configs.experience ??
                (doc as ExperienceV3CalibrationExport).modelConfig,
            ),
          );
        }
      } catch (error) {
        if (error instanceof ModelConfigValidationError) {
          errors.push(`config_invalid:${dim}:${error.message}`);
        } else {
          errors.push(
            `replay_failed:${dim}:${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
    }

    members.push({
      memberId: member.memberId,
      expectedLabel: member.expectedLabel,
      dimensions,
      errors,
    });
  }

  const model =
    modelSide === "active" ? input.bundle.activeModel : input.bundle.evaluationModel;

  if (
    activeSnapshot &&
    JSON.stringify(activeSnapshot) !== JSON.stringify(input.bundle.activeModel)
  ) {
    throw new Error("SOURCE_MODEL_MUTATED: activeModel was mutated during replay");
  }
  if (
    evaluationSnapshot &&
    JSON.stringify(evaluationSnapshot) !== JSON.stringify(input.bundle.evaluationModel)
  ) {
    throw new Error("SOURCE_MODEL_MUTATED: evaluationModel was mutated during replay");
  }

  const report: CalibrationV2ReplayReport = {
    schemaVersion: "calibration-replay-v2",
    bundleHash: input.bundle.bundleHash,
    deterministicSeed: input.bundle.deterministicSeed,
    mode: input.bundle.mode ?? "draft-model-evaluate",
    activeModelKey: input.bundle.activeModel?.key ?? null,
    evaluationModelKey: input.bundle.evaluationModel?.key ?? null,
    members,
    preflightIssues: [...preflight.blocking, ...preflight.warnings, ...preflight.info],
    contentHash: "",
    providerCalls: 0,
    refreshCalls: 0,
    modelActivated: false,
    publicationMutated: false,
  };

  report.contentHash = createHash("sha256")
    .update(
      stableStringify({
        ...report,
        contentHash: undefined,
        attributedModelKey: model?.key ?? null,
        attributedModelVersion: model?.version ?? null,
      }),
    )
    .digest("hex");

  return report;
}

/**
 * Replay ACTIVE and DRAFT configs against identical frozen facts.
 * Fail closed on malformed/missing draft configs. Never activates or publishes.
 */
export async function replayCalibrationBundleV2ActiveVersusDraft(input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
}): Promise<CalibrationV2ActiveVersusDraftReport> {
  if (!input.bundle.activeModel) {
    throw new Error("ACTIVE_MODEL_REQUIRED: active-versus-draft requires activeModel");
  }
  if (!input.bundle.evaluationModel) {
    throw new Error("DRAFT_MODEL_REQUIRED: active-versus-draft requires evaluationModel");
  }

  assertDraftOnlyCreation(input.bundle.activeModel, "activeModel");
  assertDraftOnlyCreation(input.bundle.evaluationModel, "evaluationModel");

  const activeConfigs = resolveSideConfigs(input.bundle, "active", true);
  const draftConfigs = resolveSideConfigs(input.bundle, "evaluation", true);

  // Freeze resolved configs onto a local bundle clone for both replay sides.
  const bundleWithConfigs: CalibrationInputBundleV2 = {
    ...input.bundle,
    activeDimensionConfigs: activeConfigs,
    evaluationDimensionConfigs: draftConfigs,
  };

  const activeReplay = await replayCalibrationBundleV2({
    bundle: bundleWithConfigs,
    resolver: input.resolver,
    modelSide: "active",
  });
  const draftReplay = await replayCalibrationBundleV2({
    bundle: bundleWithConfigs,
    resolver: input.resolver,
    modelSide: "evaluation",
  });

  const members: CalibrationV2ActiveVersusDraftMemberResult[] = [];
  const overallDeltas: number[] = [];

  for (const draftMember of draftReplay.members) {
    const activeMember =
      activeReplay.members.find((m) => m.memberId === draftMember.memberId) ?? null;
    const dims = new Set<ScoringV2PublicDimension>([
      ...draftMember.dimensions.map((d) => d.dimension),
      ...(activeMember?.dimensions.map((d) => d.dimension) ?? []),
    ]);

    const dimensionDeltas: CalibrationV2ActiveVersusDraftDimensionDelta[] = [];
    for (const dimension of [...dims].sort()) {
      const a = activeMember?.dimensions.find((d) => d.dimension === dimension) ?? null;
      const d = draftMember.dimensions.find((d) => d.dimension === dimension) ?? null;
      const identicalEvidence =
        a?.evidenceFingerprint != null &&
        d?.evidenceFingerprint != null &&
        a.evidenceFingerprint === d.evidenceFingerprint;
      if (
        a?.evidenceFingerprint != null &&
        d?.evidenceFingerprint != null &&
        !identicalEvidence
      ) {
        throw new Error(
          `EVIDENCE_IDENTITY_MISMATCH: member=${draftMember.memberId} dim=${dimension}`,
        );
      }
      dimensionDeltas.push({
        dimension,
        activeScore: a?.score ?? null,
        draftScore: d?.score ?? null,
        scoreDelta:
          a?.score != null && d?.score != null ? d.score - a.score : null,
        activeConfidence: a?.confidence ?? null,
        draftConfidence: d?.confidence ?? null,
        confidenceDelta:
          a != null && d != null ? d.confidence - a.confidence : null,
        activeAvailability: a?.availabilityState ?? null,
        draftAvailability: d?.availabilityState ?? null,
        availabilityChanged:
          (a?.availabilityState ?? null) !== (d?.availabilityState ?? null),
        activeConfigFingerprint: a?.modelConfigFingerprint ?? null,
        draftConfigFingerprint: d?.modelConfigFingerprint ?? null,
        evidenceFingerprintActive: a?.evidenceFingerprint ?? null,
        evidenceFingerprintDraft: d?.evidenceFingerprint ?? null,
        identicalEvidence: identicalEvidence || (a == null && d == null),
      });
    }

    const overallActive = activeMember ? overallFromDims(activeMember.dimensions) : null;
    const overallDraft = overallFromDims(draftMember.dimensions);
    const overallDelta =
      overallActive != null && overallDraft != null ? overallDraft - overallActive : null;
    if (overallDelta != null) overallDeltas.push(overallDelta);

    members.push({
      memberId: draftMember.memberId,
      expectedLabel: draftMember.expectedLabel,
      overallActive,
      overallDraft,
      overallDelta,
      dimensions: dimensionDeltas,
      errors: [
        ...draftMember.errors,
        ...(activeMember?.errors ?? []),
      ],
    });
  }

  // Replay order independence: reverse-side order must not change hashes.
  const report: CalibrationV2ActiveVersusDraftReport = {
    schemaVersion: "calibration-active-draft-v2",
    bundleHash: input.bundle.bundleHash,
    deterministicSeed: input.bundle.deterministicSeed,
    activeModelKey: input.bundle.activeModel.key,
    activeModelVersion: input.bundle.activeModel.version,
    draftModelKey: input.bundle.evaluationModel.key,
    draftModelVersion: input.bundle.evaluationModel.version,
    activeConfigFingerprints: activeConfigs.fingerprints,
    draftConfigFingerprints: draftConfigs.fingerprints,
    algorithmVersions: activeConfigs.algorithmVersions,
    members: members.sort((a, b) => a.memberId.localeCompare(b.memberId)),
    meanOverallDelta: mean(overallDeltas),
    contentHash: "",
    providerCalls: 0,
    refreshCalls: 0,
    modelActivated: false,
    publicationMutated: false,
    identicalEvidence: true,
    sourceModelsImmutable: true,
  };

  report.contentHash = createHash("sha256")
    .update(stableStringify({ ...report, contentHash: undefined }))
    .digest("hex");

  return report;
}

/** In-memory artifact resolver for fixtures/tests — no providers. */
export function createMapArtifactResolverV2(
  artifacts: Map<string, Uint8Array>,
): ArtifactResolverV2 {
  return {
    async resolve(contentHash: string) {
      const bytes = artifacts.get(contentHash.toLowerCase()) ?? artifacts.get(contentHash);
      if (!bytes) return null;
      return { bytes, contentHash: contentHash.toLowerCase() };
    },
  };
}
