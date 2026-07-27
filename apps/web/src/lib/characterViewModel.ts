import type { DimensionScoreDTO } from "@mplus/contracts";
import type {
  CharacterProfileView,
  Grade,
  RedFlagDTO,
} from "../api/types";
import {
  CORE_TRUST_DIMENSIONS,
  DIMENSION_LABELS,
  RADAR_DIMENSIONS,
  type CoreTrustDimension,
  type RadarDimension,
} from "./format";

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
  dimension?: string;
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
    const label = DIMENSION_LABELS[dim.dimension as RadarDimension] ?? dim.dimension;
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
        signals.push({ kind: "positive", label: item.label.trim(), dimension: label });
      }
    }
    for (const item of contrib?.negative ?? []) {
      if (item?.label?.trim()) {
        signals.push({ kind: "risk", label: item.label.trim(), dimension: label });
      }
    }

    // Live scoring shape: { available, missing } metric contributors.
    if ((contrib?.positive?.length ?? 0) === 0 && (contrib?.negative?.length ?? 0) === 0) {
      for (const item of contrib?.available ?? []) {
        if (!item?.metricKey) continue;
        const metricLabel = humanizeMetricKey(item.metricKey);
        const value = item.normalizedValue;
        if (typeof value === "number" && value >= 55) {
          signals.push({ kind: "positive", label: metricLabel, dimension: label });
        } else if (typeof value === "number" && value < 45) {
          signals.push({ kind: "risk", label: metricLabel, dimension: label });
        }
      }
      for (const item of contrib?.missing ?? []) {
        if (!item?.metricKey) continue;
        signals.push({
          kind: "risk",
          label: `Missing ${humanizeMetricKey(item.metricKey)}`,
          dimension: label,
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
  limit = 2,
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

export function dimensionRows(dimensions: DimensionScoreDTO[]) {
  return RADAR_DIMENSIONS.map((dim) => {
    const found = dimensions.find((d) => d.dimension === dim);
    return {
      dimension: dim,
      label: DIMENSION_LABELS[dim],
      score: found?.score ?? null,
      confidence: found?.confidence ?? null,
      weight: found?.weight ?? null,
      missing: !found,
    };
  });
}

/** Primary Wave 4 dimensions for above-fold and landing preview. */
export function coreDimensionRows(dimensions: DimensionScoreDTO[]) {
  return CORE_TRUST_DIMENSIONS.map((dim) => {
    const found = dimensions.find((d) => d.dimension === dim);
    return {
      dimension: dim as CoreTrustDimension,
      label: DIMENSION_LABELS[dim],
      score: found?.score ?? null,
      confidence: found?.confidence ?? null,
      weight: found?.weight ?? null,
      missing: !found,
      contributors: found?.contributors ?? null,
    };
  });
}

export interface DimensionEvidenceView {
  dimension: CoreTrustDimension;
  label: string;
  score: number | null;
  confidence: number | null;
  weight: number | null;
  missing: boolean;
  modelVersion: string | null;
  positive: string[];
  negative: string[];
  internalWeights: Array<{ key: string; weight: number | null; available: boolean }>;
  perRunEvidence: Array<{ dungeon: string; summary: string }>;
  missingMetrics: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function presentDimensionEvidence(
  dimensions: DimensionScoreDTO[],
  modelVersion?: number | null,
): DimensionEvidenceView[] {
  return coreDimensionRows(dimensions).map((row) => {
    const contrib = asRecord(row.contributors);
    const positive = Array.isArray(contrib?.positive)
      ? contrib.positive
          .map((item) => asRecord(item)?.label)
          .filter((label): label is string => typeof label === "string" && Boolean(label.trim()))
      : [];
    const negative = Array.isArray(contrib?.negative)
      ? contrib.negative
          .map((item) => asRecord(item)?.label)
          .filter((label): label is string => typeof label === "string" && Boolean(label.trim()))
      : [];
    const internalWeights = Array.isArray(contrib?.internalWeights)
      ? contrib.internalWeights.map((item) => {
          const rec = asRecord(item);
          const key = typeof rec?.key === "string" ? rec.key : "metric";
          const weight = typeof rec?.weight === "number" ? rec.weight : null;
          const available = rec?.available !== false && weight != null;
          return { key, weight, available };
        })
      : [];
    const perRunEvidence = Array.isArray(contrib?.perRunEvidence)
      ? contrib.perRunEvidence
          .map((item) => {
            const rec = asRecord(item);
            const dungeon = typeof rec?.dungeon === "string" ? rec.dungeon : null;
            const summary = typeof rec?.summary === "string" ? rec.summary : null;
            return dungeon && summary ? { dungeon, summary } : null;
          })
          .filter((item): item is { dungeon: string; summary: string } => item != null)
      : [];
    const missingMetrics = Array.isArray(contrib?.missingMetrics)
      ? contrib.missingMetrics.filter((m): m is string => typeof m === "string")
      : Array.isArray(contrib?.missing)
        ? contrib.missing
            .map((item) => asRecord(item)?.metricKey)
            .filter((key): key is string => typeof key === "string")
        : [];

    return {
      dimension: row.dimension,
      label: row.label,
      score: row.score,
      confidence: row.confidence,
      weight: row.weight,
      missing: row.missing,
      modelVersion: modelVersion != null ? String(modelVersion) : null,
      positive,
      negative,
      internalWeights,
      perRunEvidence,
      missingMetrics,
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
