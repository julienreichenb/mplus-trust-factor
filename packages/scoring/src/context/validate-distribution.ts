import { createHash } from "node:crypto";
import type { MedianKeyDistributionPoint } from "@mplus/contracts";

export interface DistributionValidationIssue {
  path: string;
  message: string;
}

export interface ValidatedMedianKeyDistributionPoints {
  points: MedianKeyDistributionPoint[];
  contentHash: string;
}

const MIN_BPS = 1;
const MAX_BPS = 10_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate an imported median-key distribution. Duplicate concrete thresholds
 * are allowed; duplicate percentile identities are not.
 */
export function validateMedianKeyDistributionPoints(
  raw: unknown,
): { ok: true; value: ValidatedMedianKeyDistributionPoints } | { ok: false; issues: DistributionValidationIssue[] } {
  const issues: DistributionValidationIssue[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "points", message: "points must be an array" }] };
  }
  if (raw.length === 0) {
    return { ok: false, issues: [{ path: "points", message: "points must not be empty" }] };
  }

  const pending: MedianKeyDistributionPoint[] = [];
  const seenBps = new Set<number>();

  raw.forEach((entry, index) => {
    const path = `points[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push({ path, message: "point must be an object" });
      return;
    }
    const rec = entry as Record<string, unknown>;
    const bps = rec.percentileBps;
    const threshold = rec.medianKeyThreshold;
    let bpsOk = false;
    if (!Number.isInteger(bps) || !isFiniteNumber(bps)) {
      issues.push({ path: `${path}.percentileBps`, message: "percentileBps must be a finite integer" });
    } else if (bps < MIN_BPS || bps > MAX_BPS) {
      issues.push({
        path: `${path}.percentileBps`,
        message: `percentileBps must be in ${MIN_BPS}..${MAX_BPS}`,
      });
    } else if (seenBps.has(bps)) {
      issues.push({ path: `${path}.percentileBps`, message: "duplicate percentile identity" });
    } else {
      seenBps.add(bps);
      bpsOk = true;
    }
    let thresholdOk = false;
    if (!isFiniteNumber(threshold) || threshold < 0) {
      issues.push({
        path: `${path}.medianKeyThreshold`,
        message: "medianKeyThreshold must be a finite number >= 0",
      });
    } else {
      thresholdOk = true;
    }
    if (bpsOk && thresholdOk) {
      pending.push({ percentileBps: bps as number, medianKeyThreshold: threshold as number });
    }
  });

  const ordered = [...pending].sort((a, b) => a.percentileBps - b.percentileBps);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.medianKeyThreshold < ordered[i - 1]!.medianKeyThreshold) {
      issues.push({
        path: "points",
        message: "medianKeyThreshold must be non-decreasing as percentileBps increases",
      });
      break;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const contentHash = createHash("sha256")
    .update(JSON.stringify(ordered))
    .digest("hex");

  return { ok: true, value: { points: ordered, contentHash } };
}

export function validatePercentileAnchors(
  raw: unknown,
): { ok: true; anchors: Array<{ percentileBps: number; factor: number }> } | { ok: false; issues: DistributionValidationIssue[] } {
  const issues: DistributionValidationIssue[] = [];
  if (!Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "percentileAnchors", message: "must be an array" }] };
  }
  const seen = new Set<number>();
  const anchors: Array<{ percentileBps: number; factor: number }> = [];
  raw.forEach((entry, index) => {
    const path = `percentileAnchors[${index}]`;
    if (!entry || typeof entry !== "object") {
      issues.push({ path, message: "anchor must be an object" });
      return;
    }
    const rec = entry as Record<string, unknown>;
    const bps = rec.percentileBps;
    const factor = rec.factor;
    let bpsOk = false;
    if (!Number.isInteger(bps) || !isFiniteNumber(bps) || bps < MIN_BPS || bps > MAX_BPS) {
      issues.push({ path: `${path}.percentileBps`, message: "invalid percentileBps" });
    } else if (seen.has(bps)) {
      issues.push({ path: `${path}.percentileBps`, message: "duplicate percentile identity" });
    } else {
      seen.add(bps);
      bpsOk = true;
    }
    let factorOk = false;
    if (!isFiniteNumber(factor) || factor <= 0) {
      issues.push({ path: `${path}.factor`, message: "factor must be finite and > 0" });
    } else {
      factorOk = true;
    }
    if (bpsOk && factorOk) {
      anchors.push({ percentileBps: bps as number, factor: factor as number });
    }
  });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, anchors };
}

export function validateTierFactors(
  raw: unknown,
): { ok: true; factors: Record<1 | 2 | 3 | 4 | 5, number> } | { ok: false; issues: DistributionValidationIssue[] } {
  const issues: DistributionValidationIssue[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "tierFactors", message: "must be an object" }] };
  }
  const rec = raw as Record<string, unknown>;
  const factors = {} as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const tier of [1, 2, 3, 4, 5] as const) {
    const value = rec[String(tier)];
    if (!isFiniteNumber(value) || value <= 0) {
      issues.push({ path: `tierFactors.${tier}`, message: "factor must be finite and > 0" });
    } else {
      factors[tier] = value;
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, factors };
}
