/**
 * Batch-level WCL cost accounting.
 * Prefer rateLimitData before/after delta; never treat unknown cost as zero.
 */
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { OPERATIONS } from "../operations/queries.js";
import { parseRateLimitSnapshot } from "../rate/rate-budget.js";
import type { WclRateLimitSnapshot } from "../types.js";

export type WclCostSource = "measured" | "estimated" | "unknown";

export interface WclBatchCostAccounting {
  /** Measured or estimated points; null when source is unknown. Never coerced from unknown → 0. */
  pointsConsumed: number | null;
  estimatedPointsConsumed: number | null;
  costSource: WclCostSource;
  requestCount: number;
  pageCount: number;
  pointsSpentBefore: number | null;
  pointsSpentAfter: number | null;
  limitPerHour: number | null;
  notes: string[];
}

/** Conservative per-page estimate when measured cost is unavailable. */
export const CONSERVATIVE_POINTS_PER_EVENT_PAGE = 1;
export const CONSERVATIVE_POINTS_PER_RATE_LIMIT_PROBE = 1;

export function measureBatchPointsDelta(
  before: Pick<WclRateLimitSnapshot, "pointsSpentThisHour"> | null | undefined,
  after: Pick<WclRateLimitSnapshot, "pointsSpentThisHour"> | null | undefined,
): number | null {
  if (
    before == null ||
    after == null ||
    !Number.isFinite(before.pointsSpentThisHour) ||
    !Number.isFinite(after.pointsSpentThisHour)
  ) {
    return null;
  }
  const delta = after.pointsSpentThisHour - before.pointsSpentThisHour;
  if (delta < 0) {
    // Hourly reset or clock skew — cannot trust delta as a measurement.
    return null;
  }
  return delta;
}

export function sumKnownRequestCosts(costUnits: Array<number | null | undefined>): {
  knownSum: number;
  knownCount: number;
  nullCount: number;
} {
  let knownSum = 0;
  let knownCount = 0;
  let nullCount = 0;
  for (const c of costUnits) {
    if (c == null || !Number.isFinite(c)) {
      nullCount += 1;
      continue;
    }
    knownSum += c;
    knownCount += 1;
  }
  return { knownSum, knownCount, nullCount };
}

/**
 * Resolve batch cost with precedence:
 * 1. measured — rateLimitData before/after delta
 * 2. estimated — conservative page/request estimates (and any known costUnits)
 * 3. unknown — pointsConsumed stays null (never 0)
 */
export function resolveBatchCostAccounting(input: {
  before: WclRateLimitSnapshot | null;
  after: WclRateLimitSnapshot | null;
  perRequestCostUnits: Array<number | null | undefined>;
  requestCount: number;
  pageCount: number;
  /** Conservative estimate when measurement unavailable. */
  estimatedFallback?: number | null;
}): WclBatchCostAccounting {
  const notes: string[] = [];
  const measured = measureBatchPointsDelta(input.before, input.after);
  const { knownSum, knownCount, nullCount } = sumKnownRequestCosts(input.perRequestCostUnits);

  const estimatedFromPages =
    input.estimatedFallback ??
    Math.max(
      0,
      input.pageCount * CONSERVATIVE_POINTS_PER_EVENT_PAGE +
        // Rate-limit probes around the batch
        (input.before || input.after ? 0 : 0),
    );

  if (measured != null) {
    return {
      pointsConsumed: measured,
      estimatedPointsConsumed: estimatedFromPages > 0 ? estimatedFromPages : knownSum || null,
      costSource: "measured",
      requestCount: input.requestCount,
      pageCount: input.pageCount,
      pointsSpentBefore: input.before?.pointsSpentThisHour ?? null,
      pointsSpentAfter: input.after?.pointsSpentThisHour ?? null,
      limitPerHour: input.after?.limitPerHour ?? input.before?.limitPerHour ?? null,
      notes: ["pointsConsumed from rateLimitData before/after delta"],
    };
  }

  if (nullCount === 0 && knownCount > 0) {
    notes.push("pointsConsumed from per-request extensions.rateLimit.cost");
    return {
      pointsConsumed: knownSum,
      estimatedPointsConsumed: estimatedFromPages > 0 ? estimatedFromPages : null,
      costSource: "measured",
      requestCount: input.requestCount,
      pageCount: input.pageCount,
      pointsSpentBefore: input.before?.pointsSpentThisHour ?? null,
      pointsSpentAfter: input.after?.pointsSpentThisHour ?? null,
      limitPerHour: input.after?.limitPerHour ?? input.before?.limitPerHour ?? null,
      notes,
    };
  }

  const estimated =
    knownSum +
    (nullCount > 0
      ? nullCount *
        Math.max(
          CONSERVATIVE_POINTS_PER_EVENT_PAGE,
          estimatedFromPages > 0 && input.requestCount > 0
            ? estimatedFromPages / input.requestCount
            : CONSERVATIVE_POINTS_PER_EVENT_PAGE,
        )
      : 0);

  const fallback =
    estimated > 0
      ? estimated
      : estimatedFromPages > 0
        ? estimatedFromPages
        : input.requestCount > 0
          ? input.requestCount * CONSERVATIVE_POINTS_PER_EVENT_PAGE
          : null;

  if (fallback != null && fallback > 0) {
    notes.push(
      nullCount > 0
        ? `costUnits null for ${nullCount}/${input.perRequestCostUnits.length} requests; used conservative estimate`
        : "rateLimitData delta unavailable; used conservative estimate",
    );
    return {
      pointsConsumed: fallback,
      estimatedPointsConsumed: fallback,
      costSource: "estimated",
      requestCount: input.requestCount,
      pageCount: input.pageCount,
      pointsSpentBefore: input.before?.pointsSpentThisHour ?? null,
      pointsSpentAfter: input.after?.pointsSpentThisHour ?? null,
      limitPerHour: input.after?.limitPerHour ?? input.before?.limitPerHour ?? null,
      notes,
    };
  }

  notes.push("cost unavailable: no rateLimit delta, no costUnits, no estimate basis");
  return {
    pointsConsumed: null,
    estimatedPointsConsumed: null,
    costSource: "unknown",
    requestCount: input.requestCount,
    pageCount: input.pageCount,
    pointsSpentBefore: input.before?.pointsSpentThisHour ?? null,
    pointsSpentAfter: input.after?.pointsSpentThisHour ?? null,
    limitPerHour: input.after?.limitPerHour ?? input.before?.limitPerHour ?? null,
    notes,
  };
}

