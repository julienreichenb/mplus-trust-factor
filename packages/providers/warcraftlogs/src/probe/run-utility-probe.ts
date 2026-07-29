/**
 * Read-only Warcraft Logs Utility probe CLI.
 *
 * Usage:
 *   pnpm wcl:probe:utility -- --region EU --realm archimonde --name Wallidrixe
 *
 * Collects up to 3 usable logged runs per active-season dungeon for interrupt / CC /
 * dispel-purge / group-utility diagnostic evidence. No Utility score is calculated.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import { runUtilityProbe } from "./utility-probe.js";
import type { UtilityProbeIdentity } from "./utility-probe-types.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(
  argv: string[],
): UtilityProbeIdentity & {
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
      "wcl-probe-utility",
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
    );

  return {
    region: region as UtilityProbeIdentity["region"],
    realmSlug,
    name,
    outputDir,
    maxRunsPerDungeon: Number(flags["max-runs-per-dungeon"] ?? 3),
    maxReportsInspectedPerDungeon: Number(flags["max-reports-per-dungeon"] ?? 8),
  };
}

function zipDirectoryContents(sourceDir: string, zipPath: string): void {
  if (process.platform === "win32") {
    const ps = `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`Compress-Archive failed with status ${result.status}`);
    }
    return;
  }
  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], {
    stdio: "inherit",
  });
  if (tar.status !== 0) throw new Error("Failed to create ZIP");
}

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: utility probe requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
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

  const { dataset, outputFiles } = await runUtilityProbe({
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

  const zipPath = join(
    args.outputDir,
    `${args.region.toLowerCase()}-${args.realmSlug}-${args.name.toLowerCase()}-utility-probe.zip`,
  );
  zipDirectoryContents(args.outputDir, zipPath);

  console.log("wcl.probe.utility");
  console.log(
    JSON.stringify(
      {
        identity: dataset.identity,
        state: dataset.state,
        usableRunCount: dataset.runs.length,
        interrupts: dataset.diagnostics.successfulUses.interrupts,
        interruptOpportunities: dataset.diagnostics.candidateOpportunities.interrupt,
        crowdControl: dataset.diagnostics.successfulUses.cc,
        dispels: dataset.diagnostics.successfulUses.dispels,
        purges: dataset.diagnostics.successfulUses.purges,
        externalGroupUtility: dataset.diagnostics.successfulUses.externalGroupUtility,
        classSpecific: dataset.diagnostics.successfulUses.classSpecific,
        unmatchedSpellIds: dataset.diagnostics.catalogMatches.unmatchedSpellIds,
        perDungeon: dataset.perDungeon.map((d) => ({
          dungeonSlug: d.dungeonSlug,
          runCount: d.runCount,
          successfulInterruptsMedian: d.successfulInterruptsMedian,
          ccUsesMedian: d.ccUsesMedian,
          dispelsPurgesMedian: d.dispelsPurgesMedian,
        })),
        reliabilityAssessment: dataset.global.reliabilityAssessment,
        cost: dataset.diagnostics.cost,
        rejectedCount: dataset.diagnostics.candidateRunsRejected.length,
        outputDir: args.outputDir,
        outputFileCount: Object.keys(outputFiles).length,
        zipPath,
      },
      null,
      2,
    ),
  );

  if (dataset.state === "ERROR") {
    console.error("FAIL: Utility probe state=ERROR.");
    process.exit(1);
  }
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
