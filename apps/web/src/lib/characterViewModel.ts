import type { DimensionScoreDTO } from "@mplus/contracts";
import type {
  CharacterProfileView,
  EquipmentSummary,
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

export interface EquipmentSlotView {
  id: string;
  label: string;
  name: string | null;
  itemLevel: number | null;
  filled: boolean;
}

const EQUIPMENT_SLOT_DEFS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: "head", label: "Head", match: /^head$/i },
  { id: "neck", label: "Neck", match: /^neck$/i },
  { id: "shoulders", label: "Shoulders", match: /shoulder/i },
  { id: "back", label: "Back", match: /^(back|cloak)$/i },
  { id: "chest", label: "Chest", match: /^chest$/i },
  { id: "wrist", label: "Wrists", match: /wrist/i },
  { id: "hands", label: "Hands", match: /hand|glove/i },
  { id: "waist", label: "Waist", match: /waist|belt/i },
  { id: "legs", label: "Legs", match: /leg/i },
  { id: "feet", label: "Feet", match: /feet|boot/i },
  { id: "finger-1", label: "Ring 1", match: /finger|ring/i },
  { id: "finger-2", label: "Ring 2", match: /finger|ring/i },
  { id: "trinket-1", label: "Trinket 1", match: /trinket/i },
  { id: "trinket-2", label: "Trinket 2", match: /trinket/i },
  { id: "main-hand", label: "Main Hand", match: /main.?hand|weapon/i },
  { id: "off-hand", label: "Off Hand", match: /off.?hand|shield/i },
];

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

export function mapEquipmentSlots(equipment: EquipmentSummary | null | undefined): EquipmentSlotView[] {
  const slots: EquipmentSlotView[] = EQUIPMENT_SLOT_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    name: null,
    itemLevel: null,
    filled: false,
  }));

  if (!equipment?.keyItems?.length) return slots;

  const used = new Set<string>();
  for (const item of equipment.keyItems) {
    const candidates = EQUIPMENT_SLOT_DEFS.filter((def) => def.match.test(item.slot));
    const target = candidates.find((def) => !used.has(def.id)) ?? null;
    if (!target) continue;
    used.add(target.id);
    const index = EQUIPMENT_SLOT_DEFS.findIndex((def) => def.id === target.id);
    if (index < 0) continue;
    slots[index] = {
      id: target.id,
      label: target.label,
      name: item.name,
      itemLevel: item.itemLevel,
      filled: true,
    };
  }

  return slots;
}

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
