/**
 * Score Explainability V1 — canonical deterministic explainability over current
 * authoritative P/S/U/E scoring (not Scoring V2 / EvidenceManifest explainers).
 *
 * Rules:
 * - Score drivers and confidence reasons are independent lists.
 * - Public projection never includes privileged evidence (report codes, fight ids,
 *   tokens, DB ids, raw artifacts).
 * - Labels are registry-driven and deterministic.
 */

import { z } from "zod";

export const SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION =
  "score-explainability-v1" as const;

export const SCORE_EXPLAINABILITY_LABEL_CATALOG_VERSION =
  "score-explainability-labels-v1" as const;

export const SCORE_EXPLAINABILITY_MATERIALITY_POLICY_VERSION =
  "score-explainability-materiality-v1" as const;

export const scoreExplainabilityDimensionKeySchema = z.enum([
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
]);
export type ScoreExplainabilityDimensionKey = z.infer<
  typeof scoreExplainabilityDimensionKeySchema
>;

export const scoreExplainabilityAvailabilitySchema = z.enum([
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
]);
export type ScoreExplainabilityAvailability = z.infer<
  typeof scoreExplainabilityAvailabilitySchema
>;

export const scoreDriverDirectionSchema = z.enum([
  "POSITIVE",
  "NEGATIVE",
  "NEUTRAL",
]);
export type ScoreDriverDirection = z.infer<typeof scoreDriverDirectionSchema>;

const boundedParamValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const scoreDriverV1Schema = z.object({
  code: z.string().min(1),
  labelKey: z.string().min(1),
  label: z.string().min(1),
  direction: scoreDriverDirectionSchema,
  value: z.number().finite().nullable(),
  normalizedValue: z.number().finite().nullable(),
  weight: z.number().finite().nullable(),
  contribution: z.number().finite().nullable(),
  materiality: z.number().finite().nullable(),
  params: z.record(boundedParamValueSchema),
  evidence: z.record(z.unknown()),
});
export type ScoreDriverV1 = z.infer<typeof scoreDriverV1Schema>;

export const confidenceReasonV1Schema = z.object({
  code: z.string().min(1),
  labelKey: z.string().min(1),
  label: z.string().min(1),
  params: z.record(boundedParamValueSchema),
  evidence: z.record(z.unknown()),
});
export type ConfidenceReasonV1 = z.infer<typeof confidenceReasonV1Schema>;

export const confidenceComponentV1Schema = z.object({
  key: z.string().min(1),
  value: z.number().finite(),
  labelKey: z.string().min(1),
  label: z.string().min(1),
});
export type ConfidenceComponentV1 = z.infer<typeof confidenceComponentV1Schema>;

export const dimensionExplainabilityV1Schema = z.object({
  dimension: scoreExplainabilityDimensionKeySchema,
  score: z.number().finite().nullable(),
  availability: scoreExplainabilityAvailabilitySchema,
  scoreStory: z.object({
    drivers: z.array(scoreDriverV1Schema),
  }),
  confidenceStory: z.object({
    value: z.number().finite().nullable(),
    band: z.string().nullable(),
    reasons: z.array(confidenceReasonV1Schema),
    components: z.array(confidenceComponentV1Schema),
  }),
});
export type DimensionExplainabilityV1 = z.infer<
  typeof dimensionExplainabilityV1Schema
>;

export const compositeExplainabilityV1Schema = z.object({
  score: z.number().finite().nullable(),
  confidence: z.number().finite(),
  grade: z.string().min(1),
  availableDimensions: z.array(z.string()),
  unavailableDimensions: z.array(z.string()),
  effectiveWeights: z.record(z.number().finite()),
  availabilityCoverage: z.number().finite(),
  confidenceFormulaVersion: z.string().optional(),
});
export type CompositeExplainabilityV1 = z.infer<
  typeof compositeExplainabilityV1Schema
>;

export const scoreExplainabilityV1Schema = z.object({
  schemaVersion: z.literal(SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION),
  labelCatalogVersion: z.string().min(1),
  materialityPolicyVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  dimensions: z.object({
    PERFORMANCE: dimensionExplainabilityV1Schema,
    SURVIVAL: dimensionExplainabilityV1Schema,
    UTILITY: dimensionExplainabilityV1Schema,
    EXPERIENCE: dimensionExplainabilityV1Schema,
  }),
  composite: compositeExplainabilityV1Schema,
});
export type ScoreExplainabilityV1 = z.infer<typeof scoreExplainabilityV1Schema>;

/** Product-facing dimension explainability (sanitized / materiality-filtered). */
export const publicDimensionExplainabilityV1Schema = z.object({
  scoreDrivers: z.array(
    z.object({
      code: z.string().min(1),
      labelKey: z.string().min(1),
      label: z.string().min(1),
      direction: scoreDriverDirectionSchema,
      value: z.number().finite().nullable().optional(),
    }),
  ),
  confidenceReasons: z.array(
    z.object({
      code: z.string().min(1),
      labelKey: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
});
export type PublicDimensionExplainabilityV1 = z.infer<
  typeof publicDimensionExplainabilityV1Schema
>;

export const publicScoreExplainabilityV1Schema = z.object({
  schemaVersion: z.literal(SCORE_EXPLAINABILITY_V1_SCHEMA_VERSION),
  labelCatalogVersion: z.string().min(1),
  fingerprint: z.string().min(1),
  dimensions: z.object({
    PERFORMANCE: publicDimensionExplainabilityV1Schema,
    SURVIVAL: publicDimensionExplainabilityV1Schema,
    UTILITY: publicDimensionExplainabilityV1Schema,
    EXPERIENCE: publicDimensionExplainabilityV1Schema,
  }),
  composite: compositeExplainabilityV1Schema.pick({
    score: true,
    confidence: true,
    grade: true,
    availableDimensions: true,
    unavailableDimensions: true,
    availabilityCoverage: true,
  }),
});
export type PublicScoreExplainabilityV1 = z.infer<
  typeof publicScoreExplainabilityV1Schema
>;
