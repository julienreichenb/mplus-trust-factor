/**
 * Scoring V2 explainability DTOs — public (sanitized) and admin (privileged).
 *
 * Rules:
 * - Public never includes WCL report codes, raw artifacts/events, linked-account
 *   identities, hashes, fingerprints, DB IDs, or internal limitations.
 * - Admin may include report codes under RBAC; still never returns raw event pages.
 * - Additive / versioned; does not replace V1 ScoreExplanation.
 * - Public emission is fail-closed: only PUBLISHED / PROVISIONAL publication states.
 */

import { z } from "zod";

export const EXPLAINABILITY_V2_SCHEMA_VERSION = "2.0.0" as const;

export const explainabilityV2PublicationStateSchema = z.enum([
  "UNAVAILABLE",
  "SHADOW",
  "PROVISIONAL",
  "PUBLISHED",
  "STALE",
]);
export type ExplainabilityV2PublicationState = z.infer<
  typeof explainabilityV2PublicationStateSchema
>;

/** Publication states that may appear on the public profile. */
export const PUBLICLY_EMITTABLE_PUBLICATION_STATES = [
  "PUBLISHED",
  "PROVISIONAL",
] as const satisfies ReadonlyArray<ExplainabilityV2PublicationState>;

export type PubliclyEmittablePublicationState =
  (typeof PUBLICLY_EMITTABLE_PUBLICATION_STATES)[number];

export function isPubliclyEmittablePublicationState(
  state: ExplainabilityV2PublicationState,
): state is PubliclyEmittablePublicationState {
  return (PUBLICLY_EMITTABLE_PUBLICATION_STATES as readonly string[]).includes(state);
}

export const explainabilityV2DimensionKeySchema = z.enum([
  "PERFORMANCE",
  "SURVIVAL",
  "UTILITY",
  "EXPERIENCE",
]);
export type ExplainabilityV2DimensionKey = z.infer<typeof explainabilityV2DimensionKeySchema>;

export const explainabilityV2AvailabilityStateSchema = z.enum([
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
]);
export type ExplainabilityV2AvailabilityState = z.infer<
  typeof explainabilityV2AvailabilityStateSchema
>;

export const explainabilityV2LifecycleStateSchema = z.enum([
  "SHADOW",
  "DRAFT",
  "CANDIDATE",
  "PUBLISHED",
  "SUPERSEDED",
  "REJECTED_INCOMPLETE",
  "REJECTED_INCOHERENT",
]);
export type ExplainabilityV2LifecycleState = z.infer<typeof explainabilityV2LifecycleStateSchema>;

const finiteScoreSchema = z
  .number()
  .finite()
  .min(0)
  .max(100)
  .nullable();

const confidenceSchema = z.number().finite().min(0).max(1);

/** Curated public limitation codes — never raw worker strings. */
export const explainabilityV2PublicLimitationSchema = z.enum([
  "partial_coverage",
  "insufficient_evidence",
  "dimension_unavailable",
  "provisional_sample",
]);
export type ExplainabilityV2PublicLimitation = z.infer<
  typeof explainabilityV2PublicLimitationSchema
>;

/** Selected key level without report codes or DB identifiers (public-safe). */
export const explainabilityV2SelectedRunPublicSchema = z.object({
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  keyLevel: z.number().int().positive().nullable(),
  timed: z.boolean().nullable(),
  state: z.string().min(1),
  /** True when a WCL source was used; never exposes the code. */
  hasWclSource: z.boolean(),
});
export type ExplainabilityV2SelectedRunPublicDTO = z.infer<
  typeof explainabilityV2SelectedRunPublicSchema
>;

/**
 * Simple per-run cooldown usage counts (Survival / Utility).
 * Factual only — no opportunity, efficiency, or good/bad judgments.
 */
export const explainabilityV2CooldownUsagePublicSchema = z.object({
  canonicalKey: z.string().min(1),
  displayName: z.string().min(1),
  category: z.string().min(1),
  dimension: z.enum(["SURVIVAL", "UTILITY"]),
  observedSpellId: z.number().int().nullable(),
  useCount: z.number().int().nonnegative(),
  dungeonSlug: z.string().min(1),
  slotIndex: z.union([z.literal(0), z.literal(1)]),
  keyLevel: z.number().int().positive().nullable(),
  catalogVersion: z.string().nullable(),
  evidenceCoverageState: z.string().min(1),
});
export type ExplainabilityV2CooldownUsagePublicDTO = z.infer<
  typeof explainabilityV2CooldownUsagePublicSchema
