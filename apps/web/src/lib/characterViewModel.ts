import type { DimensionScoreDTO } from "@mplus/contracts";
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

export interface ContributorSignal {
  kind: "positive" | "risk";
  label: string;
  /** Human-readable dimension name (e.g. Survival). */
  dimension?: string;
  /** Stable dimension key for icons / filters. */
  dimensionKey?: RadarDimension;
}

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
  if (profile.dataConfidence != null && !Number.isNaN(profile.dataConfidence)) {
    return profile.dataConfidence;
  }
  if (profile.score?.confidence != null && !Number.isNaN(profile.score.confidence)) {
    return profile.score.confidence <= 1 ? profile.score.confidence * 100 : profile.score.confidence;
  }
  return null;
}

export function parseContributorSignals(dimensions: DimensionScoreDTO[]): ContributorSignal[] {
  const signals: ContributorSignal[] = [];
  for (const dim of dimensions) {
    if (dim.dimension === "AUTHENTICITY") continue;
    const dimKey = dim.dimension as RadarDimension;
    const label = DIMENSION_LABELS[dimKey] ?? dim.dimension;
    const contrib = dim.contributors as
      | {
          positive?: Array<{ label?: string; metricKey?: string }>;
          negative?: Array<{ label?: string; metricKey?: string }>;
          available?: Array<{
            metricKey?: string;
            normalizedValue?: number | null;
            available?: boolean;
          }>;
          missing?: Array<{ metricKey?: string; available?: boolean }>;
        }
      | null
      | undefined;

    // Preferred shape (mock / legacy explainers).
    for (const item of contrib?.positive ?? []) {
      if (item?.label?.trim()) {
        signals.push({
          kind: "positive",
          label: item.label.trim(),
          dimension: label,
          dimensionKey: dimKey,
        });
      }
    }
    for (const item of contrib?.negative ?? []) {
      if (item?.label?.trim()) {
        signals.push({
          kind: "risk",
          label: item.label.trim(),
          dimension: label,
          dimensionKey: dimKey,
        });
      }
    }

    // Live scoring shape: { available, missing } metric contributors.
    if ((contrib?.positive?.length ?? 0) === 0 && (contrib?.negative?.length ?? 0) === 0) {
      for (const item of contrib?.available ?? []) {
        if (!item?.metricKey) continue;
        const metricLabel = humanizeMetricKey(item.metricKey);
        const value = item.normalizedValue;
        if (typeof value === "number" && value >= 55) {
          signals.push({
            kind: "positive",
            label: metricLabel,
            dimension: label,
            dimensionKey: dimKey,
          });
        } else if (typeof value === "number" && value < 45) {
          signals.push({
            kind: "risk",
            label: metricLabel,
            dimension: label,
            dimensionKey: dimKey,
          });
        }
      }
      for (const item of contrib?.missing ?? []) {
        if (!item?.metricKey) continue;
        signals.push({
          kind: "risk",
          label: `Missing ${humanizeMetricKey(item.metricKey)}`,
          dimension: label,
          dimensionKey: dimKey,
        });
      }
    }
  }
  return signals;
}

function humanizeMetricKey(metricKey: string): string {
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
