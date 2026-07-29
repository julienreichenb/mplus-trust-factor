/**
 * Survival V1.1 CLI — health-source discovery + scoring.
 *
 * Live (requires ALLOW_LIVE_PROVIDER_CALLS + WCL credentials):
 *   pnpm wcl:probe:survival:v1.1 -- --region EU --realm archimonde --name Wallidrixe \
 *     --input-dir raw-artifacts/wcl-probe-survival-calibration/eu-archimonde-wallidrixe
 *
 * Offline re-score from discovery cache:
 *   pnpm wcl:probe:survival:v1.1 -- --input-dir ... --discovery-cache .../11b-discovery-cache.json
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import {
  loadCalibrationSummary,
  runSurvivalV1_1Pipeline,
} from "./survival-v1_1-score.js";
import type { SurvivalProbeIdentity } from "./survival-probe-types.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]): {
  identity: SurvivalProbeIdentity | null;
  inputDir: string;
  outputDir: string | null;
  discoveryCache: string | null;
  reprocessRawDir: string | null;
  offlineOnly: boolean;
} {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      if (key === "offline-only") {
        flags[key] = "true";
        continue;
      }
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = next;
    i += 1;
  }

  const inputDir = flags["input-dir"]?.trim();
  if (!inputDir) {
    throw new Error(
      "Usage: --input-dir <calibration-dir> [--region EU --realm slug --name Name] [--output-dir path] [--discovery-cache path] [--reprocess-raw-dir path] [--offline-only]",
    );
  }

  const region = flags.region?.trim().toUpperCase();
  const realmSlug = flags.realm?.trim().toLowerCase();
  const name = flags.name?.trim();
  const identity =
    region && realmSlug && name
      ? ({
          region: region as SurvivalProbeIdentity["region"],
          realmSlug,
          name,
        } satisfies SurvivalProbeIdentity)
      : null;

  return {
    identity,
    inputDir,
    outputDir: flags["output-dir"]?.trim() || null,
    discoveryCache: flags["discovery-cache"]?.trim() || null,
    reprocessRawDir: flags["reprocess-raw-dir"]?.trim() || null,
    offlineOnly: envFlag(flags["offline-only"], false),
  };
}

async function zipDirectoryContents(sourceDir: string, zipPath: string): Promise<void> {
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
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const calibration = await loadCalibrationSummary(args.inputDir);
  const identity =
    args.identity ??
    ({
      region: calibration.identity.region,
      realmSlug: calibration.identity.realmSlug,
      name: calibration.identity.name,
    } satisfies SurvivalProbeIdentity);

  const outputDir =
    args.outputDir ??
    join(
      process.cwd(),
      "raw-artifacts",
      "wcl-probe-survival-v1_1",
      `${identity.region.toLowerCase()}-${identity.realmSlug}-${identity.name.toLowerCase()}`,
    );
  mkdirSync(outputDir, { recursive: true });

  // Load V1 comparison if present beside calibration
  let v1GlobalScore: number | null = null;
  let v1PerDungeon: Array<{ dungeonSlug: string; medianScore: number | null }> = [];
  try {
    const { readFile } = await import("node:fs/promises");
    const globalPath = join(args.inputDir, "09-survival-v1-global.json");
    const perDungeonPath = join(args.inputDir, "08-survival-v1-per-dungeon.json");
    const g = JSON.parse(await readFile(globalPath, "utf8")) as { score?: number | null };
    const p = JSON.parse(await readFile(perDungeonPath, "utf8")) as Array<{
      dungeonSlug: string;
      medianScore: number | null;
    }>;
    v1GlobalScore = g.score ?? null;
    v1PerDungeon = p;
  } catch {
    // optional
  }

  let client: ReturnType<LiveWarcraftLogsProvider["getGraphQlClient"]> | undefined;
  const canSkipLive = Boolean(args.discoveryCache || args.reprocessRawDir || args.offlineOnly);
  if (!canSkipLive) {
    if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
      console.error(
        "REFUSED: live health discovery requires ALLOW_LIVE_PROVIDER_CALLS=true (or pass --discovery-cache / --reprocess-raw-dir / --offline-only).",
      );
      process.exit(2);
    }
    const clientId = process.env.WCL_CLIENT_ID ?? "";
    const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
    if (!clientId || !clientSecret) {
      console.error("FAIL: WCL_CLIENT_ID and WCL_CLIENT_SECRET are required for live discovery.");
      process.exit(2);
    }
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
      logger: console,
    });
    client = provider.getGraphQlClient();
  }

  const { dataset, outputFiles } = await runSurvivalV1_1Pipeline({
    calibration: {
      ...calibration,
      identity,
    },
    outputDir,
    client,
    discoveryCachePath: args.discoveryCache ?? undefined,
    reprocessRawDir: args.reprocessRawDir ?? undefined,
    v1GlobalScore,
    v1PerDungeon,
  });

  // Also copy key calibration artifacts into output for combined ZIP convenience
  const zipPath = join(
    outputDir,
    `${identity.region.toLowerCase()}-${identity.realmSlug}-${identity.name.toLowerCase()}-survival-v1.1.zip`,
  );
  await zipDirectoryContents(outputDir, zipPath);

  const nonFatal = dataset.dangerWindows.filter((w) => w.windowClass === "NON_FATAL_PRESSURE");
  const fatal = dataset.dangerWindows.filter((w) => w.windowClass === "FATAL_PRESSURE");

  console.log("wcl.probe.survival.v1.1");
  console.log(
    JSON.stringify(
      {
        configVersion: dataset.config.version,
        runsWithResolvedMaxHp: dataset.diagnostics.runsWithResolvedMaxHp,
        maxHpSources: dataset.maxHpResolutions
          .filter((r) => r.maxHp != null)
          .map((r) => ({
            runId: r.runId,
            maxHp: r.maxHp,
            source: r.maxHpSource,
            path: r.sourcePayloadPath,
            confidence: r.maxHpConfidence,
          })),
        windowCounts: {
          nonFatal: dataset.diagnostics.nonFatalDangerWindowCount,
          fatal: dataset.diagnostics.fatalDangerWindowCount,
          deathOnly: dataset.diagnostics.deathOnlyWindowCount,
        },
        defensiveCounts: dataset.diagnostics.defensiveCounts,
        recoveryCounts: dataset.diagnostics.recoveryCounts,
        windowsRejectedInsufficientReactionTime:
          dataset.diagnostics.windowsRejectedInsufficientReactionTime,
        outcomeOnlyScore: dataset.global.outcomeOnlyScore,
        behavioralSurvivalScore: dataset.global.behavioralSurvivalScore,
        scoreMode: dataset.global.scoreMode,
        comparisonVsV1: dataset.comparisonVsV1,
        sampleNonFatalWindows: nonFatal.slice(0, 3).map((w) => ({
          windowId: w.windowId,
          triggers: w.triggerTypes,
          reactionEligible: w.reactionEligible,
          defensive: w.defensiveCoverageKind,
          recovery: w.recoveryCoverageKind,
          maxHp: w.maximumHp,
          minHp: w.minimumHp,
        })),
        sampleFatalWindows: fatal.slice(0, 3).map((w) => ({
          windowId: w.windowId,
          triggers: w.triggerTypes,
          reactionIntervalMs: w.reactionIntervalMs,
          reactionEligible: w.reactionEligible,
          defensive: w.defensiveCoverageKind,
          recovery: w.recoveryCoverageKind,
        })),
        requestCost: dataset.diagnostics.requestCost,
        outputFiles,
        zipPath,
      },
      null,
      2,
    ),
  );
  console.log("OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
