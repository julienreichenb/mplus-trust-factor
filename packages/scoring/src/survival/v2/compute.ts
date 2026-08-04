import { createHash } from "node:crypto";
import type { CharacterSeasonEvidenceManifestV2 } from "@mplus/contracts";
import { buildSurvivalFeatureUsage } from "../../audit/feature-usage.js";
import {
  SURVIVAL_V2_ALGORITHM_VERSION,
  SURVIVAL_V2_MODEL_CONFIG,
  type SurvivalV2ModelConfig,
  type SurvivalV2RelativeDamageMode,
} from "./constants.js";
import {
  aggregateSurvivalV2Dungeon,
  aggregateSurvivalV2Season,
  computeSurvivalV2Confidence,
  meanOf,
  tallyHealthModes,
} from "./aggregate.js";
import { survivalFactSlotKey } from "./facts.js";
import {
  fingerprintSurvivalV2ModelConfig,
  resolveSurvivalV2ModelConfig,
} from "./model-config.js";
import { isSurvivalV2RelativeDamageWeightActive } from "./relative-damage.js";
import { scoreSurvivalV2Run } from "./run-score.js";
import type {
  SurvivalFactDocumentV2,
  SurvivalV2AvailabilityState,
  SurvivalV2ComputeInput,
  SurvivalV2ComputeResult,
  SurvivalV2ContributorDiagnostic,
  SurvivalV2RunScore,
  SurvivalV2ShadowDimensionPayload,
} from "./types.js";

export interface SurvivalV2ComputeOptions {
  modelConfig?: SurvivalV2ModelConfig | unknown;
}

function resolveAvailability(input: {
  score: number | null;
  dungeonCount: number;
  expectedDungeonCount: number;
  scoredRunCount: number;
  expectedSlotCount: number;
  healthModes: Record<string, number>;
}): SurvivalV2AvailabilityState {
  if (input.score == null) return "UNAVAILABLE";
  const fullOnly =
    (input.healthModes["FULL"] ?? 0) === input.scoredRunCount &&
    input.scoredRunCount > 0;
  if (
    input.dungeonCount < input.expectedDungeonCount ||
    input.scoredRunCount < input.expectedSlotCount ||
    !fullOnly
  ) {
    return "PARTIAL";
  }
  return "AVAILABLE";
}

function buildContributors(input: {
  components: SurvivalV2ComputeResult["components"];
  relativeDamageMode: SurvivalV2RelativeDamageMode;
  weightsMode: string;
  config: SurvivalV2ModelConfig;
}): SurvivalV2ContributorDiagnostic[] {
  const keys = input.config.metricKeys;
  return [
    {
      metricKey: keys.outcome,
      score: input.components.outcome,
      weight: null,
      state: input.components.outcome == null ? "NOT_APPLICABLE" : "SCORED",
      detail: {},
    },
    {
      metricKey: keys.defensive,
      score: input.components.defensive,
      weight: null,
      state: input.components.defensive == null ? "NOT_APPLICABLE" : "SCORED",
      detail: {},
    },
    {
      metricKey: keys.recovery,
      score: input.components.recovery,
      weight: null,
      state: input.components.recovery == null ? "NOT_APPLICABLE" : "SCORED",
      detail: {},
    },
    {
      metricKey: keys.relativeDamage,
      score: input.components.relativeDamage,
      weight: null,
      state:
        input.relativeDamageMode === "active"
          ? input.components.relativeDamage == null
            ? "NOT_APPLICABLE"
            : "SCORED"
          : "SHADOW_DIAGNOSTIC",
      detail: { mode: input.relativeDamageMode, weightsMode: input.weightsMode },
    },
  ];
}

/**
 * Provider-free Survival V2 Phase 1 computation.
 * Uses only frozen EvidenceManifestV2 slots + normalized Survival fact documents.
 * Does not perform Survival-specific run selection.
 */
