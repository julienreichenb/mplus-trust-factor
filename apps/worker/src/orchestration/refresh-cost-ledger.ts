/**
 * Durable refresh cost accounting types and in-memory aggregation helpers.
 * Persistence goes through RefreshCostLedgerEntry (Prisma).
 */

export type CostProvider = "BLIZZARD" | "WARCRAFT_LOGS" | "RAIDERIO" | "INTERNAL";

export type CostSource = "measured" | "estimated" | "unknown";

export interface RefreshCostRecord {
  provider: CostProvider;
  operation: string;
  dataset: string;
  characterId?: string;
  runId?: string;
  jobId?: string;
  scheduleRunId?: string;
  refreshReason: string;
  cacheHit: boolean;
  estimatedCost: number | null;
  measuredCost: number | null;
  costSource: CostSource;
  modelOnly: boolean;
  providerRefetch: boolean;
  metadata?: Record<string, unknown>;
  recordedAt?: Date;
}

export interface CostScenarioMeasurement {
  scenario:
    | "cold_new_character"
    | "warm_refresh"
    | "stale_rankings_only"
    | "detailed_event_backfill"
    | "model_only_recalculation"
    | "partial_completion";
  providerCalls: number;
  wclPoints: number | null;
  cacheHits: number;
  cacheMisses: number;
  modelOnly: boolean;
  notes: string[];
}

/** Conservative baseline estimates before live calibration (points / logical ops). */
export const BASELINE_COST_SCENARIOS: CostScenarioMeasurement[] = [
  {
    scenario: "cold_new_character",
    providerCalls: 18,
    wclPoints: 85,
    cacheHits: 0,
    cacheMisses: 18,
    modelOnly: false,
    notes: [
      "Blizzard identity + profile + seasonal runs",
      "Raider.IO profile",
      "WCL discovery + fight details + survival/shared evidence",
    ],
  },
  {
    scenario: "warm_refresh",
    providerCalls: 8,
    wclPoints: 35,
    cacheHits: 10,
    cacheMisses: 8,
    modelOnly: false,
    notes: ["Reuse immutable report/combat caches; refresh rankings + rating"],
  },
  {
    scenario: "stale_rankings_only",
    providerCalls: 4,
    wclPoints: 12,
    cacheHits: 14,
    cacheMisses: 4,
    modelOnly: false,
    notes: ["Dataset plan RATING_ONLY"],
  },
  {
    scenario: "detailed_event_backfill",
    providerCalls: 12,
    wclPoints: 60,
    cacheHits: 4,
    cacheMisses: 12,
    modelOnly: false,
    notes: ["Shared evidence / fight event pages for selected runs"],
  },
  {
    scenario: "model_only_recalculation",
    providerCalls: 0,
    wclPoints: 0,
    cacheHits: 0,
    cacheMisses: 0,
    modelOnly: true,
    notes: ["Zero provider calls — persisted observations only"],
  },
  {
    scenario: "partial_completion",
    providerCalls: 6,
    wclPoints: 25,
    cacheHits: 6,
    cacheMisses: 6,
    modelOnly: false,
    notes: ["Soft-skip remaining WCL work; published score preserved"],
  },
];

export const MIN_SAMPLES_FOR_MEASURED_ESTIMATE = 5;

export interface MeasuredScenarioEstimate {
  scenario: CostScenarioMeasurement["scenario"];
  wclPoints: number;
  source: "measured" | "fallback";
  sampleSize: number;
  notes: string[];
}

/**
 * Rolling estimates from durable ledger rows.
 * Requires MIN_SAMPLES_FOR_MEASURED_ESTIMATE measured samples; otherwise falls back.
 */