/** Display helper — unknown must not render as 0. */
export function formatPointsConsumed(accounting: Pick<WclBatchCostAccounting, "pointsConsumed" | "costSource">): string {
  if (accounting.costSource === "unknown" || accounting.pointsConsumed == null) {
    return "unknown";
  }
  return `${accounting.pointsConsumed} (${accounting.costSource})`;
}

export async function fetchRateLimitSnapshot(
  client: WclGraphQlClient,
  region?: string,
): Promise<{ snapshot: WclRateLimitSnapshot | null; costUnits: number | null }> {
  const result = await client.requestPermissive<{
    rateLimitData?: {
      limitPerHour: number;
      pointsSpentThisHour: number;
      pointsResetIn?: number;
    };
  }>({
    operationName: OPERATIONS.RateLimitData.operationName,
    query: OPERATIONS.RateLimitData.query,
    region,
  });
  const raw = result.response.data?.rateLimitData;
  if (!raw) {
    return { snapshot: null, costUnits: result.costUnits };
  }
  return {
    snapshot: parseRateLimitSnapshot(raw),
    costUnits: result.costUnits,
  };
}

export class WclBatchCostTracker {
  private before: WclRateLimitSnapshot | null = null;
  private after: WclRateLimitSnapshot | null = null;
  private readonly perRequestCostUnits: Array<number | null> = [];
  private requestCount = 0;
  private pageCount = 0;

  async begin(client: WclGraphQlClient, region?: string): Promise<WclRateLimitSnapshot | null> {
    const { snapshot, costUnits } = await fetchRateLimitSnapshot(client, region);
    this.before = snapshot;
    // Rate-limit probe itself is part of the batch envelope, not event pages.
    this.recordRequest(costUnits, 0);
    return snapshot;
  }

  recordRequest(costUnits: number | null | undefined, pages = 1): void {
    this.perRequestCostUnits.push(costUnits ?? null);
    this.requestCount += 1;
    this.pageCount += Math.max(0, pages);
  }

  async end(client: WclGraphQlClient, region?: string): Promise<WclBatchCostAccounting> {
    const { snapshot, costUnits } = await fetchRateLimitSnapshot(client, region);
    this.after = snapshot;
    this.recordRequest(costUnits, 0);
    return this.finalize();
  }

  finalize(estimatedFallback?: number | null): WclBatchCostAccounting {
    return resolveBatchCostAccounting({
      before: this.before,
      after: this.after,
      perRequestCostUnits: this.perRequestCostUnits,
      requestCount: this.requestCount,
      pageCount: this.pageCount,
      estimatedFallback,
    });
  }
}