>;

export const explainabilityV2CooldownUsageAdminSchema =
  explainabilityV2CooldownUsagePublicSchema.extend({
    reportCode: z.string().nullable(),
    fightId: z.number().int().nullable(),
    reportRevision: z.number().int().nullable(),
    sourceDataset: z.string().nullable(),
    extractorVersion: z.string().nullable(),
    unmappedSpellIds: z.array(z.number().int()).default([]),
    truncationWarnings: z.array(z.string()).default([]),
    coverageWarnings: z.array(z.string()).default([]),
  });
export type ExplainabilityV2CooldownUsageAdminDTO = z.infer<
  typeof explainabilityV2CooldownUsageAdminSchema
>;

/** Strip privileged fields for public projection. */
export function toPublicCooldownUsage(
  admin: ExplainabilityV2CooldownUsageAdminDTO,
): ExplainabilityV2CooldownUsagePublicDTO {
  return {
    canonicalKey: admin.canonicalKey,
    displayName: admin.displayName,
    category: admin.category,
    dimension: admin.dimension,
    observedSpellId: admin.observedSpellId,
    useCount: admin.useCount,
    dungeonSlug: admin.dungeonSlug,
    slotIndex: admin.slotIndex,
    keyLevel: admin.keyLevel,
    catalogVersion: admin.catalogVersion,
    evidenceCoverageState: admin.evidenceCoverageState,
  };
}

export const explainabilityV2ContributorPublicSchema = z.object({
  key: z.string().min(1),
  dimension: explainabilityV2DimensionKeySchema,
  label: z.string().min(1),
  score: finiteScoreSchema,
  direction: z.enum(["positive", "negative", "neutral"]),
});
export type ExplainabilityV2ContributorPublicDTO = z.infer<
  typeof explainabilityV2ContributorPublicSchema
>;

export const explainabilityV2DimensionPublicSchema = z.object({
  dimension: explainabilityV2DimensionKeySchema,
  score: finiteScoreSchema,
  confidence: confidenceSchema,
  availabilityState: explainabilityV2AvailabilityStateSchema,
  /** Grade U means unavailable/unranked — never a low score. */
  gradeU: z.boolean(),
  algorithmVersion: z.string().min(1),
  topContributors: z.array(explainabilityV2ContributorPublicSchema).max(5),
  limitations: z.array(explainabilityV2PublicLimitationSchema).max(12),
  /**
   * Utility only: explicit OBSERVED_CONTRIBUTION semantics.
   * Absent for other dimensions.
   */
  utilitySemantics: z
    .object({
      mode: z.literal("OBSERVED_CONTRIBUTION"),
      notes: z.array(z.string().min(1)).max(8),
    })
    .optional(),
});
export type ExplainabilityV2DimensionPublicDTO = z.infer<
  typeof explainabilityV2DimensionPublicSchema
>;

export const explainabilityV2CoveragePublicSchema = z.object({
  analyzedRunCount: z.number().int().nonnegative(),
  expectedRunCount: z.number().int().nonnegative(),
  representedDungeonCount: z.number().int().nonnegative(),
  expectedDungeonCount: z.number().int().positive(),
  coverageState: z.string().min(1),
  publicationState: z.enum(["PROVISIONAL", "PUBLISHED"]),
  provisional: z.boolean(),
  stale: z.boolean(),
  unavailable: z.boolean(),
});
export type ExplainabilityV2CoveragePublicDTO = z.infer<
  typeof explainabilityV2CoveragePublicSchema
>;

/**
 * Public profile explainability block (additive on CharacterProfileResponse).
 * Null/absent when no publishable V2 evidence exists.
 * Strict — rejects unexpected internal fields.
 */
export const scoreExplainabilityV2PublicSchema = z
  .object({
    schemaVersion: z.literal(EXPLAINABILITY_V2_SCHEMA_VERSION),
    modelKey: z.string().min(1).nullable(),
    modelVersion: z.number().int().positive().nullable(),
    /** Algorithm / model data-as-of (ISO). */
    dataAsOf: z.string().datetime().nullable(),
    evidenceCutoffAt: z.string().datetime().nullable(),
    coverage: explainabilityV2CoveragePublicSchema,
    selectedRuns: z.array(explainabilityV2SelectedRunPublicSchema),
    /** Factual Survival/Utility cooldown use counts — no opportunity judgments. */
    cooldownUsages: z.array(explainabilityV2CooldownUsagePublicSchema).default([]),
    dimensions: z.array(explainabilityV2DimensionPublicSchema),
    /** Concise English notes for UI copy. */
    notes: z.array(z.string().min(1)),
    /**
     * Explicit: grade U means unavailable/unranked, not a poor performance.
     */
    gradeUMeans: z.literal("unavailable_or_unranked"),
  })
  .strict();