export function estimateScenariosFromLedger(
  records: RefreshCostRecord[],
  minSamples = MIN_SAMPLES_FOR_MEASURED_ESTIMATE,
): MeasuredScenarioEstimate[] {
  const measuredShared = records.filter(
    (r) =>
      r.provider === "WARCRAFT_LOGS" &&
      r.operation === "sharedEvidenceBundle" &&
      r.costSource === "measured" &&
      r.measuredCost != null &&
      Number.isFinite(r.measuredCost),
  );
  const cold = measuredShared.filter((r) => !r.cacheHit && r.providerRefetch);
  const warm = measuredShared.filter((r) => r.cacheHit);
  const rankings = records.filter(
    (r) =>
      r.dataset === "wcl.zone_rankings" &&
      r.costSource === "measured" &&
      r.measuredCost != null,
  );
  const modelOnly = records.filter((r) => r.modelOnly);
  const partial = measuredShared.filter(
    (r) =>
      r.metadata &&
      typeof r.metadata === "object" &&
      (r.metadata as { partial?: boolean }).partial === true,
  );

  const avg = (rows: RefreshCostRecord[]): number | null => {
    const vals = rows
      .map((r) => r.measuredCost)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const resolve = (
    scenario: CostScenarioMeasurement["scenario"],
    samples: RefreshCostRecord[],
  ): MeasuredScenarioEstimate => {
    const fallback = BASELINE_COST_SCENARIOS.find((s) => s.scenario === scenario)!;
    const measuredAvg = avg(samples);
    if (samples.length >= minSamples && measuredAvg != null) {
      return {
        scenario,
        wclPoints: measuredAvg,
        source: "measured",
        sampleSize: samples.length,
        notes: [`Rolling average from ${samples.length} ledger samples`],
      };
    }
    return {
      scenario,
      wclPoints: fallback.wclPoints ?? 0,
      source: "fallback",
      sampleSize: samples.length,
      notes: [
        ...fallback.notes,
        `Insufficient samples (${samples.length}/${minSamples}) — using conservative fallback`,
      ],
    };
  };

  return [
    resolve("cold_new_character", cold),
    resolve("warm_refresh", warm),
    resolve("stale_rankings_only", rankings),
    resolve("detailed_event_backfill", cold),
    resolve(
      "model_only_recalculation",
      modelOnly.length > 0
        ? modelOnly
        : [
            {
              provider: "WARCRAFT_LOGS",
              operation: "model_only",
              dataset: "calculated.score_snapshot",
              refreshReason: "admin_force_recalculation",
              cacheHit: true,
              estimatedCost: 0,
              measuredCost: 0,
              costSource: "measured",
              modelOnly: true,
              providerRefetch: false,
            },
          ],
    ),
    resolve("partial_completion", partial.length > 0 ? partial : warm),
  ];
}

/** Average WCL points for planner — prefers measured warm refresh. */
export function averageWclPointsFromEstimates(estimates: MeasuredScenarioEstimate[]): number {
  const warm = estimates.find((e) => e.scenario === "warm_refresh");
  if (warm) return warm.wclPoints;
  return BASELINE_COST_SCENARIOS.find((s) => s.scenario === "warm_refresh")?.wclPoints ?? 35;
}

export interface CostAggregation {
  byProvider: Record<string, { estimated: number; measured: number; unknownCount: number }>;
  byOperation: Record<string, { estimated: number; measured: number; count: number }>;
  byRefreshReason: Record<string, { estimated: number; measured: number; count: number }>;
  cacheHits: number;
  cacheMisses: number;
  modelOnlyCount: number;
  providerRefetchCount: number;
  totalMeasured: number | null;
  totalEstimated: number;
}

export function aggregateCostRecords(records: RefreshCostRecord[]): CostAggregation {
  const byProvider: CostAggregation["byProvider"] = {};
  const byOperation: CostAggregation["byOperation"] = {};
  const byRefreshReason: CostAggregation["byRefreshReason"] = {};
  let cacheHits = 0;
  let cacheMisses = 0;
  let modelOnlyCount = 0;
  let providerRefetchCount = 0;
  let totalMeasured = 0;
  let measuredCount = 0;
  let totalEstimated = 0;

  for (const r of records) {
    if (r.cacheHit) cacheHits += 1;
    else cacheMisses += 1;
    if (r.modelOnly) modelOnlyCount += 1;
    if (r.providerRefetch) providerRefetchCount += 1;

    const prov = byProvider[r.provider] ?? { estimated: 0, measured: 0, unknownCount: 0 };
    const op = byOperation[r.operation] ?? { estimated: 0, measured: 0, count: 0 };
    const reason = byRefreshReason[r.refreshReason] ?? { estimated: 0, measured: 0, count: 0 };

    if (r.estimatedCost != null) {
      prov.estimated += r.estimatedCost;
      op.estimated += r.estimatedCost;
      reason.estimated += r.estimatedCost;
      totalEstimated += r.estimatedCost;
    }
    if (r.measuredCost != null && r.costSource === "measured") {
      prov.measured += r.measuredCost;
      op.measured += r.measuredCost;
      reason.measured += r.measuredCost;
      totalMeasured += r.measuredCost;
      measuredCount += 1;
    } else if (r.costSource === "unknown") {
      prov.unknownCount += 1;
    }
    op.count += 1;
    reason.count += 1;

    byProvider[r.provider] = prov;
    byOperation[r.operation] = op;
    byRefreshReason[r.refreshReason] = reason;
  }

  return {
    byProvider,
    byOperation,
    byRefreshReason,
    cacheHits,
    cacheMisses,
    modelOnlyCount,
    providerRefetchCount,
    totalMeasured: measuredCount > 0 ? totalMeasured : null,
    totalEstimated,
  };
}

export function toPrismaCostSource(source: CostSource): "MEASURED" | "ESTIMATED" | "UNKNOWN" {
  if (source === "measured") return "MEASURED";
  if (source === "estimated") return "ESTIMATED";
  return "UNKNOWN";
}

/** Guard used by ledger writers and tests. */
export function assertUnknownCostNotZero(
  costSource: CostSource,
  measuredCost: number | null,
): number | null {
  if (costSource === "unknown") {
    if (measuredCost === 0) {
      throw new Error("Unknown cost must never become zero");
    }
    return null;
  }
  return measuredCost;
}
