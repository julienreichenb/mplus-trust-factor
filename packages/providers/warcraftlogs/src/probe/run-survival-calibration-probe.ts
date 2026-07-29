/**
 * Read-only Warcraft Logs Survival calibration probe CLI.
 *
 * Usage:
 *   pnpm wcl:probe:survival:calibration -- --region EU --realm archimonde --name Wallidrixe
 *
 * Collects up to 3 usable logged runs per active-season dungeon for formula calibration.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import { runSurvivalCalibrationProbe } from "./survival-calibration-probe.js";
import type { SurvivalProbeIdentity } from "./survival-probe-types.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(
  argv: string[],
): SurvivalProbeIdentity & {
  outputDir: string;
  maxRunsPerDungeon: number;
  maxReportsInspectedPerDungeon: number;
} {
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
      "Usage: --region <EU|US|KR|TW> --realm <slug> --name <exact-name> [--output-dir <path>] [--max-runs-per-dungeon 3] [--max-reports-per-dungeon 8]",
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
      "wcl-probe-survival-calibration",
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
    );

  return {
    region: region as SurvivalProbeIdentity["region"],
    realmSlug,
    name,
    outputDir,
    maxRunsPerDungeon: Number(flags["max-runs-per-dungeon"] ?? 3),
    maxReportsInspectedPerDungeon: Number(flags["max-reports-per-dungeon"] ?? 8),
  };
}

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: survival calibration probe requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
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

  const { dataset, outputFiles } = await runSurvivalCalibrationProbe({
    identity: {
      region: args.region,
      realmSlug: args.realmSlug,
      name: args.name,
    },
    outputDir: args.outputDir,
    client: provider.getGraphQlClient(),
    zoneConfig: provider.getZoneConfig(),
    maxRunsPerDungeon: args.maxRunsPerDungeon,
    maxReportsInspectedPerDungeon: args.maxReportsInspectedPerDungeon,
  });

  console.log("wcl.probe.survival.calibration");
  console.log(
    JSON.stringify(
      {
        identity: dataset.identity,
        state: dataset.state,
        runCount: dataset.runs.length,
        perDungeon: dataset.perDungeon.map((d) => ({
          dungeonSlug: d.dungeonSlug,
          runCount: d.runCount,
          deathRateMedian: d.deathRateMedian,
          damageTakenPerMinuteMedian: d.damageTakenPerMinuteMedian,
        })),
        global: dataset.global,
        cost: dataset.diagnostics.cost,
        rejectedCount: dataset.diagnostics.runsRejected.length,
        outputDir: args.outputDir,
        outputFileCount: Object.keys(outputFiles).length,
      },
      null,
      2,
    ),
  );

  if (dataset.state === "ERROR") {
    console.error("FAIL: Survival calibration probe state=ERROR.");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
