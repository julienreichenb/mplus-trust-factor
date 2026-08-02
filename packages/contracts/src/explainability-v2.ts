/**
 * Scoring V2 explainability DTOs — public (sanitized) and admin (privileged).
 *
 * Rules:
 * - Public never includes WCL report codes, raw artifacts/events, linked-account
 *   identities, or sensitive provider errors.
 * - Admin may include report codes under RBAC; still never returns raw event pages.
 * - Additive / versioned; does not replace V1 ScoreExplanation.
 */

export const EXPLAINABILITY_V2_SCHEMA_VERSION = "2.0.0" as const;

export type ExplainabilityV2PublicationState =
  | "UNAVAILABLE"
  | "SHADOW"
  | "PROVISIONAL"
  | "PUBLISHED"
  | "STALE";

export type ExplainabilityV2DimensionKey =
  | "PERFORMANCE"
  | "SURVIVAL"
  | "UTILITY"
  | "EXPERIENCE";

export type ExplainabilityV2AvailabilityState =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE";

/** Selected key level without report codes (public-safe). */
export interface ExplainabilityV2SelectedRunPublicDTO {
  slotId: string;
  dungeonSlug: string;
  slotIndex: 0 | 1;
  keyLevel: number | null;
  timed: boolean | null;
  state: string;
  /** True when a WCL source was used; never exposes the code. */
  hasWclSource: boolean;
}

export interface ExplainabilityV2ContributorPublicDTO {
  key: string;
  dimension: ExplainabilityV2DimensionKey;
  label: string;
  score: number | null;
  direction: "positive" | "negative" | "neutral";
}

export interface ExplainabilityV2DimensionPublicDTO {
  dimension: ExplainabilityV2DimensionKey;
  score: number | null;
  confidence: number;
  availabilityState: ExplainabilityV2AvailabilityState;
  /** Grade U means unavailable/unranked — never a low score. */
  gradeU: boolean;
  algorithmVersion: string;
  topContributors: ExplainabilityV2ContributorPublicDTO[];
  limitations: string[];
  /**
   * Utility only: explicit OBSERVED_CONTRIBUTION semantics.
   * Absent for other dimensions.
   */
  utilitySemantics?: {
    mode: "OBSERVED_CONTRIBUTION";
    notes: string[];
  };
}

export interface ExplainabilityV2CoveragePublicDTO {
  analyzedRunCount: number;
  expectedRunCount: number;
  representedDungeonCount: number;
  expectedDungeonCount: number;
  coverageState: string;
  publicationState: ExplainabilityV2PublicationState;
  provisional: boolean;
  stale: boolean;
  unavailable: boolean;
}

/**
 * Public profile explainability block (additive on CharacterProfileResponse).
 * Null/absent when no publishable V2 evidence exists.
 */
export interface ScoreExplainabilityV2PublicDTO {
  schemaVersion: typeof EXPLAINABILITY_V2_SCHEMA_VERSION;
  modelKey: string | null;
  modelVersion: number | null;
  /** Algorithm / model data-as-of (ISO). */
  dataAsOf: string | null;
  evidenceCutoffAt: string | null;
  manifestContentHash: string | null;
  coverage: ExplainabilityV2CoveragePublicDTO;
  selectedRuns: ExplainabilityV2SelectedRunPublicDTO[];
  dimensions: ExplainabilityV2DimensionPublicDTO[];
  /** Concise English notes for UI copy. */
  notes: string[];
  /**
   * Explicit: grade U means unavailable/unranked, not a poor performance.
   */
  gradeUMeans: "unavailable_or_unranked";
}

/** Admin-only selected slot with report identity. */
export interface ExplainabilityV2SelectedRunAdminDTO
  extends ExplainabilityV2SelectedRunPublicDTO {
  reportCode: string | null;
  fightId: number | null;
  reportRevision: number | null;
  selectionReason: string | null;
  candidateRank: number | null;
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
  selectionReason: string | null;
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
  publicView: ScoreExplainabilityV2PublicDTO;
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

const REPORT_CODE_KEY = /reportcode/i;
const SENSITIVE_KEY =
  /reportcode|accesstoken|refreshtoken|authorization|battletag|linkedcharacter|raw(event|payload|artifact)|unlisted/i;

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
      // Admin: still strip tokens / raw payloads / linked identities.
      if (!REPORT_CODE_KEY.test(key.replace(/[_-]/g, ""))) {
        out[key] = "[redacted]";
        continue;
      }
    }
    out[key] = sanitizeWalk(child, stripReportCodes, maxDepth, depth + 1);
  }
  return out;
}

