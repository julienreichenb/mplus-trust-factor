/**
 * Read-only Warcraft Logs Performance probe CLI.
 *
 * Usage:
 *   pnpm wcl:probe:performance -- --region EU --realm archimonde --name Wallidrixe
 *
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true. Never invoked by CI.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import { runPerformanceProbe } from "./performance-probe.js";
import type { PerformanceProbeIdentity } from "./types.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]): PerformanceProbeIdentity & { outputDir: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = next;
    i += 1;
  }

  const region = String(flags.region ?? "").trim().toUpperCase();
  const realmSlug = String(flags.realm ?? "").trim().toLowerCase();
  const name = String(flags.name ?? "").trim();
  if (!region || !realmSlug || !name) {
    throw new Error(
      "Usage: --region <EU|US|KR|TW> --realm <slug> --name <exact-name> [--output-dir <path>]",
    );
  }
  if (!["EU", "US", "KR", "TW"].includes(region)) {
    throw new Error(`Unsupported region "${region}"`);
  }

  const outputDir =
    flags["output-dir"]?.trim() ||
    join(
      process.cwd(),
      "raw-artifacts",
      "wcl-probe-performance",
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
    );

  return {
    region: region as PerformanceProbeIdentity["region"],
    realmSlug,
    name,
    outputDir,
  };
}

function printSummary(
  dataset: Awaited<ReturnType<typeof runPerformanceProbe>>["dataset"],
  outputFiles: Awaited<ReturnType<typeof runPerformanceProbe>>["outputFiles"],
): void {
  console.log("wcl.probe.performance");
  console.log(
    JSON.stringify(
      {
        identity: dataset.identity,
        character: dataset.character
          ? {
              id: dataset.character.id,
              canonicalID: dataset.character.canonicalID,
              hidden: dataset.character.hidden,
            }
          : null,
        zone: {
          zoneId: dataset.zone.config.zoneId,
          name: dataset.zone.worldData?.name ?? null,
          encounterCount: dataset.zone.worldData?.encounters.length ?? 0,
        },
        reports: dataset.paginationDiagnostics,
        eligibleLoggedRuns: dataset.eligibleLoggedRuns.length,
        selectedHighestRatedRuns: dataset.selectedHighestRatedRuns.map((run) => ({
          encounterID: run.encounterID,
          dungeonSlug: run.dungeonSlug,
          rating: run.rating,
          keystoneLevel: run.keystoneLevel,
          keystoneTime: run.keystoneTime,
          reportCode: run.reportCode,
          fightID: run.fightID,
        })),
        unavailableEncounters: dataset.unavailableEncounters,
        graphqlErrorCount: dataset.graphqlErrors.length,
        rateLimit: {
          initialUtilization:
            dataset.rateLimit.initial && dataset.rateLimit.initial.limitPerHour > 0
              ? (
                  (dataset.rateLimit.initial.pointsSpentThisHour /
                    dataset.rateLimit.initial.limitPerHour) *
                  100
                ).toFixed(1)
              : null,
          finalUtilization:
            dataset.rateLimit.final && dataset.rateLimit.final.limitPerHour > 0
              ? (
                  (dataset.rateLimit.final.pointsSpentThisHour /
                    dataset.rateLimit.final.limitPerHour) *
                  100
                ).toFixed(1)
              : null,
        },
        outputFiles,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: performance probe requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
    process.exit(2);
  }

  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.error("FAIL: WCL_CLIENT_ID and WCL_CLIENT_SECRET are required.");
    process.exit(1);
  }

  mkdirSync(args.outputDir, { recursive: true });

  const provider = new LiveWarcraftLogsProvider({
    env: {
      WCL_CLIENT_ID: clientId,
      WCL_CLIENT_SECRET: clientSecret,
      WCL_PUBLIC_GRAPHQL_URL:
        process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
      WCL_TOKEN_URL: process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
      WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
      WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
      WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
      WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200),
    },
    processEnv: process.env,
  });

  const client = provider.getGraphQlClient();

  const { dataset, outputFiles } = await runPerformanceProbe({
    identity: {
      region: args.region,
      realmSlug: args.realmSlug,
      name: args.name,
    },
    outputDir: args.outputDir,
    client,
    zoneConfig: provider.getZoneConfig(),
  });

  printSummary(dataset, outputFiles);
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
