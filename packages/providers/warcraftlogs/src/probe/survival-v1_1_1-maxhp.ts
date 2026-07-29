import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  type SurvivalStandaloneV1_1_1Config,
} from "./survival-v1_1_1-config.js";
import type { ExplicitHealthSnapshot } from "./survival-v1_1-types.js";

export type MaxHpSnapshotClassification =
  | "BASELINE"
  | "VALID_TEMPORARY"
  | "INVALID_OUTLIER"
  | "UNRESOLVED";

export interface ClassifiedMaxHpSnapshot {
  timestamp: number;
  rawMaxHp: number;
  acceptedMaxHp: number | null;
  classification: MaxHpSnapshotClassification;
  rejectionReason: string | null;
  path: string;
  associatedBuffSpellId: number | null;
}

export interface HardenedMaxHpResolution {
  baselineMaxHp: number | null;
  baselineSourcePath: string | null;
  baselineConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  corroboratingBaselineCount: number;
  classifiedSnapshots: ClassifiedMaxHpSnapshot[];
  temporaryIntervals: Array<{
    start: number;
    end: number;
    maxHp: number;
    associatedBuffSpellId: number | null;
  }>;
  invalidOutlierCount: number;
  rejectionReasons: Record<string, number>;
  resolutionFailureReason: string | null;
}

