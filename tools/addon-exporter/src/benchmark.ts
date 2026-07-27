import { performance } from "node:perf_hooks";
import { buildExportResult } from "./export.js";
import { buildLookupKey } from "./identity.js";
import { generateSyntheticRecords } from "./synthetic.js";
import type { AddonExportContext } from "./types.js";
import { DEFAULT_ELIGIBILITY } from "./types.js";

export interface BenchmarkResult {
  characterCount: number;
  eligibleCount: number;
  shardCount: number;
  checksum: string;
  buildMs: number;
  lookupMs: number;
  lookups: number;
  estimatedLuaBytes: number;
}

export function estimateLuaBytes(result: ReturnType<typeof buildExportResult>): number {
  let bytes = 0;
  for (const [, entries] of result.shards) {
    for (const [key, record] of entries) {
      bytes += key.length + JSON.stringify(record).length + 24;
    }
  }
  return bytes;
}

export function runBenchmark(characterCount: number, generatedAt: string): BenchmarkResult {
  const context: AddonExportContext = {
    formatVersion: 1,
    generatedAt,
    region: "EU",
    seasonSlug: "season-mvp",
    scoreModelKey: "default",
    scoreModelVersion: 1,
  };

  const records = generateSyntheticRecords(characterCount, generatedAt);
  const buildStart = performance.now();
  const result = buildExportResult(records, context, DEFAULT_ELIGIBILITY);
  const buildMs = performance.now() - buildStart;

  const sample = records.slice(0, Math.min(1000, records.length));
  const lookupStart = performance.now();
  for (const record of sample) {
    const key = buildLookupKey(record.region, record.realmSlug, record.name);
    const shardPath = key.split(":")[1];
    void shardPath;
    for (const [, entries] of result.shards) {
      entries.get(key);
    }
  }
  const lookupMs = performance.now() - lookupStart;

  return {
    characterCount,
    eligibleCount: result.meta.characterCount,
    shardCount: result.shardFiles.length,
    checksum: result.meta.checksum,
    buildMs,
    lookupMs,
    lookups: sample.length,
    estimatedLuaBytes: estimateLuaBytes(result),
  };
}

export function runBenchmarkSuite(generatedAt: string): BenchmarkResult[] {
  return [10_000, 100_000].map((count) => runBenchmark(count, generatedAt));
}
