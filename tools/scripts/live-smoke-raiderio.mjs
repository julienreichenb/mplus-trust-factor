#!/usr/bin/env node
/**
 * Manual Raider.IO live smoke. Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 * Usage:
 *   pnpm live:smoke:raiderio -- --region EU --realm tarren-mill --name Example
 */
import { assertLiveCallsAllowed, requireIdentityArgs, printEnvModeSummary, printRedacted } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();
printEnvModeSummary();

const identity = requireIdentityArgs();
const baseUrl = (process.env.RAIDERIO_BASE_URL ?? "https://raider.io").replace(/\/$/, "");
const fields = [
  "gear",
  "mythic_plus_scores_by_season:current",
  "mythic_plus_ranks",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
].join(",");

const url = new URL(`${baseUrl}/api/v1/characters/profile`);
url.searchParams.set("region", identity.region.toLowerCase());
url.searchParams.set("realm", identity.realm);
url.searchParams.set("name", identity.name);
url.searchParams.set("fields", fields);
if (process.env.RAIDERIO_APP_KEY) {
  url.searchParams.set("access_key", process.env.RAIDERIO_APP_KEY);
}

const res = await fetch(url);
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 200) };
}

printRedacted("raiderio.smoke", {
  identity,
  status: res.status,
  name: body?.name ?? null,
  realm: body?.realm ?? null,
  region: body?.region ?? null,
  profileUrl: body?.profile_url ?? null,
  score: body?.mythic_plus_scores_by_season?.[0]?.scores?.all ?? null,
});

if (!res.ok && res.status !== 404) {
  process.exit(1);
}

console.log("OK");
