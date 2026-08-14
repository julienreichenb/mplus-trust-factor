import type {
  DimensionScoreDTO,
  PublicDimensionExplainabilityV1,
  ScoreDriverDirection,
} from "@mplus/contracts";
import type {
  CharacterProfileView,
  Grade,
  RedFlagDTO,
} from "../api/types";
import { DIMENSION_LABELS, resolveRadarDimensions, type RadarDimension } from "./format";

export type TrustGrade = Grade;

export interface GradePresentation {
  letter: TrustGrade | null;
  title: string;
  interpretation: string;
  isUnrated: boolean;
}

/** Score-driver / confidence-signal kinds for product UI. */
export type ContributorSignalKind = "positive" | "risk" | "fact" | "confidence";

export interface ContributorSignal {
  kind: ContributorSignalKind;
  label: string;
  /** Human-readable dimension name (e.g. Survival). */
  dimension?: string;
  /** Stable dimension key for icons / filters. */
  dimensionKey?: RadarDimension;
  /** Stable machine code when from Score Explainability V1. */
  code?: string;
}

/** Per-dimension product explainability view (score story vs confidence story). */
export interface DimensionExplainabilityView {
  hasExplainability: boolean;
  strengths: ContributorSignal[];
  weaknesses: ContributorSignal[];
  facts: ContributorSignal[];
  confidenceReasons: ContributorSignal[];
  /** True when confidence is full and pipeline supplied no reasons. */
  fullConfidence: boolean;
  /** Soft message when legacy row has no V1 explainability. */
  legacyFallbackMessage: string | null;
}

export const EXPLAINABILITY_UNAVAILABLE_MESSAGE =
  "Detailed score explanation is not available for this calculation.";

/** @deprecated Prefer EquipmentItemViewModel from equipmentViewModel. */
export interface EquipmentSlotView {
  id: string;
  label: string;
  name: string | null;
  itemLevel: number | null;
  filled: boolean;
}

const GRADE_INTERPRETATION: Record<Exclude<Grade, "U">, string> = {
  S: "Elite trust profile",
  A: "Strong trust profile",
  B: "Credible trust profile",
  C: "Situational trust profile",
  D: "Weak trust profile",
};

export function presentGrade(grade: Grade | null | undefined): GradePresentation {
  if (!grade) {
    return {
      letter: null,
      title: "Grade unavailable",
      interpretation: "No trust grade is available for this snapshot.",
      isUnrated: false,
    };
  }
  if (grade === "U") {
    return {
      letter: "U",
      title: "Unrated",
      interpretation: "Insufficient evidence to present a reliable letter grade.",
      isUnrated: true,
    };
  }
  return {
    letter: grade,
    title: `Tier ${grade}`,
    interpretation: GRADE_INTERPRETATION[grade],
    isUnrated: false,
  };
}

export function resolveDataConfidence(profile: CharacterProfileView): number | null {
  const raw =
    profile.dataConfidence != null && !Number.isNaN(profile.dataConfidence)
      ? profile.dataConfidence
      : profile.score?.confidence != null && !Number.isNaN(profile.score.confidence)
        ? profile.score.confidence
        : null;
  if (raw == null) return null;
  // API/live values are 0–1; mock fixtures may already be 0–100.
  return raw <= 1 ? raw * 100 : raw;
}

function isScoredDimension(dim: DimensionScoreDTO): boolean {
  return !(
    dim.state === "UNAVAILABLE" ||
    dim.state === "PROCESSING" ||
    dim.state === "ERROR" ||
    dim.score == null ||
    dim.confidence <= 0
  );
}

function signalFromDriver(
  dim: DimensionScoreDTO,
  kind: ContributorSignalKind,
  label: string,
  code?: string,
): ContributorSignal {
  const dimKey = dim.dimension as RadarDimension;
  return {
    kind,
    label,
    code,
    dimension: DIMENSION_LABELS[dimKey] ?? dim.dimension,
    dimensionKey: dimKey,
  };
}

function kindFromDirection(direction: ScoreDriverDirection): ContributorSignalKind {
  if (direction === "POSITIVE") return "positive";
  if (direction === "NEGATIVE") return "risk";
  return "fact";
}

/**
 * Build product explainability for one dimension from PublicDimensionExplainabilityV1.
 * POSITIVE → strength; NEGATIVE → weakness; NEUTRAL → score fact (never weakness).
 * Confidence reasons stay in a separate list.
 */
export function buildDimensionExplainabilityView(
  dim: DimensionScoreDTO,
): DimensionExplainabilityView {
  const dimKey = dim.dimension as RadarDimension;
  const dimLabel = DIMENSION_LABELS[dimKey] ?? dim.dimension;
  const empty: DimensionExplainabilityView = {
    hasExplainability: false,
    strengths: [],
    weaknesses: [],
    facts: [],
    confidenceReasons: [],
    fullConfidence: false,
    legacyFallbackMessage: null,
  };

  const expl = dim.explainability as PublicDimensionExplainabilityV1 | null | undefined;
  if (!expl) {
    return {
      ...empty,
      legacyFallbackMessage: isScoredDimension(dim) ? EXPLAINABILITY_UNAVAILABLE_MESSAGE : null,
    };
  }

  const strengths: ContributorSignal[] = [];
  const weaknesses: ContributorSignal[] = [];
  const facts: ContributorSignal[] = [];

  // UNAVAILABLE: no product strengths/weaknesses; confidence/data reasons may remain.
  if (isScoredDimension(dim)) {
    for (const driver of expl.scoreDrivers ?? []) {
      if (!driver?.label?.trim()) continue;
      const kind = kindFromDirection(driver.direction);
      const signal = signalFromDriver(dim, kind, driver.label.trim(), driver.code);
      if (kind === "positive") strengths.push(signal);
      else if (kind === "risk") weaknesses.push(signal);
      else facts.push(signal);
    }
  }

  const confidenceReasons: ContributorSignal[] = (expl.confidenceReasons ?? [])
    .filter((r) => r?.label?.trim())
    .map((r) => ({
      kind: "confidence" as const,
      label: r.label.trim(),
      code: r.code,
      dimension: dimLabel,
      dimensionKey: dimKey,
    }));

  const fullConfidence =
    isScoredDimension(dim) &&
    dim.confidence >= 0.999 &&
    confidenceReasons.length === 0;

  return {
    hasExplainability: true,
    strengths,
    weaknesses,
    facts,
    confidenceReasons,
    fullConfidence,
    legacyFallbackMessage: null,
  };
}

