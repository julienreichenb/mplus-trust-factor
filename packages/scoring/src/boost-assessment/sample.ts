/**
 * Helpers for Boost run Key % aggregates.
 * Production Boost Assessment does not select runs; the frozen evidence
 * manifest is the sample.
 */
import { computeTrueMedian } from "../context/median.js";
import type { BoostRunInput } from "./types.js";

export function subjectKeyParse(run: BoostRunInput): number | null {
  if (run.subjectKeyParse != null && Number.isFinite(run.subjectKeyParse)) {
    return run.subjectKeyParse;
  }
  if (run.parsePercentile != null && Number.isFinite(run.parsePercentile)) {
    return run.parsePercentile;
  }
  return null;
}

export function peerMedianKeyParse(run: BoostRunInput): number | null {
  const values = (run.peerKeyParses ?? []).map((p) => p.keyParse).filter((v) => Number.isFinite(v));
  return computeTrueMedian(values);
}

export function peerMaxKeyParse(run: BoostRunInput): number | null {
  const values = (run.peerKeyParses ?? []).map((p) => p.keyParse).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.max(...values);
}
