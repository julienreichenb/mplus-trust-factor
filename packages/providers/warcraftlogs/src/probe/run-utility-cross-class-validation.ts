/**
 * Cross-class Utility V3 validation CLI.
 *
 * For each character in the input manifest:
 *   1. Run the full utility probe (live WCL calls) to collect raw artifacts.
 *   2. Run the V3 simulation offline on those artifacts.
 *   3. Resolve classSlug / specSlug / role from provider output — never hardcoded.
 *
 * Usage:
 *   pnpm wcl:probe:utility:cross-class-validate -- \
 *     --characters-file tools/fixtures/cross-class-validation-characters.json \
 *     [--output-root raw-artifacts/wcl-probe-utility] \
 *     [--max-runs-per-dungeon 3] \
 *     [--max-reports-per-dungeon 8]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import { runUtilityProbe } from "./utility-probe.js";
import { runUtilityV3Simulation } from "./utility-v3-simulation.js";
import { classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { UtilityProbeIdentity } from "./utility-probe-types.js";
import type { UtilityV3SimulationDataset } from "./utility-v3-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CharacterManifestEntry {
  region: string;
  realm: string;
  name: string;
  /** Informational label — never used for scoring logic. */
  role?: string;
}

interface CharacterValidationResult {
  region: string;
  realmSlug: string;
  name: string;
  /** Resolved from the WCL provider via classID → classSlug. */
  classSlug: string | null;
  /** Resolved from zoneRankings spec field — most common spec across selected runs. */
  specSlug: string | null;
  /** Resolved from zoneRankings role field. */
  roleSlug: string | null;
  state: "OK" | "PARTIAL" | "ERROR" | "SKIPPED";
  behaviorScore: number | null;
  confidence: number | null;
  semanticBand: string | null;
  domainScores: Record<string, number | null>;
  redistributedWeights: Record<string, number>;
  scoredVsExcludedDomains: UtilityV3SimulationDataset["global"]["scoredVsExcludedDomains"] | null;
  runCount: number;
  dungeonCount: number;
  artifactDir: string;
  error: string | null;
}

interface CrossClassValidationReport {
  validatedAt: string;
  calibrationCharacter: string;
  characters: CharacterValidationResult[];
  summary: {
    total: number;
    ok: number;
    partial: number;
    error: number;
    skipped: number;
    classSlugsResolved: string[];
    specSlugsResolved: string[];
    behaviorScoreRange: { min: number | null; max: number | null };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseArgs(argv: string[]): {
  charactersFile: string;
  outputRoot: string;
  maxRunsPerDungeon: number;
  maxReportsPerDungeon: number;
} {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    flags[key] = next;
    i += 1;
  }
  const charactersFile = flags["characters-file"]?.trim();
  if (!charactersFile) {
    throw new Error(
      "Usage: --characters-file <path.json> [--output-root <dir>] [--max-runs-per-dungeon 3] [--max-reports-per-dungeon 8]",
    );
  }
  return {
    charactersFile,
    outputRoot: flags["output-root"]?.trim() || join(process.cwd(), "raw-artifacts", "wcl-probe-utility"),
    maxRunsPerDungeon: Number(flags["max-runs-per-dungeon"] ?? 3),
    maxReportsPerDungeon: Number(flags["max-reports-per-dungeon"] ?? 8),
  };
}

function zipDirectoryContents(sourceDir: string, zipPath: string): void {
  if (process.platform === "win32") {
    const ps = `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Compress-Archive failed (status ${result.status})`);
    return;
  }
  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error("Failed to create ZIP");
}

/**
 * Derive the most frequently occurring spec slug across all normalized runs.
 * This is what the provider resolved from WCL `zoneRankings.spec` — not hardcoded.
 */
