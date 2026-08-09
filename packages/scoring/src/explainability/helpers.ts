/**
 * Shared helpers for Score Explainability V1 adapters.
 */

import type {
  ConfidenceComponentV1,
  ConfidenceReasonV1,
  ScoreDriverDirection,
  ScoreDriverV1,
} from "@mplus/contracts";
import {
  SCORE_EXPLAINABILITY_NEUTRAL_POINT,
  presentConfidenceCause,
  presentConfidenceComponent,
  presentScoreDriver,
} from "./label-registry.js";

export function directionFromSignedContribution(
  contribution: number | null,
  epsilon = 1e-9,
): ScoreDriverDirection {
  if (contribution == null || !Number.isFinite(contribution)) return "NEUTRAL";
  if (contribution > epsilon) return "POSITIVE";
  if (contribution < -epsilon) return "NEGATIVE";
  return "NEUTRAL";
}

/** Signed contribution relative to the shared 0–100 neutral point. */
export function signedContributionFromNeutral(
  value: number | null,
  weight: number | null,
  neutralPoint: number = SCORE_EXPLAINABILITY_NEUTRAL_POINT,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const w = weight == null || !Number.isFinite(weight) ? 1 : weight;
  return w * (value - neutralPoint);
}

export function sortDrivers(drivers: ScoreDriverV1[]): ScoreDriverV1[] {
  return [...drivers].sort((a, b) => {
    const ma = Math.abs(a.materiality ?? 0);
    const mb = Math.abs(b.materiality ?? 0);
    if (mb !== ma) return mb - ma;
    return a.code.localeCompare(b.code);
  });
}

export function sortReasons(reasons: ConfidenceReasonV1[]): ConfidenceReasonV1[] {
  return [...reasons].sort((a, b) => a.code.localeCompare(b.code));
}

export function sortComponents(
  components: ConfidenceComponentV1[],
): ConfidenceComponentV1[] {
  return [...components].sort((a, b) => a.key.localeCompare(b.key));
}

export function buildScoreDriver(input: {
  code: string;
  direction?: ScoreDriverDirection;
  value?: number | null;
  normalizedValue?: number | null;
  weight?: number | null;
  contribution?: number | null;
  materiality?: number | null;
  params?: Record<string, string | number | boolean | null>;
  evidence?: Record<string, unknown>;
}): ScoreDriverV1 {
  const params = input.params ?? {};
  const presentation = presentScoreDriver(input.code, {
    ...params,
    value: input.value ?? null,
    contribution: input.contribution ?? null,
    weight: input.weight ?? null,
  });
  const contribution = input.contribution ?? null;
  const materiality =
    input.materiality ??
    (contribution != null && Number.isFinite(contribution)
      ? Math.abs(contribution)
      : input.value != null && Number.isFinite(input.value)
        ? Math.abs(input.value - SCORE_EXPLAINABILITY_NEUTRAL_POINT)
        : null);
  return {
    code: input.code,
    labelKey: presentation.labelKey,
    label: presentation.label,
    direction:
      input.direction ?? directionFromSignedContribution(contribution),
    value: input.value ?? null,
    normalizedValue: input.normalizedValue ?? input.value ?? null,
    weight: input.weight ?? null,
    contribution,
    materiality,
    params,
    evidence: input.evidence ?? {},
  };
}

export function buildConfidenceReasonsFromCauses(
  causes: readonly string[],
  options?: {
    /** When confidence is perfect, reasons must be empty. */
    confidenceValue?: number | null;
    evidenceByCode?: Record<string, Record<string, unknown>>;
  },
): ConfidenceReasonV1[] {
  if (
    options?.confidenceValue != null &&
    Number.isFinite(options.confidenceValue) &&
    options.confidenceValue >= 1
  ) {
    return [];
  }
  const reasons: ConfidenceReasonV1[] = [];
  const seen = new Set<string>();
  for (const raw of causes) {
    const code = raw.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const presentation = presentConfidenceCause(code);
    reasons.push({
      code,
      labelKey: presentation.labelKey,
      label: presentation.label,
      params: presentation.params,
      evidence: options?.evidenceByCode?.[code] ?? {},
    });
  }
  return sortReasons(reasons);
}

export function buildConfidenceComponents(
  components: Record<string, number> | null | undefined,
): ConfidenceComponentV1[] {
  if (components == null) return [];
  const out: ConfidenceComponentV1[] = [];
  for (const [key, value] of Object.entries(components)) {
    if (!Number.isFinite(value)) continue;
    const presentation = presentConfidenceComponent(key, { value });
    out.push({
      key,
      value,
      labelKey: presentation.labelKey,
      label: presentation.label,
    });
  }
  return sortComponents(out);
}

/** Strip privileged / operational keys from audit evidence maps. */
export function sanitizeEvidenceRecord(
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  const forbidden =
    /reportcode|fightid|reportrevision|accesstoken|refreshtoken|authorization|battletag|linkedcharacter|rawevents|rawfacts|rawartifact|manifestcontenthash|inputfingerprint|scoremodelid|manifestid|slotid|characterid|uuid/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (forbidden.test(key.replace(/[_-]/g, ""))) continue;
    if (typeof value === "string" && /^[a-zA-Z0-9]{12,20}$/.test(value)) {
      // Likely WCL report code — omit from explainability evidence.
      continue;
    }
    out[key] = value;
  }
  return out;
}
