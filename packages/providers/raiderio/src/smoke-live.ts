/**
 * Optional live smoke — never invoked by unit tests or CI.
 * Usage (PowerShell):
 *   $env:ALLOW_LIVE_PROVIDER_CALLS="true"
 *   node packages/providers/raiderio/dist/smoke-live.js
 *
 * Works without RAIDERIO_APP_KEY within documented public limits (200 req/min).
 * Identity overrides: RAIDERIO_SMOKE_REGION / RAIDERIO_SMOKE_REALM / RAIDERIO_SMOKE_NAME
 */
import { LiveRaiderIoProvider } from "./live-provider.js";
import { RaiderIoHttpClient } from "./http-client.js";

async function main(): Promise<void> {
  if (process.env.ALLOW_LIVE_PROVIDER_CALLS !== "true") {
    console.log("SKIP live smoke: set ALLOW_LIVE_PROVIDER_CALLS=true to opt in.");
    process.exit(0);
  }

  const appKey = process.env.RAIDERIO_APP_KEY?.trim() || undefined;
  const http = new RaiderIoHttpClient({
    baseUrl: process.env.RAIDERIO_BASE_URL ?? "https://raider.io",
    appKey,
    softRpm: Number(process.env.RAIDERIO_SOFT_RPM ?? 60),
    maxConcurrency: Number(process.env.RAIDERIO_REQUEST_CONCURRENCY ?? 2),
  });

  const provider = new LiveRaiderIoProvider({
    http,
    env: {
      RAIDERIO_CHARACTER_TTL_SECONDS: 43_200,
      RAIDERIO_NEGATIVE_CACHE_SECONDS: 2700,
      RAIDERIO_CUTOFFS_TTL_SECONDS: 86_400,
      RAIDERIO_STATIC_DATA_TTL_SECONDS: 604_800,
    },
  });

  const region = (process.env.RAIDERIO_SMOKE_REGION?.toUpperCase() as "EU" | "US" | "KR" | "TW") ?? "EU";
  const realmSlug = process.env.RAIDERIO_SMOKE_REALM ?? "silvermoon";
  const name = process.env.RAIDERIO_SMOKE_NAME ?? "Pin";

  const ctx = {
    region,
    requestId: "smoke-live-raiderio",
    correlationId: null,
    forceRefresh: true,
    now: new Date().toISOString(),
  };

  console.log("raiderio smoke identity", {
    region,
    realmSlug,
    name,
    appKeyConfigured: Boolean(appKey),
  });

  const profile = await provider.getCharacterProfile({ region, realmSlug, name }, ctx);
  console.log("profile", {
    displayName: profile.data.displayName,
    score: profile.data.currentSeason?.scores.all ?? null,
    ranksOverall: profile.data.ranks?.overall ?? null,
    gearIlvl: profile.data.gear?.itemLevelEquipped ?? null,
    crawlStale: profile.data.crawlStale,
    profileUrl: profile.data.profileUrl,
    attribution: profile.data.attribution.displayText,
    recentRuns: profile.data.recentRuns.length,
    bestRuns: profile.data.bestRuns.length,
  });

  const cutoffs = await provider.getSeasonCutoffs(region, "", ctx);
  console.log("season-cutoffs capability", provider.getCapabilities().seasonCutoffs, {
    top25: cutoffs.data.top25Percent?.score ?? null,
  });

  const staticData = await provider.getStaticData(ctx);
  console.log("static-data", {
    expansionId: staticData.data.expansionId,
    seasons: staticData.data.seasons.slice(0, 3).map((s) => s.slug),
    expansionResolution: provider.getExpansionResolution(),
  });

  if (profile.data.bestRuns[0]) {
    const run = profile.data.bestRuns[0];
    const details = await provider.getRunDetails(run.seasonSlug, run.externalRunId, ctx);
    console.log("run-details", {
      externalRunId: details.data.externalRunId,
      rosterRegions: [...new Set(details.data.roster.map((m) => m.region))],
      profileUrl: details.data.profileUrl,
    });
  }

  console.log("OK raiderio live smoke");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
