/**
 * Persist refresh cost ledger entries from live pipeline execution.
 * Unknown measured cost stays null — never coerced to zero.
 */
import type { PrismaClient, Provider, RefreshCostSource } from "@mplus/database";
import { toInputJsonValue } from "../persistence/prisma-json.js";
import type { RefreshCostRecord, CostSource } from "./refresh-cost-ledger.js";
import { toPrismaCostSource } from "./refresh-cost-ledger.js";

export interface RefreshCostRecorderDeps {
  prisma: PrismaClient;
}

function mapProvider(provider: RefreshCostRecord["provider"]): Provider {
  switch (provider) {
    case "BLIZZARD":
      return "BLIZZARD";
    case "WARCRAFT_LOGS":
      return "WARCRAFT_LOGS";
    case "RAIDERIO":
      return "RAIDER_IO";
    default:
      return "WARCRAFT_LOGS";
  }
}

export async function recordRefreshCostEntries(
  prisma: PrismaClient,
  records: RefreshCostRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  let written = 0;
  for (const r of records) {
    // Guard: unknown must never become zero.
    const measured =
      r.costSource === "unknown"
        ? null
        : r.measuredCost;
    const estimated = r.estimatedCost;
    if (r.costSource === "unknown" && measured === 0) {
      throw new Error("Invariant violated: unknown cost coerced to zero");
    }
    await prisma.refreshCostLedgerEntry.create({
      data: {
        provider: mapProvider(r.provider),
        operation: r.operation,
        dataset: r.dataset,
        characterId: r.characterId ?? null,
        runId: r.runId ?? null,
        jobId: r.jobId ?? null,
        scheduleRunId: r.scheduleRunId ?? null,
        refreshReason: r.refreshReason,
        cacheHit: r.cacheHit,
        estimatedCost: estimated,
        measuredCost: measured,
        costSource: toPrismaCostSource(r.costSource) as RefreshCostSource,
        modelOnly: r.modelOnly,
        providerRefetch: r.providerRefetch,
        metadata: toInputJsonValue(r.metadata ?? {}),
        recordedAt: r.recordedAt ?? new Date(),
      },
    });
    written += 1;
  }
  return written;
}

export function buildSharedEvidenceCostRecords(input: {
  characterId: string;
  jobId?: string;
  runId?: string;
  refreshReason: string;
  reportCode: string;
  fightId: number;
  providerCalls: number;
  pages: number;
  pointsConsumed: number | null;
  estimatedPointsConsumed: number | null;
  costSource: CostSource;
  cacheHits: number;
  persistedHits: number;
  modelOnly?: boolean;
}): RefreshCostRecord[] {
  const cacheHit = input.providerCalls === 0 && (input.cacheHits > 0 || input.persistedHits > 0);
  return [
    {
      provider: "WARCRAFT_LOGS",
      operation: "sharedEvidenceBundle",
      dataset: "wcl.combat_events",
      characterId: input.characterId,
      runId: input.runId,
      jobId: input.jobId,
      refreshReason: input.refreshReason,
      cacheHit,
      estimatedCost: input.estimatedPointsConsumed,
      measuredCost: input.pointsConsumed,
      costSource: input.costSource,
      modelOnly: input.modelOnly === true,
      providerRefetch: !cacheHit && input.providerCalls > 0,
      metadata: {
        reportCode: input.reportCode,
        fightId: input.fightId,
        providerCalls: input.providerCalls,
        pages: input.pages,
        cacheHits: input.cacheHits,
        persistedHits: input.persistedHits,
      },
    },
  ];
}

/** In-memory accumulator used during a single refresh job. */
export class RefreshCostAccumulator {
  readonly records: RefreshCostRecord[] = [];

  add(record: RefreshCostRecord): void {
    if (record.costSource === "unknown" && record.measuredCost === 0) {
      this.records.push({ ...record, measuredCost: null });
      return;
    }
    this.records.push(record);
  }

  addMany(records: RefreshCostRecord[]): void {
    for (const r of records) this.add(r);
  }
}
