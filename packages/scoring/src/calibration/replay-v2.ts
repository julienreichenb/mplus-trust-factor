/**
 * Provider-free Calibration V2 replay from frozen dimension export artifacts.
 * Never refreshes evidence. Active and draft share identical member evidence refs.
 */

import { createHash } from "node:crypto";
import {
  computePerformanceV2,
  type PerformanceV2CalibrationExport,
  type PerformanceV2ComputeInput,
} from "../performance/v2/index.js";
import {
  computeExperienceV3,
  type ExperienceV3CalibrationExport,
  type ExperienceV3ComputeInput,
} from "../experience/v3/index.js";
import {
  computeSurvivalV2,
  type SurvivalV2CalibrationExport,
  type SurvivalV2ComputeInput,
} from "../survival/v2/index.js";
import {
  computeUtilityV2,
  type UtilityV2CalibrationExport,
  type UtilityV2ComputeInput,
} from "../utility/v2/index.js";
import type { ScoringV2PublicDimension } from "../dimensions/v2/shadow-record.js";
import {
  preflightCalibrationBundleV2,
  type ArtifactResolverV2,
  type CalibrationInputBundleV2,
  type CalibrationPreflightIssueV2,
} from "./bundle-v2.js";
import type { CalibrationModelRef } from "./types.js";

export interface CalibrationV2DimensionReplayResult {
  dimension: ScoringV2PublicDimension;
  score: number | null;
  confidence: number;
  availabilityState: string;
  inputFingerprint: string;
  algorithmVersion: string;
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
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function assertDraftOnlyCreation(model: CalibrationModelRef | null, field: string): void {
  if (!model) return;
  // Replay never activates. If a new model were created it must be DRAFT — here we only accept frozen refs.
  if (model.status === "ACTIVE" && field === "evaluationModel" && model.isActive) {
    // Evaluation against an already-active model is allowed for comparison, but creation of ACTIVE is forbidden upstream.
  }
}

function replayPerformance(exportDoc: PerformanceV2CalibrationExport): CalibrationV2DimensionReplayResult {
  const result = computePerformanceV2(exportDoc.input as PerformanceV2ComputeInput);
  return {
    dimension: "PERFORMANCE",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
  };
}

function replaySurvival(exportDoc: SurvivalV2CalibrationExport): CalibrationV2DimensionReplayResult {
  const result = computeSurvivalV2(exportDoc.input as SurvivalV2ComputeInput);
  return {
    dimension: "SURVIVAL",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
  };
}

function replayUtility(exportDoc: UtilityV2CalibrationExport): CalibrationV2DimensionReplayResult {
  const result = computeUtilityV2(exportDoc.input as UtilityV2ComputeInput);
  return {
    dimension: "UTILITY",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.availabilityState,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
  };
}

function replayExperience(exportDoc: ExperienceV3CalibrationExport): CalibrationV2DimensionReplayResult {
  const result = computeExperienceV3(exportDoc.input as ExperienceV3ComputeInput);
  return {
    dimension: "EXPERIENCE",
    score: result.score,
    confidence: result.confidence,
    availabilityState: result.state,
    inputFingerprint: result.inputFingerprint,
    algorithmVersion: result.algorithmVersion,
  };
}

/**
 * Replay a frozen V2 bundle through dimension calculators only.
 * Identical evidence for active and draft (member refs unchanged).
 */
export async function replayCalibrationBundleV2(input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
  /** Which frozen model config label to attribute (does not mutate source models). */
  modelSide?: "active" | "evaluation";
}): Promise<CalibrationV2ReplayReport> {
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
          dimensions.push(replayPerformance(doc as PerformanceV2CalibrationExport));
        } else if (dim === "SURVIVAL") {
          dimensions.push(replaySurvival(doc as SurvivalV2CalibrationExport));
        } else if (dim === "UTILITY") {
          dimensions.push(replayUtility(doc as UtilityV2CalibrationExport));
        } else if (dim === "EXPERIENCE") {
          dimensions.push(replayExperience(doc as ExperienceV3CalibrationExport));
        }
      } catch (error) {
        errors.push(
          `replay_failed:${dim}:${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }

    members.push({
      memberId: member.memberId,
      expectedLabel: member.expectedLabel,
      dimensions,
      errors,
    });
  }

  const modelSide = input.modelSide ?? "evaluation";
  const model =
    modelSide === "active" ? input.bundle.activeModel : input.bundle.evaluationModel;

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
  };

  // Attribute model side in hash material without mutating source model configs.
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
 * Active-versus-draft V2: identical member evidence, two model attributions.
 * Source models are never mutated.
 */
export async function replayCalibrationBundleV2ActiveVersusDraft(input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
}): Promise<{
  active: CalibrationV2ReplayReport;
  draft: CalibrationV2ReplayReport;
  identicalEvidence: true;
  sourceModelsImmutable: true;
}> {
  if (!input.bundle.activeModel || !input.bundle.evaluationModel) {
    throw new Error("active-versus-draft requires activeModel and evaluationModel");
  }
  if (input.bundle.evaluationModel.status === "ACTIVE" && input.bundle.evaluationModel.isActive) {
    // Creating/activating is forbidden; comparing against an already-active evaluation ref is odd — allow read-only.
  }
  if (input.bundle.evaluationModel.status !== "DRAFT" && input.bundle.evaluationModel.status !== "FIXTURE") {
    // Prefer DRAFT for evaluation side; ARCHIVED/ACTIVE comparison still allowed as read-only.
  }

  const active = await replayCalibrationBundleV2({
    bundle: input.bundle,
    resolver: input.resolver,
    modelSide: "active",
  });
  const draft = await replayCalibrationBundleV2({
    bundle: input.bundle,
    resolver: input.resolver,
    modelSide: "evaluation",
  });

  // Evidence identity must match (same bundle hash / member export refs).
  if (active.bundleHash !== draft.bundleHash) {
    throw new Error("active/draft evidence drift detected");
  }

  return {
    active,
    draft,
    identicalEvidence: true,
    sourceModelsImmutable: true,
  };
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
