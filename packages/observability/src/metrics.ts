type LabelValues = Record<string, string>;

interface CounterState {
  value: number;
  labels: LabelValues;
}

interface HistogramState {
  count: number;
  sum: number;
  buckets: Map<number, number>;
  labels: LabelValues;
}

export interface ProviderRequestLabels {
  provider: string;
  endpointKey: string;
  status: string;
  cacheHit: string;
}

export interface WclBudgetSnapshot {
  pointsSpent: number;
  pointsRemaining: number;
  percentUsed: number;
  warnThreshold: number;
  deferThreshold: number;
  stopThreshold: number;
  shouldWarn: boolean;
  shouldDefer: boolean;
  shouldStop: boolean;
}

export class MetricsRegistry {
  private counters = new Map<string, CounterState[]>();
  private histograms = new Map<string, HistogramState[]>();
  private readonly defaultBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

  incrementCounter(name: string, labels: LabelValues = {}, amount = 1): void {
    const entries = this.counters.get(name) ?? [];
    const existing = entries.find((e) => this.labelsMatch(e.labels, labels));
    if (existing) {
      existing.value += amount;
    } else {
      entries.push({ value: amount, labels: { ...labels } });
    }
    this.counters.set(name, entries);
  }

  observeHistogram(name: string, valueMs: number, labels: LabelValues = {}): void {
    const entries = this.histograms.get(name) ?? [];
    let existing = entries.find((e) => this.labelsMatch(e.labels, labels));
    if (!existing) {
      existing = {
        count: 0,
        sum: 0,
        buckets: new Map(this.defaultBuckets.map((b) => [b, 0])),
        labels: { ...labels },
      };
      entries.push(existing);
    }
    existing.count += 1;
    existing.sum += valueMs;
    for (const bucket of this.defaultBuckets) {
      if (valueMs <= bucket) {
        existing.buckets.set(bucket, (existing.buckets.get(bucket) ?? 0) + 1);
      }
    }
    this.histograms.set(name, entries);
  }

  recordHttpRequest(route: string, method: string, statusCode: number, durationMs: number): void {
    const labels = { route, method, status: String(statusCode) };
    this.incrementCounter("http_requests_total", labels);
    this.observeHistogram("http_request_duration_ms", durationMs, labels);
    if (statusCode >= 500) {
      this.incrementCounter("http_errors_total", labels);
    }
  }

  recordProviderRequest(input: {
    provider: string;
    endpointKey: string;
    statusCode: number | null;
    durationMs: number;
    cacheHit: boolean;
    rateLimited?: boolean;
  }): void {
    const labels: LabelValues = {
      provider: input.provider,
      endpointKey: input.endpointKey,
      status: String(input.statusCode ?? "error"),
      cacheHit: String(input.cacheHit),
    };
    this.incrementCounter("provider_requests_total", labels);
    this.observeHistogram("provider_request_duration_ms", input.durationMs, labels);
    if (input.rateLimited) {
      this.incrementCounter("provider_rate_limited_total", { provider: input.provider });
    }
    if (input.cacheHit) {
      this.incrementCounter("provider_cache_hits_total", { provider: input.provider });
    }
  }

  recordQueueDepth(queue: string, depth: number): void {
    this.incrementCounter("queue_depth_snapshot", { queue }, depth);
  }

  recordQueueFailure(queue: string): void {
    this.incrementCounter("queue_failures_total", { queue });
  }

  recordScoreCalculation(modelKey: string, modelVersion: number): void {
    this.incrementCounter("score_calculations_total", {
      modelKey,
      modelVersion: String(modelVersion),
    });
  }

  recordAddonExport(characterCount: number, sizeBytes: number): void {
    this.incrementCounter("addon_exports_total");
    this.incrementCounter("addon_export_characters_total", {}, characterCount);
    this.observeHistogram("addon_export_size_bytes", sizeBytes);
  }

  computeWclBudgetSnapshot(input: {
    pointsSpent: number;
    hourlyLimit: number;
    warnPercent: number;
    deferPercent: number;
    stopPercent: number;
  }): WclBudgetSnapshot {
    const pointsRemaining = Math.max(0, input.hourlyLimit - input.pointsSpent);
    const percentUsed = input.hourlyLimit > 0 ? (input.pointsSpent / input.hourlyLimit) * 100 : 0;
    return {
      pointsSpent: input.pointsSpent,
      pointsRemaining,
      percentUsed,
      warnThreshold: input.warnPercent,
      deferThreshold: input.deferPercent,
      stopThreshold: input.stopPercent,
      shouldWarn: percentUsed >= input.warnPercent,
      shouldDefer: percentUsed >= input.deferPercent,
      shouldStop: percentUsed >= input.stopPercent,
    };
  }

  toPrometheusText(): string {
    const lines: string[] = [];
    for (const [name, entries] of this.counters) {
      for (const entry of entries) {
        const labelStr = this.formatLabels(entry.labels);
        lines.push(`${name}${labelStr} ${entry.value}`);
      }
    }
    for (const [name, entries] of this.histograms) {
      for (const entry of entries) {
        const labelStr = this.formatLabels(entry.labels);
        for (const [bucket, count] of entry.buckets) {
          lines.push(
            `${name}_bucket${this.formatLabels({ ...entry.labels, le: String(bucket) })} ${count}`,
          );
        }
        lines.push(`${name}_count${labelStr} ${entry.count}`);
        lines.push(`${name}_sum${labelStr} ${entry.sum}`);
      }
    }
    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  private labelsMatch(a: LabelValues, b: LabelValues): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, i) => key === keysB[i] && a[key] === b[key]);
  }

  private formatLabels(labels: LabelValues): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return "";
    const pairs = keys.map((k) => `${k}="${labels[k]?.replace(/"/g, '\\"') ?? ""}"`);
    return `{${pairs.join(",")}}`;
  }
}

let globalRegistry: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!globalRegistry) {
    globalRegistry = new MetricsRegistry();
  }
  return globalRegistry;
}

export function resetMetricsRegistry(): void {
  globalRegistry = null;
}