function dominantSpecSlug(runsJson: unknown): string | null {
  if (!Array.isArray(runsJson)) return null;
  const counts = new Map<string, number>();
  for (const run of runsJson) {
    const spec = (run as Record<string, unknown>).specialization;
    if (typeof spec === "string" && spec) {
      counts.set(spec, (counts.get(spec) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [slug, count] of counts) {
    if (count > bestCount) {
      best = slug;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Derive the most frequently occurring role slug across normalized runs.
 */
function dominantRoleSlug(runsJson: unknown): string | null {
  if (!Array.isArray(runsJson)) return null;
  const counts = new Map<string, number>();
  for (const run of runsJson) {
    const role = (run as Record<string, unknown>).roleSlug;
    if (typeof role === "string" && role) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [slug, count] of counts) {
    if (count > bestCount) {
      best = slug;
      bestCount = count;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Core validation runner
// ---------------------------------------------------------------------------

async function validateCharacter(
  entry: CharacterManifestEntry,
  outputRoot: string,
  provider: LiveWarcraftLogsProvider,
  maxRunsPerDungeon: number,
  maxReportsPerDungeon: number,
): Promise<CharacterValidationResult> {
  const region = entry.region.trim().toUpperCase();
  const realmSlug = entry.realm.trim().toLowerCase();
  const name = entry.name.trim();
  const artifactDir = join(
    outputRoot,
    `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
  );

  const base: Omit<CharacterValidationResult, "behaviorScore" | "confidence" | "semanticBand" | "domainScores" | "redistributedWeights" | "scoredVsExcludedDomains" | "runCount" | "dungeonCount" | "error"> = {
    region,
    realmSlug,
    name,
    classSlug: null,
    specSlug: null,
    roleSlug: null,
    state: "ERROR",
    artifactDir,
  };

  try {
    mkdirSync(artifactDir, { recursive: true });

    // Step 1 — Utility probe (live WCL calls, writes artifact files)
    const identity: UtilityProbeIdentity = {
      region: region as UtilityProbeIdentity["region"],
      realmSlug,
      name,
    };

    const { dataset: probeDataset } = await runUtilityProbe({
      identity,
      outputDir: artifactDir,
      client: provider.getGraphQlClient(),
      zoneConfig: provider.getZoneConfig(),
      maxRunsPerDungeon,
      maxReportsInspectedPerDungeon: maxReportsPerDungeon,
    });

    // Resolve classSlug from provider — uses WCL character.classID → classSlugFromWclClassId
    const resolvedClassSlug = classSlugFromWclClassId(probeDataset.character?.classID ?? null);

    // Resolve specSlug and roleSlug from normalized runs (WCL zoneRankings)
    let resolvedSpecSlug: string | null = null;
    let resolvedRoleSlug: string | null = null;
    try {
      const runsJson = JSON.parse(
        await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
      );
      resolvedSpecSlug = dominantSpecSlug(runsJson);
      resolvedRoleSlug = dominantRoleSlug(runsJson);
    } catch {
      resolvedSpecSlug = probeDataset.runs[0]?.specialization ?? null;
    }

    // Also zip probe artifacts
    const probeZipPath = join(
      artifactDir,
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-probe.zip`,
    );
    zipDirectoryContents(artifactDir, probeZipPath);

    if (probeDataset.state === "ERROR") {
      return {
        ...base,
        classSlug: resolvedClassSlug,
        specSlug: resolvedSpecSlug,
        roleSlug: resolvedRoleSlug,
        state: "ERROR",
        behaviorScore: null,
        confidence: null,
        semanticBand: null,
        domainScores: {},
        redistributedWeights: {},
        scoredVsExcludedDomains: null,
        runCount: 0,
        dungeonCount: 0,
        error: "Utility probe returned state=ERROR",
      };
    }

    // Step 2 — V3 simulation (offline on artifacts just written)
    const { dataset: v3Dataset } = await runUtilityV3Simulation({
      inputDir: artifactDir,
      outputDir: artifactDir,
    });

    const v3ZipPath = join(
      artifactDir,
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-v3-simulation.zip`,
    );
    zipDirectoryContents(artifactDir, v3ZipPath);

    // classSlug / specSlug sourced from V3 subject (which itself reads from normalized runs)
    const finalClassSlug = v3Dataset.subject.classSlug ?? resolvedClassSlug;
    const finalSpecSlug = v3Dataset.subject.specSlug ?? resolvedSpecSlug;

    return {
      ...base,
      classSlug: finalClassSlug,
      specSlug: finalSpecSlug,
      roleSlug: resolvedRoleSlug,
      state: probeDataset.state === "PARTIAL" ? "PARTIAL" : "OK",
      behaviorScore: v3Dataset.global.behaviorScore,
      confidence: v3Dataset.global.confidence,
      semanticBand: v3Dataset.global.semanticBand,
      domainScores: v3Dataset.global.domainScores as Record<string, number | null>,
      redistributedWeights: v3Dataset.global.redistributedWeights as Record<string, number>,
      scoredVsExcludedDomains: v3Dataset.global.scoredVsExcludedDomains,
      runCount: v3Dataset.global.runCount,
      dungeonCount: v3Dataset.global.dungeonCount,
      error: null,
    };
  } catch (err) {
    return {
      ...base,
      classSlug: null,
      specSlug: null,
      roleSlug: null,
      state: "ERROR",
      behaviorScore: null,
      confidence: null,
      semanticBand: null,
      domainScores: {},
      redistributedWeights: {},
      scoredVsExcludedDomains: null,
      runCount: 0,
      dungeonCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: cross-class validation requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
    process.exit(2);
  }

  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.error("FAIL: WCL_CLIENT_ID and WCL_CLIENT_SECRET are required.");
    process.exit(1);
  }

  let characters: CharacterManifestEntry[];
  try {
    characters = JSON.parse(readFileSync(args.charactersFile, "utf8")) as CharacterManifestEntry[];
    if (!Array.isArray(characters) || characters.length === 0) {
      throw new Error("characters-file must be a non-empty JSON array");
    }
  } catch (err) {
    console.error(`FAIL: cannot read characters file: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
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
  });

  console.log(`wcl.probe.utility.cross-class-validate — ${characters.length} characters`);

  const results: CharacterValidationResult[] = [];

  for (const entry of characters) {
    const label = `${entry.region.toUpperCase()}/${entry.realm}/${entry.name}`;
    console.log(`\n[${results.length + 1}/${characters.length}] ${label}`);
    const result = await validateCharacter(
      entry,
      args.outputRoot,
      provider,
      args.maxRunsPerDungeon,
      args.maxReportsPerDungeon,
    );
    results.push(result);
    console.log(
      `  → state=${result.state} class=${result.classSlug ?? "?"} spec=${result.specSlug ?? "?"} ` +
      `score=${result.behaviorScore ?? "null"} confidence=${result.confidence ?? "null"}`,
    );
  }

  // Build cross-class report
  const scored = results.filter((r) => r.behaviorScore !== null).map((r) => r.behaviorScore as number);
  const calibration = characters.find((c) => (c.role ?? "validation") === "calibration");

  const report: CrossClassValidationReport = {
    validatedAt: new Date().toISOString(),
    calibrationCharacter: calibration ? `${calibration.region.toUpperCase()}/${calibration.realm}/${calibration.name}` : "unknown",
    characters: results,
    summary: {
      total: results.length,
      ok: results.filter((r) => r.state === "OK").length,
      partial: results.filter((r) => r.state === "PARTIAL").length,
      error: results.filter((r) => r.state === "ERROR").length,
      skipped: results.filter((r) => r.state === "SKIPPED").length,
      classSlugsResolved: [...new Set(results.map((r) => r.classSlug).filter((s): s is string => s !== null))].sort(),
      specSlugsResolved: [...new Set(results.map((r) => r.specSlug).filter((s): s is string => s !== null))].sort(),
      behaviorScoreRange: {
        min: scored.length ? Math.min(...scored) : null,
        max: scored.length ? Math.max(...scored) : null,
      },
    },
  };

  await mkdir(args.outputRoot, { recursive: true });
  const reportPath = join(args.outputRoot, "cross-class-validation-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("\nwcl.probe.utility.cross-class-validate — complete");
  console.log(JSON.stringify(
    {
      validatedAt: report.validatedAt,
      summary: report.summary,
      characters: results.map((r) => ({
        character: `${r.region}/${r.realmSlug}/${r.name}`,
        classSlug: r.classSlug,
        specSlug: r.specSlug,
        roleSlug: r.roleSlug,
        state: r.state,
        behaviorScore: r.behaviorScore,
        confidence: r.confidence,
        semanticBand: r.semanticBand,
        runCount: r.runCount,
        error: r.error,
      })),
      reportPath,
    },
    null,
    2,
  ));

  const failed = results.filter((r) => r.state === "ERROR");
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} character(s) errored.`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