/**
 * Product score signals come ONLY from Score Explainability V1 scoreDrivers.
 * When dimension.explainability is null: emit nothing for that dimension
 * (no contributors.positive/negative, no normalizedValue heuristics, no limitations).
 */
export function parseContributorSignals(dimensions: DimensionScoreDTO[]): ContributorSignal[] {
  const signals: ContributorSignal[] = [];
  for (const dim of dimensions) {
    if (dim.dimension === "AUTHENTICITY") continue;
    if (!dim.explainability) continue;
    const view = buildDimensionExplainabilityView(dim);
    signals.push(...view.strengths, ...view.weaknesses, ...view.facts);
  }
  return signals;
}

/** True when at least one non-authenticity dimension carries ScoreExplainabilityV1. */
export function hasScoreExplainabilityV1(dimensions: DimensionScoreDTO[]): boolean {
  return dimensions.some(
    (dim) => dim.dimension !== "AUTHENTICITY" && dim.explainability != null,
  );
}

/** Collect confidence reasons across dimensions (never mixed into weaknesses). */
export function parseConfidenceReasons(dimensions: DimensionScoreDTO[]): ContributorSignal[] {
  const signals: ContributorSignal[] = [];
  for (const dim of dimensions) {
    if (dim.dimension === "AUTHENTICITY") continue;
    if (!dim.explainability) continue;
    signals.push(...buildDimensionExplainabilityView(dim).confidenceReasons);
  }
  return signals;
}

/** Human-readable label when a dimension has no usable score. */
export function unavailableDimensionLabel(dimension?: string | null): string {
  if (dimension === "EXPERIENCE") {
    return "Not available — excluded from overall; remaining weights renormalized";
  }
  if (dimension === "UTILITY") return "Utility combat evidence unavailable";
  if (dimension === "SURVIVAL") return "Survival combat evidence unavailable";
  return "Data unavailable";
}

/** Humanize a dotted metric key leaf (e.g. `utility.observed_contribution` -> `Observed Contribution`). */
export function humanizeMetricKey(metricKey: string): string {
  const leaf = metricKey.includes(".") ? metricKey.slice(metricKey.lastIndexOf(".") + 1) : metricKey;
  return leaf.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function topSignals(
  signals: ContributorSignal[],
  kind: ContributorSignal["kind"],
  limit = 5,
): ContributorSignal[] {
  return signals.filter((s) => s.kind === kind).slice(0, limit);
}

export function evidenceNoteFromFlag(flag: RedFlagDTO): string | null {
  const evidence = flag.evidence as { note?: unknown } | null | undefined;
  if (evidence && typeof evidence.note === "string" && evidence.note.trim()) {
    return evidence.note.trim();
  }
  return null;
}

export function explanationSummary(score: CharacterProfileView["score"]): string | null {
  if (!score?.explanation || typeof score.explanation !== "object") return null;
  const summary = (score.explanation as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

export { mapEquipmentSlots } from "./equipmentViewModel";

export function dimensionRows(dimensions: DimensionScoreDTO[], modelVersion?: number | null) {
  return resolveRadarDimensions(modelVersion).map((dim) => {
    const found = dimensions.find((d) => d.dimension === dim);
    const state = found?.state ?? (found ? (found.confidence <= 0 ? "UNAVAILABLE" : "AVAILABLE") : "UNAVAILABLE");
    const unavailable =
      !found ||
      state === "UNAVAILABLE" ||
      state === "PROCESSING" ||
      state === "ERROR" ||
      found.score == null ||
      found.confidence <= 0;
    return {
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      score: unavailable ? null : found!.score,
      confidence: unavailable ? null : found!.confidence,
      weight: found?.weight ?? null,
      missing: unavailable,
      state,
      reason: found?.reason ?? null,
      stateLabel:
        state === "AVAILABLE"
          ? "Available"
          : state === "PARTIAL"
            ? "Partial"
            : state === "PROCESSING"
              ? "Processing"
              : state === "ERROR"
                ? "Error"
                : "Unavailable",
    };
  });
}

export function humanizeProvider(provider: string): string {
  switch (provider.toUpperCase()) {
    case "BLIZZARD":
      return "Blizzard";
    case "RAIDER_IO":
    case "RAIDERIO":
      return "Raider.IO";
    case "WARCRAFT_LOGS":
    case "WCL":
      return "Warcraft Logs";
    default:
      return provider;
  }
}

export function humanizeSlug(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value
    .trim()
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