export function computeSurvivalV2(
  input: SurvivalV2ComputeInput,
  options?: SurvivalV2ComputeOptions,
): SurvivalV2ComputeResult {
  const config = resolveSurvivalV2ModelConfig(options?.modelConfig);
  const modelConfigFingerprint = fingerprintSurvivalV2ModelConfig(config);
  const mode: SurvivalV2RelativeDamageMode = input.relativeDamageMode ?? "shadow";
  const manifest = input.manifest;

  const factBySlot = new Map<string, SurvivalFactDocumentV2>();
  for (const fact of input.factSets) {
    factBySlot.set(survivalFactSlotKey(fact.dungeonSlug, fact.slotIndex), fact);
  }

  const runScores: SurvivalV2RunScore[] = [];
  const notes: string[] = [
    "Survival is not a percentile; raw damage volume does not score.",
    "Uses shared EvidenceManifestV2 slots only — no Survival-specific run selection.",
  ];
  if (mode !== "active") {
    notes.push(
      `Relative avoidable damage mode=${mode}; public contribution is zero (weights 55/30/15).`,
    );
  }

  // Iterate manifest slots only — never invent or re-select runs.
  for (const slot of manifest.slots) {
    if (slot.state !== "SELECTED") {
      continue;
    }
    if (!slot.identity) continue;

    const key = survivalFactSlotKey(slot.dungeonSlug, slot.slotIndex);
    const fact = factBySlot.get(key);
    if (!fact) {
      notes.push(`missing_fact_set:${key}`);
      continue;
    }

    // Identity must match frozen manifest slot.
    if (
      fact.identity.reportCode !== slot.identity.reportCode ||
      fact.identity.fightId !== slot.identity.fightId ||
      fact.identity.reportRevision !== slot.identity.reportRevision
    ) {
      notes.push(`fact_identity_mismatch:${key}`);
      continue;
    }

    runScores.push(scoreSurvivalV2Run(fact, mode, config));
  }

  const byDungeon = new Map<string, SurvivalV2RunScore[]>();
  for (const run of runScores) {
    const bucket = byDungeon.get(run.dungeonSlug) ?? [];
    bucket.push(run);
    byDungeon.set(run.dungeonSlug, bucket);
  }

  const dungeons = [...byDungeon.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, runs]) => aggregateSurvivalV2Dungeon(slug, runs));

  const withScores = dungeons.filter((d) => d.medianBehavioralScore != null);
  const score = aggregateSurvivalV2Season(withScores);

  const components = {
    outcome: meanOf(withScores.map((d) => d.medianOutcome)),
    defensive: meanOf(withScores.map((d) => d.medianDefensive)),
    recovery: meanOf(withScores.map((d) => d.medianRecovery)),
    relativeDamage: null as number | null,
  };

  // Relative damage never contributes to public observations unless weight-active.
  if (mode === "active") {
    const relativeScores = runScores
      .filter((r) =>
        isSurvivalV2RelativeDamageWeightActive(mode, r.relativeDamageShadow),
      )
      .map((r) => r.relativeDamageShadow.score!);
    components.relativeDamage =
      relativeScores.length > 0
        ? relativeScores.reduce((s, v) => s + v, 0) / relativeScores.length
        : null;
  }

  const scoredRuns = runScores.filter((r) => r.valid);
  const healthModes = tallyHealthModes(scoredRuns);
  const catalogCoverageMean =
    scoredRuns.length === 0
      ? 0
      : scoredRuns.reduce((s, r) => {
          const cov =
            typeof r.defensive.evidence.catalogCoverage === "number"
              ? r.defensive.evidence.catalogCoverage
              : 0;
          return s + cov;
        }, 0) / scoredRuns.length;

  const relativeUnreliableCount = scoredRuns.filter(
    (r) =>
      r.relativeDamageShadow.reliability === "UNRELIABLE" ||
      r.relativeDamageShadow.reliability === "INSUFFICIENT",
  ).length;

  const confidence = computeSurvivalV2Confidence({
    dungeonCount: withScores.length,
    expectedDungeonCount: manifest.activeDungeonSlugs.length,
    scoredRunCount: scoredRuns.length,
    expectedSlotCount: manifest.expectedSlotCount,
    healthModes,
    catalogCoverageMean,
    relativeUnreliableCount,
  });

  const allLimitations = [
    ...new Set(runScores.flatMap((r) => r.limitations)),
  ].sort();

  const state = resolveAvailability({
    score,
    dungeonCount: withScores.length,
    expectedDungeonCount: manifest.activeDungeonSlugs.length,
    scoredRunCount: scoredRuns.length,
    expectedSlotCount: manifest.expectedSlotCount,
    healthModes,
  });

  const weightsMode = mode === "active" ? "50/25/15/10" : "55/30/15";
  const contributors = buildContributors({
    components,
    relativeDamageMode: mode,
    weightsMode,
    config,
  });

  const inputFingerprint = buildSurvivalV2InputFingerprint({
    manifest,
    factSets: input.factSets,
    relativeDamageMode: mode,
    scoreModelId: input.scoreModelId ?? null,
    modelConfig: config,
  });

  const { featureUsage } = buildSurvivalFeatureUsage(input.factSets, {
    relativeDamageMode: mode,
  });

  const metrics: Record<string, unknown> = {
    algorithmVersion: config.algorithmVersion,
    modelLabel: config.modelLabel,
    calibrationStatus: config.calibrationStatus,
    modelConfigFingerprint,
    availabilityState: state,
    relativeDamageMode: mode,
    weightsMode,
    dungeonCount: withScores.length,
    scoredRunCount: scoredRuns.length,
    expectedSlotCount: manifest.expectedSlotCount,
    selectedSlotCount: manifest.selectedSlotCount,
    manifestContentHash: manifest.contentHash,
    publicationBlocked: true,
    featureUsage,
  };

  return {
    algorithmVersion: config.algorithmVersion,
    modelLabel: config.modelLabel,
    calibrationStatus: config.calibrationStatus,
    modelConfigFingerprint,
    inputFingerprint,
    score,
    confidence,
    state,
    dungeons,
    components,
    observations: {
      "survival.outcome": components.outcome,
      "survival.defensive_response": components.defensive,
      "survival.emergency_recovery": components.recovery,
      "survival.relative_avoidable_damage":
        mode === "active" ? components.relativeDamage : null,
    },
    relativeDamageMode: mode,
    relativeDamagePublicContribution:
      mode === "active" ? components.relativeDamage : null,
    explanation: {
      selectedSlotCount: manifest.selectedSlotCount,
      expectedSlotCount: manifest.expectedSlotCount,
      scoredRunCount: scoredRuns.length,
      pressureClusterCount: scoredRuns.reduce((s, r) => s + r.pressureClusterCount, 0),
      deathCount: scoredRuns.reduce((s, r) => s + r.deathCount, 0),
      healthModes,
      notes,
      limitations: allLimitations,
      contributors,
      perDungeon: dungeons.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        medianBehavioralScore: d.medianBehavioralScore,
        runCount: d.runCount,
        slotIndexes: d.runs.map((r) => r.slotIndex).sort((a, b) => a - b),
      })),
    },
    metrics,
  };
}