export type ScoreExplainabilityV2PublicDTO = z.infer<typeof scoreExplainabilityV2PublicSchema>;

/** Admin-only selected slot with report identity. */
export interface ExplainabilityV2SelectedRunAdminDTO
  extends ExplainabilityV2SelectedRunPublicDTO {
  slotId: string;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  /** Selection outcome label — never a rejected-candidate reason for SELECTED slots. */
  selectionReason: string | null;
  candidateRank: number | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

export interface ExplainabilityV2RejectedCandidateAdminDTO {
  reportCode: string;
  fightId: number;
  reportRevision: number | null;
  dungeonSlug: string | null;
  reason: string;
  /** Bounded, sanitized detail — never tokens or raw payloads. */
  detail: string | null;
}

export interface ExplainabilityV2DatasetAdminDTO {
  datasetKey: string;
  state: string;
  pageCount: number;
  eventCount: number;
  truncated: boolean;
  pointsConsumed: number | null;
  costSource: string | null;
  schemaVersion: string;
  fetchedAt: string | null;
}

export interface ExplainabilityV2FactSetAdminDTO {
  id: string;
  extractorFamily: string;
  extractorVersion: string;
  schemaVersion: string;
  inputFingerprint: string;
  computedAt: string;
  /** Coverage / limitations only — never raw event arrays. */
  coverage: unknown;
  limitations: unknown;
  /** Bounded fact keys present (names only). */
  factKeys: string[];
}

export interface ExplainabilityV2DimensionAdminDTO {
  dimension: ExplainabilityV2DimensionKey;
  score: number | null;
  confidence: number;
  lifecycleState: string;
  availabilityState: ExplainabilityV2AvailabilityState;
  algorithmVersion: string;
  inputFingerprint: string;
  computedAt: string;
  /** Bounded metrics document — no raw artifacts. */
  metrics: Record<string, unknown>;
  /** Bounded explanation — report codes allowed for admin. */
  explanation: Record<string, unknown>;
}

export interface ExplainabilityV2ManifestMatrixCellDTO {
  dungeonSlug: string;
  slotIndex: 0 | 1;
  state: string;
  keyLevel: number | null;
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  candidateRank: number | null;
  /** Selection outcome label — never DUPLICATE_REPORT_FIGHT for a selected run. */
  selectionReason: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

export interface ExplainabilityV2BatchQueueAdminDTO {
  batchId: string;
  finalizationStatus: string;
  expectedRunCount: number;
  terminalRunCount: number;
  successfulRunCount: number;
  unavailableRunCount: number;
  failedRunCount: number;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  evidenceManifestId: string | null;
}

export interface ExplainabilityV2ComparisonAdminDTO {
  v1: {
    overallScore: number | null;
    grade: string | null;
    confidence: number | null;
    modelKey: string | null;
    modelVersion: number | null;
    dimensions: Array<{
      dimension: string;
      score: number | null;
      confidence: number | null;
      state: string | null;
    }>;
  } | null;
  v2: {
    publicationState: ExplainabilityV2PublicationState;
    dimensions: Array<{
      dimension: ExplainabilityV2DimensionKey;
      score: number | null;
      confidence: number;
      availabilityState: ExplainabilityV2AvailabilityState;
      lifecycleState: string;
    }>;
  } | null;
}

export interface ScoreExplainabilityV2AdminDTO {
  schemaVersion: typeof EXPLAINABILITY_V2_SCHEMA_VERSION;
  characterId: string;
  seasonId: string;
  seasonSlug: string;
  modelKey: string | null;
  modelVersion: number | null;
  dataAsOf: string | null;
  evidenceCutoffAt: string | null;
  manifestId: string;
  manifestContentHash: string;
  coverageState: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  /** 2×dungeon matrix (admin includes report codes). */
  matrix: ExplainabilityV2ManifestMatrixCellDTO[];
  selectedRuns: ExplainabilityV2SelectedRunAdminDTO[];
  rejectedCandidates: ExplainabilityV2RejectedCandidateAdminDTO[];
  datasets: ExplainabilityV2DatasetAdminDTO[];
  factSets: ExplainabilityV2FactSetAdminDTO[];
  dimensions: ExplainabilityV2DimensionAdminDTO[];
  batchQueue: ExplainabilityV2BatchQueueAdminDTO | null;
  comparison: ExplainabilityV2ComparisonAdminDTO;
  /** Relative admin UI paths (no secrets). */
  calibrationLinks: Array<{ label: string; href: string }>;
  /**
   * Sanitized public projection for admin preview.
   * Null when publication state is not publicly emittable (SHADOW / UNAVAILABLE / …).
   */
  publicView: ScoreExplainabilityV2PublicDTO | null;
}

export interface ExplainabilityV2ManifestListItemDTO {
  manifestId: string;
  characterId: string;
  seasonId: string;
  seasonSlug: string | null;
  coverageState: string;
  contentHash: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  frozenAt: string;
  createdAt: string;
}

export interface ExplainabilityV2ManifestListDTO {
  items: ExplainabilityV2ManifestListItemDTO[];
  nextCursor: string | null;
  limit: number;
}

/** Minimal public builder input — no raw facts / artifacts / fingerprints. */
export interface BuildExplainabilityV2PublicInput {
  modelKey: string | null;
  modelVersion: number | null;
  dataAsOf: string | null;
  evidenceCutoffAt: string | null;
  coverageState: string;
  expectedSlotCount: number;
  selectedSlotCount: number;
  /** Lifecycle states from DimensionComputation.state — publication eligibility. */
  lifecycleStates: string[];
  selectedRuns: Array<{
    dungeonSlug: string;
    slotIndex: 0 | 1;
    keyLevel: number | null;
    timed: boolean | null;
    state: string;
    hasWclSource: boolean;
  }>;
  dimensions: Array<{
    dimension: ExplainabilityV2DimensionKey;
    score: number | null;
    confidence: number;
    availabilityState: ExplainabilityV2AvailabilityState;
    algorithmVersion: string;
    topContributors?: Array<{
      key: string;
      label?: string;
      score?: number | null;
      direction?: "positive" | "negative" | "neutral";
    }>;
    /** Raw internal limitation codes — mapped to curated public vocabulary. */
    internalLimitationHints?: string[];
    utilityNotes?: string[];
  }>;
}

const REPORT_CODE_KEY = /reportcode/i;
const SENSITIVE_KEY =
  /reportcode|accesstoken|refreshtoken|authorization|battletag|linkedcharacter|raw(event|payload|artifact)|unlisted|manifestcontenthash|inputfingerprint|scoremodelid|manifestid/i;

const FORBIDDEN_PUBLIC_SUBSTRINGS = [
  "manifestContentHash",
  "manifestId",
  "scoreModelId",
  "inputFingerprint",
  "artifact",
  "reportCode",
  "fightId",
  "reportRevision",
  "rawEvents",
  "rawFacts",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Redact sensitive keys recursively; bounds array depth for admin/public safety. */
export function sanitizeExplainabilityJson(
  value: unknown,
  options: { stripReportCodes: boolean; maxDepth?: number } = { stripReportCodes: true },
): unknown {
  const maxDepth = options.maxDepth ?? 8;
  return sanitizeWalk(value, options.stripReportCodes, maxDepth, 0);
}

function sanitizeWalk(
  value: unknown,
  stripReportCodes: boolean,
  maxDepth: number,
  depth: number,
): unknown {
  if (depth > maxDepth) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (stripReportCodes && looksLikeReportCode(value)) return "[redacted]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeWalk(item, stripReportCodes, maxDepth, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key.replace(/[_-]/g, ""))) {
      if (stripReportCodes || REPORT_CODE_KEY.test(key.replace(/[_-]/g, ""))) {
        out[key] = null;
        continue;
      }
      if (!REPORT_CODE_KEY.test(key.replace(/[_-]/g, ""))) {
        out[key] = "[redacted]";
        continue;
      }
    }
    out[key] = sanitizeWalk(child, stripReportCodes, maxDepth, depth + 1);
  }
  return out;
}

/** Heuristic: WCL report codes are typically 12–20 alphanumerics with letters and digits. */
export function looksLikeReportCode(value: string): boolean {
  return /^[a-zA-Z0-9]{12,20}$/.test(value) && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

/** Assert a public DTO never embeds forbidden internal / sensitive fields. */
export function assertPublicExplainabilitySanitized(dto: ScoreExplainabilityV2PublicDTO): void {
  scoreExplainabilityV2PublicSchema.parse(dto);
  const json = JSON.stringify(dto);
  for (const needle of FORBIDDEN_PUBLIC_SUBSTRINGS) {
    if (json.includes(needle)) {
      throw new Error(`public explainability DTO must not include ${needle}`);
    }
  }
  if (/"reportCode"\s*:/.test(json)) {
    throw new Error("public explainability DTO must not include reportCode fields");
  }
  // UUID-looking slot identifiers must not appear as dedicated id fields.
  if (/"slotId"\s*:/.test(json)) {
    throw new Error("public explainability DTO must not include slotId");
  }
}

/** @deprecated Prefer assertPublicExplainabilitySanitized */
export function assertNoPublicReportCodes(dto: ScoreExplainabilityV2PublicDTO): void {
  assertPublicExplainabilitySanitized(dto);
}

export function toPublicSelectedRun(
  run: ExplainabilityV2SelectedRunAdminDTO,
): ExplainabilityV2SelectedRunPublicDTO {
  return {
    dungeonSlug: run.dungeonSlug,
    slotIndex: run.slotIndex,
    keyLevel: run.keyLevel,
    timed: run.timed,
    state: run.state,
    hasWclSource: run.hasWclSource,
  };
}

/**
 * Derive publication state from lifecycle + coverage.
 * Availability alone never upgrades a non-public lifecycle to public.
 */
export function derivePublicationState(input: {
  coverageState: string;
  dimensions: ExplainabilityV2AvailabilityState[];
  lifecycleStates: string[];
}): ExplainabilityV2PublicationState {
  if (input.lifecycleStates.length === 0) return "UNAVAILABLE";
  if (input.lifecycleStates.some((s) => s === "SHADOW")) return "SHADOW";
  if (
    input.lifecycleStates.some(
      (s) =>
        s === "DRAFT" ||
        s === "CANDIDATE" ||
        s === "SUPERSEDED" ||
        s === "REJECTED_INCOMPLETE" ||
        s === "REJECTED_INCOHERENT",
    )
  ) {
    return "UNAVAILABLE";
  }
  if (!input.lifecycleStates.every((s) => s === "PUBLISHED")) {
    return "UNAVAILABLE";
  }
  // Lifecycle is publishable (all PUBLISHED). Coverage decides public quality.
  if (input.coverageState === "INSUFFICIENT") return "UNAVAILABLE";
  if (input.coverageState === "PARTIAL") return "PROVISIONAL";
  if (input.coverageState === "FULL" || input.coverageState === "STRONG") return "PUBLISHED";
  // Unknown coverage with published lifecycle — fail closed.
  return "UNAVAILABLE";
}

/** Map internal limitation hints to curated public vocabulary. */
export function mapPublicLimitations(
  hints: string[] | undefined,
  availability: ExplainabilityV2AvailabilityState,
  publicationState: ExplainabilityV2PublicationState,
): ExplainabilityV2PublicLimitation[] {
  const out = new Set<ExplainabilityV2PublicLimitation>();
  if (availability === "UNAVAILABLE") out.add("dimension_unavailable");
  if (availability === "PARTIAL") out.add("partial_coverage");
  if (publicationState === "PROVISIONAL") out.add("provisional_sample");
  if (publicationState === "UNAVAILABLE") out.add("insufficient_evidence");
  for (const hint of hints ?? []) {
    const h = hint.toLowerCase();
    if (h.includes("partial") || h.includes("missing_slot")) out.add("partial_coverage");
    if (h.includes("insufficient") || h.includes("unavailable")) out.add("insufficient_evidence");
    if (h.includes("provisional")) out.add("provisional_sample");
  }
  return [...out].sort();
}

/**
 * Stable public contributor ordering:
 * 1. |score - 50| descending when score present (magnitude from neutral);
 * 2. absolute score descending when present;
 * 3. key ascending.
 */
export function sortPublicContributors(
  contributors: ExplainabilityV2ContributorPublicDTO[],
): ExplainabilityV2ContributorPublicDTO[] {
  return [...contributors].sort((a, b) => {
    const magA = a.score == null ? -1 : Math.abs(a.score - 50);
    const magB = b.score == null ? -1 : Math.abs(b.score - 50);
    if (magA !== magB) return magB - magA;
    const scoreA = a.score ?? -1;
    const scoreB = b.score ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.key.localeCompare(b.key);
  });
}

export function buildExplainabilityV2Public(
  input: BuildExplainabilityV2PublicInput,
): ScoreExplainabilityV2PublicDTO | null {
  const availabilityStates = input.dimensions.map((d) => d.availabilityState);
  const publicationState = derivePublicationState({
    coverageState: input.coverageState,
    dimensions: availabilityStates,
    lifecycleStates: input.lifecycleStates,
  });
  if (!isPubliclyEmittablePublicationState(publicationState)) {
    return null;
  }

  const represented = new Set(
    input.selectedRuns
      .filter((r) => r.keyLevel != null || r.hasWclSource)
      .map((r) => r.dungeonSlug),
  );
  const expectedDungeons = Math.max(1, Math.ceil(input.expectedSlotCount / 2));

  const dimensions: ExplainabilityV2DimensionPublicDTO[] = input.dimensions.map((d) => {
    const gradeU =
      d.availabilityState === "UNAVAILABLE" || d.score == null || d.confidence <= 0;
    const score =
      gradeU || d.score == null || !Number.isFinite(d.score)
        ? null
        : Math.min(100, Math.max(0, d.score));
    const confidence = Number.isFinite(d.confidence)
      ? Math.min(1, Math.max(0, d.confidence))
      : 0;

    const contributors = sortPublicContributors(
      (d.topContributors ?? [])
        .filter((c) => typeof c.key === "string" && c.key.length > 0)
        .map((c) => ({
          key: c.key,
          dimension: d.dimension,
          label: c.label?.trim() || humanizeKey(c.key),
          score:
            c.score == null || !Number.isFinite(c.score)
              ? null
              : Math.min(100, Math.max(0, c.score)),
          direction:
            c.direction === "positive" || c.direction === "negative" || c.direction === "neutral"
              ? c.direction
              : c.score == null
                ? "neutral"
                : c.score >= 50
                  ? "positive"
                  : "negative",
        })),
    ).slice(0, 5);

    const base: ExplainabilityV2DimensionPublicDTO = {
      dimension: d.dimension,
      score,
      confidence,
      availabilityState: d.availabilityState,
      gradeU,
      algorithmVersion: d.algorithmVersion,
      topContributors: contributors,
      limitations: mapPublicLimitations(
        d.internalLimitationHints,
        d.availabilityState,
        publicationState,
      ),
    };
    if (d.dimension === "UTILITY") {
      base.utilitySemantics = {
        mode: "OBSERVED_CONTRIBUTION",
        notes: (d.utilityNotes ?? []).slice(0, 8).filter((n) => n.trim().length > 0),
      };
      if (base.utilitySemantics.notes.length === 0) {
        base.utilitySemantics.notes = [
          "Utility reflects observed combat contribution (interrupts, support, strategic CC), not parse percentiles. Missing actions are not scored as zero.",
        ];
      }
    }
    return base;
  });

  const publicDto: ScoreExplainabilityV2PublicDTO = {
    schemaVersion: EXPLAINABILITY_V2_SCHEMA_VERSION,
    modelKey: input.modelKey,
    modelVersion: input.modelVersion,
    dataAsOf: input.dataAsOf,
    evidenceCutoffAt: input.evidenceCutoffAt,
    coverage: {
      analyzedRunCount: input.selectedSlotCount,
      expectedRunCount: input.expectedSlotCount,
      representedDungeonCount: represented.size,
      expectedDungeonCount: expectedDungeons,
      coverageState: input.coverageState,
      publicationState,
      provisional: publicationState === "PROVISIONAL",
      stale: false,
      unavailable: false,
    },
    selectedRuns: input.selectedRuns.map((run) => ({
      dungeonSlug: run.dungeonSlug,
      slotIndex: run.slotIndex,
      keyLevel: run.keyLevel,
      timed: run.timed,
      state: run.state,
      hasWclSource: run.hasWclSource,
    })),
    cooldownUsages: [],
    dimensions,
    notes: buildPublicNotes(publicationState, input.coverageState),
    gradeUMeans: "unavailable_or_unranked",
  };

  return scoreExplainabilityV2PublicSchema.parse(publicDto);
}

/**
 * Build public projection from an admin DTO (admin preview / tests).
 * Returns null when not publicly emittable — never bypasses the gate.
 */
export function buildPublicFromAdmin(
  admin: Omit<ScoreExplainabilityV2AdminDTO, "publicView">,
): ScoreExplainabilityV2PublicDTO | null {
  return buildExplainabilityV2Public({
    modelKey: admin.modelKey,
    modelVersion: admin.modelVersion,
    dataAsOf: admin.dataAsOf,
    evidenceCutoffAt: admin.evidenceCutoffAt,
    coverageState: admin.coverageState,
    expectedSlotCount: admin.expectedSlotCount,
    selectedSlotCount: admin.selectedSlotCount,
    lifecycleStates: admin.dimensions.map((d) => d.lifecycleState),
    selectedRuns: admin.selectedRuns.map(toPublicSelectedRun),
    dimensions: admin.dimensions.map((d) => {
      const explanation = isRecord(d.explanation) ? d.explanation : {};
      const metrics = d.metrics;
      const topContributors = extractContributorSeeds(d.dimension, explanation, metrics);
      const internalLimitationHints = Array.isArray(metrics.limitations)
        ? metrics.limitations.filter((x): x is string => typeof x === "string")
        : [];
      const utilityNotes = Array.isArray(explanation.notes)
        ? explanation.notes.filter((x): x is string => typeof x === "string")
        : undefined;
      return {
        dimension: d.dimension,
        score: d.score,
        confidence: d.confidence,
        availabilityState: d.availabilityState,
        algorithmVersion: d.algorithmVersion,
        topContributors,
        internalLimitationHints,
        utilityNotes,
      };
    }),
  });
}

function extractContributorSeeds(
  dimension: ExplainabilityV2DimensionKey,
  explanation: Record<string, unknown>,
  metrics: Record<string, unknown>,
): Array<{
  key: string;
  label?: string;
  score?: number | null;
  direction?: "positive" | "negative" | "neutral";
}> {
  const fromExplanation = Array.isArray(explanation.topContributors)
    ? explanation.topContributors
    : Array.isArray(metrics.topContributors)
      ? metrics.topContributors
      : [];

  const mapped: Array<{
    key: string;
    label?: string;
    score?: number | null;
    direction?: "positive" | "negative" | "neutral";
  }> = [];

  for (const raw of fromExplanation) {
    if (!isRecord(raw)) continue;
    const key =
      typeof raw.key === "string" ? raw.key : typeof raw.metricKey === "string" ? raw.metricKey : null;
    if (!key || REPORT_CODE_KEY.test(key.replace(/[_-]/g, ""))) continue;
    mapped.push({
      key,
      label: typeof raw.label === "string" ? raw.label : undefined,
      score:
        typeof raw.score === "number"
          ? raw.score
          : typeof raw.value === "number"
            ? raw.value
            : null,
      direction:
        raw.direction === "positive" || raw.direction === "negative" || raw.direction === "neutral"
          ? raw.direction
          : undefined,
    });
  }

  if (mapped.length > 0) return mapped;

  if (dimension === "UTILITY" && Array.isArray(metrics.domainBreakdowns)) {
    for (const raw of metrics.domainBreakdowns) {
      if (!isRecord(raw)) continue;
      const key = typeof raw.domain === "string" ? raw.domain : null;
      if (!key) continue;
      mapped.push({
        key: `utility.${key}`,
        label: humanizeKey(key),
        score: typeof raw.score === "number" ? raw.score : null,
      });
    }
  }
  return mapped;
}

function humanizeKey(key: string): string {
  return key.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
}

function buildPublicNotes(
  publicationState: PubliclyEmittablePublicationState,
  coverageState: string,
): string[] {
  const notes: string[] = [];
  if (publicationState === "PROVISIONAL") {
    notes.push("Coverage is partial — this score is provisional.");
  }
  if (coverageState === "FULL" || coverageState === "STRONG") {
    notes.push("Selected runs follow the immutable 2×dungeon evidence manifest.");
  }
  notes.push("Grade U means unavailable or unranked, not a low score.");
  notes.push(
    "Utility uses observed combat contribution semantics when present, not parse percentiles.",
  );
  return notes;
}

export function parseScoreExplainabilityV2Public(value: unknown): ScoreExplainabilityV2PublicDTO {
  return scoreExplainabilityV2PublicSchema.parse(value);
}

export function safeParseScoreExplainabilityV2Public(value: unknown) {
  return scoreExplainabilityV2PublicSchema.safeParse(value);
}
