/**
 * Bounded WCL provider accounting for Shadow Canary diagnostics.
 * Aggregates per-slot counters into canary.diagnostics.providerAccounting.
 */

export interface ScoringProviderAccounting {
  /** HTTP/provider round-trips observed during acquisition (excludes discovery). */
  providerCalls: number;
  /** Persistent + L1 cache hits that avoided a provider fetch. */
  cacheHits: number;
  /** Requests avoided because cache/singleflight served the source. */
  avoidedRequests: number;
  /** Singleflight waiter/ready reuses (owner already persisted). */
  singleflightReuse: number;
  /** Measured/estimated WCL points; null when cost source is unknown. */
  pointsConsumed: number | null;
  /** Shared-evidence page count from bundle accounting. */
  pages: number;
  /** Raw artifact / page bytes observed during this acquisition (best-effort). */
  bytes: number;
}

export function emptyProviderAccounting(): ScoringProviderAccounting {
  return {
    providerCalls: 0,
    cacheHits: 0,
    avoidedRequests: 0,
    singleflightReuse: 0,
    pointsConsumed: null,
    pages: 0,
    bytes: 0,
  };
}

export function addProviderAccounting(
  into: ScoringProviderAccounting,
  add: Partial<ScoringProviderAccounting> | null | undefined,
): ScoringProviderAccounting {
  if (!add) return into;
  const pointsParts: number[] = [];
  if (into.pointsConsumed != null) pointsParts.push(into.pointsConsumed);
  if (add.pointsConsumed != null) pointsParts.push(add.pointsConsumed);
  return {
    providerCalls: into.providerCalls + (add.providerCalls ?? 0),
    cacheHits: into.cacheHits + (add.cacheHits ?? 0),
    avoidedRequests: into.avoidedRequests + (add.avoidedRequests ?? 0),
    singleflightReuse: into.singleflightReuse + (add.singleflightReuse ?? 0),
    pointsConsumed: pointsParts.length > 0 ? pointsParts.reduce((a, b) => a + b, 0) : null,
    pages: into.pages + (add.pages ?? 0),
    bytes: into.bytes + (add.bytes ?? 0),
  };
}

export function aggregateProviderAccounting(
  parts: Array<Partial<ScoringProviderAccounting> | null | undefined>,
): ScoringProviderAccounting {
  return parts.reduce<ScoringProviderAccounting>(
    (acc, part) => addProviderAccounting(acc, part),
    emptyProviderAccounting(),
  );
}

export function parseProviderAccounting(value: unknown): ScoringProviderAccounting | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    providerCalls: typeof row.providerCalls === "number" ? row.providerCalls : 0,
    cacheHits: typeof row.cacheHits === "number" ? row.cacheHits : 0,
    avoidedRequests: typeof row.avoidedRequests === "number" ? row.avoidedRequests : 0,
    singleflightReuse: typeof row.singleflightReuse === "number" ? row.singleflightReuse : 0,
    pointsConsumed: typeof row.pointsConsumed === "number" ? row.pointsConsumed : null,
    pages: typeof row.pages === "number" ? row.pages : 0,
    bytes: typeof row.bytes === "number" ? row.bytes : 0,
  };
}