export function buildSurvivalV2InputFingerprint(input: {
  manifest: CharacterSeasonEvidenceManifestV2;
  factSets: SurvivalFactDocumentV2[];
  relativeDamageMode: SurvivalV2RelativeDamageMode;
  scoreModelId: string | null;
  modelConfig?: SurvivalV2ModelConfig;
}): string {
  const config = input.modelConfig ?? SURVIVAL_V2_MODEL_CONFIG;
  const configFingerprint = fingerprintSurvivalV2ModelConfig(config);
  const usingDefault =
    configFingerprint === fingerprintSurvivalV2ModelConfig(SURVIVAL_V2_MODEL_CONFIG);

  const material = usingDefault
    ? {
        algorithmVersion: SURVIVAL_V2_ALGORITHM_VERSION,
        manifestContentHash: input.manifest.contentHash,
        relativeDamageMode: input.relativeDamageMode,
        scoreModelId: input.scoreModelId,
        facts: [...input.factSets]
          .map((f) => ({
            key: survivalFactSlotKey(f.dungeonSlug, f.slotIndex),
            extractorVersion: f.extractorVersion,
            identity: f.identity,
            deaths: f.deaths.count,
            activeCombatMs: f.activeCombat.durationMs,
            windows: f.dangerWindows.length,
            healthMode: f.healthEvidence.mode,
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      }
    : {
        algorithmVersion: config.algorithmVersion,
        modelConfigFingerprint: configFingerprint,
        manifestContentHash: input.manifest.contentHash,
        relativeDamageMode: input.relativeDamageMode,
        scoreModelId: input.scoreModelId,
        facts: [...input.factSets]
          .map((f) => ({
            key: survivalFactSlotKey(f.dungeonSlug, f.slotIndex),
            extractorVersion: f.extractorVersion,
            identity: f.identity,
            deaths: f.deaths.count,
            activeCombatMs: f.activeCombat.durationMs,
            windows: f.dangerWindows.length,
            healthMode: f.healthEvidence.mode,
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}

/**
 * Shadow DimensionComputation payload builder (persistence wiring is worker-owned).
 * Lifecycle state is SHADOW; availability lives under metrics.availabilityState.
 */
export function toSurvivalV2ShadowDimensionPayload(input: {
  characterId: string;
  seasonId: string;
  manifestId: string;
  scoreModelId: string;
  result: SurvivalV2ComputeResult;
  computedAt: Date;
}): SurvivalV2ShadowDimensionPayload {
  return {
    characterId: input.characterId,
    seasonId: input.seasonId,
    manifestId: input.manifestId,
    scoreModelId: input.scoreModelId,
    dimension: "SURVIVAL",
    algorithmVersion: input.result.algorithmVersion,
    inputFingerprint: input.result.inputFingerprint,
    score: input.result.score,
    confidence: input.result.confidence,
    state: "SHADOW",
    metrics: {
      ...input.result.metrics,
      availabilityState: input.result.state,
      publicationBlocked: true,
    },
    explanation: input.result.explanation,
    computedAt: input.computedAt,
  };
}
