/**
 * Live cost probe for encounterRankings-first discoverCharacterRuns.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-encounter-discovery-cost.mjs
 */
import { createWarcraftLogsProvider } from "../../packages/providers/warcraftlogs/dist/index.js";

const ACTIVE = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
];

function envFlag(v, d = false) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}

async function main() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("FAIL: ALLOW_LIVE_PROVIDER_CALLS must be true");
    process.exit(1);
  }
  const env = {
    WCL_CLIENT_ID: process.env.WCL_CLIENT_ID,
    WCL_CLIENT_SECRET: process.env.WCL_CLIENT_SECRET,
    WCL_PUBLIC_GRAPHQL_URL:
      process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
    WCL_TOKEN_URL: process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
    WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
    WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
    WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
    WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43200),
  };

  // Instrument fetch to count GraphQL POSTs (excluding token).
  const origFetch = globalThis.fetch;
  let graphqlPosts = 0;
  const opNames = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("warcraftlogs.com/api/v2/client") && init?.method === "POST") {
      graphqlPosts += 1;
      try {
        const body = JSON.parse(init.body);
        opNames.push(body.operationName ?? "?");
      } catch {
        opNames.push("?");
      }
    }
    return origFetch(input, init);
  };

  const provider = createWarcraftLogsProvider("live", env, { zoneId: 47 });
  const identity = { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" };
  const ctx = {
    region: "EU",
    requestId: `er-cost-${Date.now()}`,
    correlationId: null,
    forceRefresh: true,
    now: new Date().toISOString(),
    targetCharacter: identity,
    wclActiveDungeonSlugs: ACTIVE,
  };

  const discovery = await provider.discoverCharacter(identity, ctx);
  const runsResult = await provider.discoverCharacterRuns(identity, ctx);
  const runs = runsResult.data ?? [];
  const timedByDungeon = {};
  for (const slug of ACTIVE) timedByDungeon[slug] = [];
  for (const r of runs) {
    const slug = r.dungeonSlug?.toLowerCase?.() ?? r.dungeonSlug;
    if (!slug || !(slug in timedByDungeon)) continue;
    if (r.timed === true) {
      timedByDungeon[slug].push(`${r.reportCode}:${r.fightId}:k${r.keyLevel}`);
    }
  }

  const warnings = discovery.summary?.warnings ?? [];
  console.log(
    JSON.stringify(
      {
        graphqlPosts,
        opNames,
        candidateCount: discovery.candidates?.length ?? 0,
        fightKnown: (discovery.candidates ?? []).filter((c) => !c.incompleteness.fightUnknown)
          .length,
        fightUnknown: (discovery.candidates ?? []).filter((c) => c.incompleteness.fightUnknown)
          .length,
        runCount: runs.length,
        timedRuns: runs.filter((r) => r.timed === true).length,
        timedByDungeon,
        warnings: warnings.filter((w) => /encounterRankings|recentReports|hydration/i.test(w)),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
