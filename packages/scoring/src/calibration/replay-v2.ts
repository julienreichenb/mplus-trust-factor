/**
 * Provider-free Calibration V2 replay from frozen dimension export artifacts.
 * Never refreshes evidence. Does not activate score models.
 *
 * Architectural note (WS10 remediation):
 * V2 dimension calculators (Performance/Survival/Utility) hard-code package-local
 * MODEL_CONFIG constants and do not accept ScoreModelConfigV1 from
 * CalibrationModelRef.config. Experience V3 accepts ExperienceV3ModelConfig only.
 * Therefore active-versus-draft model-side evaluation cannot be implemented without
 * a calculator API change — see assertActiveVersusDraftSupported().
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

/** Stable error code for the active/draft architectural stop. */
export const CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER =
  "CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER" as const;

export class CalibrationV2ActiveDraftArchitectureError extends Error {
  readonly code = CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER;
  readonly smallestApiChange: string;
  readonly unusableModelConfigFields: string[];

  constructor() {
    super(
      [
        CALIBRATION_V2_ACTIVE_DRAFT_ARCH_BLOCKER,
        "V2 dimension calculators cannot consume CalibrationModelRef.config (ScoreModelConfigV1)",
        "without a calculator input API change; refusing to fabricate active/draft score deltas",
      ].join(": "),
    );
    this.name = "CalibrationV2ActiveDraftArchitectureError";
    this.smallestApiChange =
      "Add optional frozen side-specific modelConfig on computePerformanceV2 / computeSurvivalV2 / computeUtilityV2 inputs (and wire ScoreModelConfigV1→dimension config mapping or store dimension MODEL_CONFIG documents on the bundle), without changing formulas.";
    this.unusableModelConfigFields = [
      "ScoreModelConfigV1.weights",
      "ScoreModelConfigV1.metricWeights",
      "ScoreModelConfigV1.normalization",
      "ScoreModelConfigV1.historicalDecay",
      "ScoreModelConfigV1.confidenceBlend",
      "ScoreModelConfigV1.authenticityFeatures",
      "PERFORMANCE_V2_MODEL_CONFIG (hard-coded in computePerformanceV2)",
      "SURVIVAL_V2_MODEL_CONFIG (hard-coded in computeSurvivalV2)",
      "UTILITY_V2_* coefficient constants (hard-coded in computeUtilityV2)",
      "ExperienceV3ModelConfig (accepted only via ExperienceV3ComputeInput.config — not ScoreModelConfigV1)",
    ];
  }
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

function deepFreezeProbe<T>(value: T): T {
  // Structural clone for mutation detection — does not mutate the source.
  return structuredClone(value);
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
    // Active side is a frozen reference — must not be a DRAFT marked active.
    if (model.status === "DRAFT" && model.isActive) {
      throw new Error(
        "DRAFT_MODEL_CREATION_FORBIDDEN: activeModel cannot be DRAFT with isActive=true",
      );
    }
    return;
  }

  // evaluationModel is the only side that may represent a newly created revision.
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

/**
 * Fail closed: active-versus-draft model evaluation is not supported until
 * dimension calculators accept frozen model configuration.
 */
export function assertActiveVersusDraftSupported(): never {
  throw new CalibrationV2ActiveDraftArchitectureError();
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
 * Replay a frozen V2 bundle through dimension calculators only (export replay).
 * Does not apply ScoreModelConfigV1 — see assertActiveVersusDraftSupported.
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

  // Prove source model configs were not mutated by replay.
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
 * Active-versus-draft requires applying each side's frozen model configuration to
 * identical evidence. V2 dimension calculators cannot accept ScoreModelConfigV1 today.
 * This function fails closed — it does not fabricate attribution-only deltas.
 */
export async function replayCalibrationBundleV2ActiveVersusDraft(_input: {
  bundle: CalibrationInputBundleV2;
  resolver: ArtifactResolverV2;
}): Promise<never> {
  assertActiveVersusDraftSupported();
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
