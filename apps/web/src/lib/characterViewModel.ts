import type { DimensionScoreDTO } from "@mplus/contracts";
import type {
  CharacterProfileView,
  Grade,
  RedFlagDTO,
} from "../api/types";
import { DIMENSION_LABELS, RADAR_DIMENSIONS, type RadarDimension } from "./format";

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
    const contrib = dim.contributors as
      | { positive?: Array<{ label?: string }>; negative?: Array<{ label?: string }> }
      | null
      | undefined;
    const label = DIMENSION_LABELS[dim.dimension as RadarDimension] ?? dim.dimension;
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
  }
  return signals;
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
