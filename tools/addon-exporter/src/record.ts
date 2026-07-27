import type { Grade } from "@mplus/contracts";
import { GRADE_TO_CODE, RED_FLAG_BIT } from "./constants.js";
import type { AddonCompactRecord, AddonExportInput } from "./types.js";

export function confidenceToBucket(confidence: number): number {
  const pct = confidence <= 1 ? confidence * 100 : confidence;
  if (pct >= 80) return 3;
  if (pct >= 60) return 2;
  if (pct >= 40) return 1;
  return 0;
}

export function redFlagsToBitset(keys: string[]): number {
  let bits = 0;
  for (const key of keys) {
    const bit = RED_FLAG_BIT[key];
    if (bit !== undefined) {
      bits |= bit;
    }
  }
  return bits;
}

export function freshnessDays(calculatedAt: string, generatedAt: string): number {
  const calculated = Date.parse(calculatedAt);
  const generated = Date.parse(generatedAt);
  if (Number.isNaN(calculated) || Number.isNaN(generated)) {
    return 0;
  }
  const days = Math.floor((generated - calculated) / 86_400_000);
  return Math.max(0, Math.min(days, 65535));
}

export function toCompactRecord(
  input: AddonExportInput,
  generatedAt: string,
): AddonCompactRecord {
  const gradeCode = GRADE_TO_CODE[input.grade as Grade];
  const record: AddonCompactRecord = {
    score: Math.round(Math.max(0, Math.min(100, input.overallScore))),
    gradeCode: gradeCode ?? 1,
    confidenceBucket: confidenceToBucket(input.confidence),
    redFlags: redFlagsToBitset(input.redFlagKeys),
    freshnessDays: freshnessDays(input.calculatedAt, generatedAt),
  };
  if (input.profileKey) {
    record.profileKey = input.profileKey;
  }
  return record;
}