/** Heuristic: WCL report codes are typically 16 alphanumerics. */
export function looksLikeReportCode(value: string): boolean {
  return /^[a-zA-Z0-9]{12,20}$/.test(value) && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

/** Assert a public DTO never embeds report codes (test helper + runtime guard). */
export function assertNoPublicReportCodes(dto: ScoreExplainabilityV2PublicDTO): void {
  const json = JSON.stringify(dto);
  if (/"reportCode"\s*:/.test(json)) {
    throw new Error("public explainability DTO must not include reportCode fields");
  }
}

export function toPublicSelectedRun(
  run: ExplainabilityV2SelectedRunAdminDTO,
): ExplainabilityV2SelectedRunPublicDTO {
  return {
    slotId: run.slotId,
    dungeonSlug: run.dungeonSlug,
    slotIndex: run.slotIndex,
    keyLevel: run.keyLevel,
    timed: run.timed,
    state: run.state,
    hasWclSource: run.hasWclSource,
  };
}

export function buildPublicFromAdmin(
  admin: Omit<ScoreExplainabilityV2AdminDTO, "publicView">,
): ScoreExplainabilityV2PublicDTO {
  const availabilityByDim = new Map(
    admin.dimensions.map((d) => [d.dimension, d.availabilityState] as const),
  );
  const publicationState = derivePublicationState({
    coverageState: admin.coverageState,
    dimensions: admin.dimensions.map((d) => d.availabilityState),
    lifecycleStates: admin.dimensions.map((d) => d.lifecycleState),
  });

  const represented = new Set(
    admin.selectedRuns.filter((r) => r.keyLevel != null || r.hasWclSource).map((r) => r.dungeonSlug),
  );
  const expectedDungeons = Math.max(1, Math.ceil(admin.expectedSlotCount / 2));

  const publicDto: ScoreExplainabilityV2PublicDTO = {
    schemaVersion: EXPLAINABILITY_V2_SCHEMA_VERSION,
    modelKey: admin.modelKey,
    modelVersion: admin.modelVersion,
    dataAsOf: admin.dataAsOf,
    evidenceCutoffAt: admin.evidenceCutoffAt,
    manifestContentHash: admin.manifestContentHash,
    coverage: {
      analyzedRunCount: admin.selectedSlotCount,
      expectedRunCount: admin.expectedSlotCount,
      representedDungeonCount: represented.size,
      expectedDungeonCount: expectedDungeons,
      coverageState: admin.coverageState,
      publicationState,
      provisional: publicationState === "PROVISIONAL",
      stale: publicationState === "STALE",
      unavailable: publicationState === "UNAVAILABLE" || publicationState === "SHADOW",
    },
    selectedRuns: admin.selectedRuns.map(toPublicSelectedRun),
    dimensions: admin.dimensions.map((d) => {
      const explanation = isRecord(d.explanation) ? d.explanation : {};
      const topContributors = extractPublicContributors(d.dimension, explanation, d.metrics);
      const limitations = Array.isArray(d.metrics.limitations)
        ? d.metrics.limitations.filter((x): x is string => typeof x === "string").slice(0, 12)
        : [];
      const gradeU =
        d.availabilityState === "UNAVAILABLE" ||
        d.score == null ||
        d.confidence <= 0;
      const base: ExplainabilityV2DimensionPublicDTO = {
        dimension: d.dimension,
        score: gradeU ? null : d.score,
        confidence: d.confidence,
        availabilityState: availabilityByDim.get(d.dimension) ?? d.availabilityState,
        gradeU,
        algorithmVersion: d.algorithmVersion,
        topContributors,
        limitations,
      };
      if (d.dimension === "UTILITY") {
        const mode = typeof explanation.mode === "string" ? explanation.mode : "OBSERVED_CONTRIBUTION";
        const notes = Array.isArray(explanation.notes)
          ? explanation.notes.filter((x): x is string => typeof x === "string").slice(0, 8)
          : [
              "Utility reflects observed combat contribution (interrupts, support, strategic CC), not parse percentiles.",
            ];
        base.utilitySemantics = {
          mode: mode === "OBSERVED_CONTRIBUTION" ? "OBSERVED_CONTRIBUTION" : "OBSERVED_CONTRIBUTION",
          notes,
        };
      }
      return base;
    }),
    notes: buildPublicNotes(publicationState, admin.coverageState),
    gradeUMeans: "unavailable_or_unranked",
  };

  // Final sanitization pass — strip any leaked report codes from nested explanation-derived fields.
  return sanitizeExplainabilityJson(publicDto, {
    stripReportCodes: true,
  }) as ScoreExplainabilityV2PublicDTO;
}

export function derivePublicationState(input: {
  coverageState: string;
  dimensions: ExplainabilityV2AvailabilityState[];
  lifecycleStates: string[];
}): ExplainabilityV2PublicationState {
  if (input.lifecycleStates.some((s) => s === "SHADOW")) return "SHADOW";
  if (input.lifecycleStates.every((s) => s === "PUBLISHED")) {
    if (input.coverageState === "PARTIAL") return "PROVISIONAL";
    if (input.coverageState === "INSUFFICIENT") return "UNAVAILABLE";
    return "PUBLISHED";
  }
  if (input.dimensions.every((d) => d === "UNAVAILABLE")) return "UNAVAILABLE";
  if (input.coverageState === "PARTIAL") return "PROVISIONAL";
  if (input.coverageState === "INSUFFICIENT") return "UNAVAILABLE";
  return "UNAVAILABLE";
}

function extractPublicContributors(
  dimension: ExplainabilityV2DimensionKey,
  explanation: Record<string, unknown>,
  metrics: Record<string, unknown>,
): ExplainabilityV2ContributorPublicDTO[] {
  const fromExplanation = Array.isArray(explanation.topContributors)
    ? explanation.topContributors
    : Array.isArray(metrics.topContributors)
      ? metrics.topContributors
      : [];

  const mapped: ExplainabilityV2ContributorPublicDTO[] = [];
  for (const raw of fromExplanation.slice(0, 5)) {
    if (!isRecord(raw)) continue;
    const key = typeof raw.key === "string" ? raw.key : typeof raw.metricKey === "string" ? raw.metricKey : null;
    if (!key || REPORT_CODE_KEY.test(key.replace(/[_-]/g, ""))) continue;
    const score =
      typeof raw.score === "number"
        ? raw.score
        : typeof raw.value === "number"
          ? raw.value
          : null;
    const direction =
      raw.direction === "positive" || raw.direction === "negative" || raw.direction === "neutral"
        ? raw.direction
        : score == null
          ? "neutral"
          : score >= 50
            ? "positive"
            : "negative";
    mapped.push({
      key,
      dimension,
      label: typeof raw.label === "string" ? raw.label : humanizeKey(key),
      score,
      direction,
    });
  }

  if (mapped.length > 0) return mapped;

  // Utility domain breakdown fallback (no report codes).
  if (dimension === "UTILITY" && Array.isArray(metrics.domainBreakdowns)) {
    for (const raw of metrics.domainBreakdowns.slice(0, 3)) {
      if (!isRecord(raw)) continue;
      const key = typeof raw.domain === "string" ? raw.domain : null;
      if (!key) continue;
      const score = typeof raw.score === "number" ? raw.score : null;
      mapped.push({
        key: `utility.${key}`,
        dimension,
        label: humanizeKey(key),
        score,
        direction: score == null ? "neutral" : score >= 50 ? "positive" : "negative",
      });
    }
  }
  return mapped;
}

function humanizeKey(key: string): string {
  return key.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
}

function buildPublicNotes(
  publicationState: ExplainabilityV2PublicationState,
  coverageState: string,
): string[] {
  const notes: string[] = [];
  if (publicationState === "SHADOW") {
    notes.push("Scoring V2 evidence is shadow-only and is not the public Trust Score.");
  }
  if (publicationState === "PROVISIONAL") {
    notes.push("Coverage is partial — this score is provisional.");
  }
  if (publicationState === "UNAVAILABLE") {
    notes.push("Scoring V2 evidence is unavailable or insufficient for publication.");
  }
  if (publicationState === "STALE") {
    notes.push("Displayed evidence may be stale relative to the latest provider data.");
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
