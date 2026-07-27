#!/usr/bin/env node
/**
 * Lightweight load test against local API using fixture/cached endpoints.
 * No external API credentials required.
 *
 * Usage: node tools/scripts/load-test.mjs [--url http://localhost:3000] [--duration 10]
 */
import autocannon from "autocannon";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const baseUrl = getArg("--url", process.env.PUBLIC_BASE_URL ?? "http://localhost:3000");
const duration = Number(getArg("--duration", "10"));

const targets = [
  { name: "health/live", path: "/health/live" },
  { name: "api/v1/meta", path: "/api/v1/meta" },
];

const results = [];

for (const target of targets) {
  const url = `${baseUrl.replace(/\/$/, "")}${target.path}`;
  console.log(`Load testing ${url} for ${duration}s...`);
  const result = await autocannon({
    url,
    connections: 10,
    duration,
    pipelining: 1,
  });
  results.push({ target: target.name, ...result });
  console.log(
    `${target.name}: p99=${result.latency.p99}ms mean=${result.latency.mean}ms req/s=${result.requests.average} errors=${result.errors}`,
  );
}

const health = results.find((r) => r.target === "health/live");
const meta = results.find((r) => r.target === "api/v1/meta");

const healthP99 = health?.latency?.p99 ?? Infinity;
const metaP99 = meta?.latency?.p99 ?? Infinity;

// Provisional MVP targets from Agent 9 plan (local dev; autocannon reports p99 not p95)
const healthOk = healthP99 < 300;
const metaOk = metaP99 < 300;

console.log("\n--- Summary ---");
console.log(JSON.stringify({ healthP99, metaP99, healthOk, metaOk }, null, 2));

if (!healthOk || !metaOk) {
  console.warn("Load targets not met on this host — review hardware/noise.");
}

process.exitCode = health?.errors > 0 || meta?.errors > 0 ? 1 : 0;