function asFinitePositive(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

/**
 * Resolve baseline modal max HP and classify every snapshot.
 * Implausible million-scale values are INVALID_OUTLIER unless corroborated
 * and inside 0.5x–2.0x baseline (or tied to a known max-HP-changing ability).
 */
export function hardenMaxHpResolution(
  snapshots: ExplicitHealthSnapshot[],
  options: {
    playerActorId: number;
    darkPactActiveIntervals?: Array<{ start: number; end: number }>;
    config?: SurvivalStandaloneV1_1_1Config;
  },
): HardenedMaxHpResolution {
  const config = options.config ?? SURVIVAL_STANDALONE_V1_1_1_CONFIG;
  const playerSnaps = snapshots.filter((s) => {
    if (s.maxHp == null || s.maxHp <= 0) return false;
    // Must belong to the player actor when IDs are present
    if (s.targetID != null && s.targetID !== options.playerActorId) {
      if (s.sourceID !== options.playerActorId) return false;
    }
    return true;
  });

  const values = playerSnaps.map((s) => s.maxHp!);
  if (values.length === 0) {
    return {
      baselineMaxHp: null,
      baselineSourcePath: null,
      baselineConfidence: "NONE",
      corroboratingBaselineCount: 0,
      classifiedSnapshots: [],
      temporaryIntervals: [],
      invalidOutlierCount: 0,
      rejectionReasons: { no_explicit_max_hp: 1 },
      resolutionFailureReason: "no_explicit_max_hp_for_player_actor",
    };
  }

  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  // Prefer modal among values that are not extreme outliers vs median of all
  const allSorted = [...values].sort((a, b) => a - b);
  const median = allSorted[Math.floor(allSorted.length / 2)]!;
  const plausibleCandidates = sorted.filter(
    ([v]) =>
      v >= median * config.maxHp.plausibilityMinRatio &&
      v <= median * config.maxHp.plausibilityMaxRatio,
  );
  const baselineEntry = plausibleCandidates[0] ?? sorted[0]!;
  const baseline = baselineEntry[0];
  const baselineCount = baselineEntry[1];

  const classified: ClassifiedMaxHpSnapshot[] = [];
  const rejectionReasons: Record<string, number> = {};
  let invalidOutlierCount = 0;

  for (const s of playerSnaps) {
    const raw = s.maxHp!;
    const ratio = raw / baseline;
    const inPlausibility =
      ratio >= config.maxHp.plausibilityMinRatio && ratio <= config.maxHp.plausibilityMaxRatio;

    if (raw === baseline) {
      classified.push({
        timestamp: s.timestamp,
        rawMaxHp: raw,
        acceptedMaxHp: raw,
        classification: "BASELINE",
        rejectionReason: null,
        path: s.path,
        associatedBuffSpellId: null,
      });
      continue;
    }

    const darkPactActive = (options.darkPactActiveIntervals ?? []).some(
      (iv) => s.timestamp >= iv.start && s.timestamp <= iv.end,
    );
    const nearbySame = playerSnaps.filter(
      (o) =>
        o.maxHp === raw &&
        Math.abs(o.timestamp - s.timestamp) <= config.maxHp.temporaryCorroborationMs,
    ).length;

    if (!inPlausibility && !darkPactActive) {
      invalidOutlierCount += 1;
      const reason = "implausible_max_hp_outside_0.5x_2.0x_baseline_without_known_effect";
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      classified.push({
        timestamp: s.timestamp,
        rawMaxHp: raw,
        acceptedMaxHp: null,
        classification: "INVALID_OUTLIER",
        rejectionReason: reason,
        path: s.path,
        associatedBuffSpellId: null,
      });
      continue;
    }

    if (
      inPlausibility &&
      (nearbySame >= config.maxHp.minTemporaryCorroborations || darkPactActive)
    ) {
      classified.push({
        timestamp: s.timestamp,
        rawMaxHp: raw,
        acceptedMaxHp: raw,
        classification: "VALID_TEMPORARY",
        rejectionReason: null,
        path: s.path,
        associatedBuffSpellId: darkPactActive ? config.maxHp.darkPactSpellId : null,
      });
      continue;
    }

    if (!inPlausibility && darkPactActive && nearbySame >= 1) {
      classified.push({
        timestamp: s.timestamp,
        rawMaxHp: raw,
        acceptedMaxHp: raw,
        classification: "VALID_TEMPORARY",
        rejectionReason: null,
        path: s.path,
        associatedBuffSpellId: config.maxHp.darkPactSpellId,
      });
      continue;
    }

    invalidOutlierCount += 1;
    const reason = inPlausibility
      ? "temporary_max_hp_uncorroborated"
      : "implausible_max_hp_rejected";
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    classified.push({
      timestamp: s.timestamp,
      rawMaxHp: raw,
      acceptedMaxHp: null,
      classification: "INVALID_OUTLIER",
      rejectionReason: reason,
      path: s.path,
      associatedBuffSpellId: null,
    });
  }

  // Build temporary intervals from accepted temporary snapshots
  const temps = classified
    .filter((c) => c.classification === "VALID_TEMPORARY" && c.acceptedMaxHp != null)
    .sort((a, b) => a.timestamp - b.timestamp);
  const temporaryIntervals: HardenedMaxHpResolution["temporaryIntervals"] = [];
  for (const t of temps) {
    const last = temporaryIntervals[temporaryIntervals.length - 1];
    if (last && last.maxHp === t.acceptedMaxHp && t.timestamp - last.end <= 8_000) {
      last.end = t.timestamp;
    } else {
      temporaryIntervals.push({
        start: t.timestamp,
        end: t.timestamp,
        maxHp: t.acceptedMaxHp!,
        associatedBuffSpellId: t.associatedBuffSpellId,
      });
    }
  }

  let confidence: HardenedMaxHpResolution["baselineConfidence"] = "LOW";
  if (baselineCount >= 10 && invalidOutlierCount === 0) confidence = "HIGH";
  else if (baselineCount >= 3) confidence = "MEDIUM";

  return {
    baselineMaxHp: baseline,
    baselineSourcePath: playerSnaps.find((s) => s.maxHp === baseline)?.path ?? null,
    baselineConfidence: confidence,
    corroboratingBaselineCount: baselineCount,
    classifiedSnapshots: classified,
    temporaryIntervals,
    invalidOutlierCount,
    rejectionReasons,
    resolutionFailureReason: null,
  };
}

/** Active validated max HP at timestamp (temporary if valid, else baseline). */
export function activeMaxHpAt(
  resolution: HardenedMaxHpResolution,
  timestamp: number,
): number | null {
  if (resolution.baselineMaxHp == null) return null;
  for (const iv of resolution.temporaryIntervals) {
    if (timestamp >= iv.start && timestamp <= iv.end + 1_000) return iv.maxHp;
  }
  // Also check classified accepted snapshots near timestamp
  let best: ClassifiedMaxHpSnapshot | null = null;
  for (const c of resolution.classifiedSnapshots) {
    if (c.acceptedMaxHp == null) continue;
    if (c.timestamp > timestamp) break;
    best = c;
  }
  if (best?.classification === "VALID_TEMPORARY" && best.acceptedMaxHp != null) {
    return best.acceptedMaxHp;
  }
  return resolution.baselineMaxHp;
}

export function asFinitePositiveExport(value: unknown): number | null {
  return asFinitePositive(value);
}
