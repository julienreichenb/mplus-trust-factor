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
 *     [--max-reports-per-dungeon 8] \
 *     [--resume]
 *
 * Resumability:
 *   --resume skips characters that already have a completed V3 simulation
 *   (presence of 30-utility-v3-simulation-summary.json in their artifact dir).
 *   Previously successful results are loaded from disk and merged into the report.
 *   The report is persisted after every character, so an interrupted batch can be
 *   continued from the same point.
 *
 * Rate-limit behaviour:
 *   A single RateLimitData preflight is done for the whole batch before iterating.
 *   If the quota is exhausted (action === STOP) the batch is marked
 *   DEFERRED_RATE_LIMIT, the partial report is written, and the process exits 3.
 *   The same guard runs before each individual character starts so that a run
 *   that fills the budget mid-batch does not attempt additional characters.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LiveWarcraftLogsProvider } from "../live/live-provider.js";
import { runUtilityProbe } from "./utility-probe.js";
import { runUtilityV3Simulation } from "./utility-v3-simulation.js";
import { classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { UtilityProbeIdentity } from "./utility-probe-types.js";
import type { UtilityV3SimulationDataset } from "./utility-v3-types.js";
import type { WclRateBudgetDecision } from "../types.js";

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
  state: "OK" | "PARTIAL" | "ERROR" | "SKIPPED" | "DEFERRED_RATE_LIMIT";
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

type BatchStatus = "OK" | "PARTIAL" | "DEFERRED_RATE_LIMIT" | "ERROR";

interface CrossClassValidationReport {
  validatedAt: string;
  batchStatus: BatchStatus;
  calibrationCharacter: string;
  rateLimit: {
    preflight: RateLimitSummary | null;
    /** Snapshot taken just before the last character that was attempted. */
    lastGuard: RateLimitSummary | null;
  };
  characters: CharacterValidationResult[];
  summary: {
    total: number;
    ok: number;
    partial: number;
    error: number;
    skipped: number;
    deferred: number;
    classSlugsResolved: string[];
    specSlugsResolved: string[];
    behaviorScoreRange: { min: number | null; max: number | null };
  };
}

interface RateLimitSummary {
  action: string;
  utilizationPercent: number;
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsRemaining: number;
  resetAt: string | null;
  fetchedAt: string;
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
  resume: boolean;
} {
  const flags: Record<string, string> = {};
  const boolFlags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      boolFlags.add(key);
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  const charactersFile = flags["characters-file"]?.trim();
  if (!charactersFile) {
    throw new Error(
      "Usage: --characters-file <path.json> [--output-root <dir>] [--max-runs-per-dungeon 3] [--max-reports-per-dungeon 8] [--resume]",
    );
  }
  return {
    charactersFile,
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "raw-artifacts", "wcl-probe-utility"),
    maxRunsPerDungeon: Number(flags["max-runs-per-dungeon"] ?? 3),
    maxReportsPerDungeon: Number(flags["max-reports-per-dungeon"] ?? 8),
    resume: boolFlags.has("resume") || envFlag(flags["resume"]),
  };
}

function zipDirectoryContents(sourceDir: string, zipPath: string): void {
  if (process.platform === "win32") {
    const ps = `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit",
    });
    if (result.status !== 0)
      throw new Error(`Compress-Archive failed (status ${result.status})`);
    return;
  }
  const tar = spawnSync("tar", ["-a", "-cf", zipPath, "-C", sourceDir, "."], {
    stdio: "inherit",
  });
  if (tar.status !== 0) throw new Error("Failed to create ZIP");
}

function rateLimitSummary(decision: WclRateBudgetDecision): RateLimitSummary {
  return {
    action: decision.action,
    utilizationPercent: decision.utilizationPercent,
    limitPerHour: decision.snapshot.limitPerHour,
    pointsSpentThisHour: decision.snapshot.pointsSpentThisHour,
    pointsRemaining: decision.snapshot.pointsRemaining,
    resetAt: decision.snapshot.resetAt,
    fetchedAt: decision.snapshot.fetchedAt,
  };
}

/**
 * Derive the most frequently occurring spec slug across all normalized runs.
 * Resolved from WCL `zoneRankings.spec` — not hardcoded.
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

/** Derive the most frequently occurring role slug across normalized runs. */
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

/**
 * Returns true when a character already has a completed V3 simulation.
 * Presence of `30-utility-v3-simulation-summary.json` is the completion marker.
 */
function isAlreadyComplete(artifactDir: string): boolean {
  return existsSync(join(artifactDir, "30-utility-v3-simulation-summary.json"));
}

/**
 * Returns true when the utility probe has already run for this character.
 * Presence of `07-utility-normalized-runs.json` is the probe completion marker.
 */
function hasProbeArtifacts(artifactDir: string): boolean {
  return existsSync(join(artifactDir, "07-utility-normalized-runs.json"));
}

/**
 * Load a previously persisted CharacterValidationResult from the V3 simulation summary.
 * Returns null if the summary is absent or cannot be parsed.
 */
async function loadCompletedResult(
  artifactDir: string,
  region: string,
  realmSlug: string,
  name: string,
): Promise<CharacterValidationResult | null> {
  try {
    const summaryPath = join(artifactDir, "30-utility-v3-simulation-summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
      behaviorScore?: number | null;
      confidence?: number | null;
      semanticBand?: string;
      domainScores?: Record<string, number | null>;
      redistributedWeights?: Record<string, number>;
      scoredVsExcludedDomains?: UtilityV3SimulationDataset["global"]["scoredVsExcludedDomains"];
      runCount?: number;
      subject?: { classSlug?: string | null; specSlug?: string | null };
    };

    // Resolve roleSlug from the normalized runs file if available
    let roleSlug: string | null = null;
    let specSlug: string | null = summary.subject?.specSlug ?? null;
    try {
      const runs = JSON.parse(
        await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
      );
      roleSlug = dominantRoleSlug(runs);
      specSlug = dominantSpecSlug(runs) ?? specSlug;
    } catch {
      // best-effort
    }

    // Infer dungeonCount from per-dungeon file if available
    let dungeonCount = 0;
    try {
      const perDungeon = JSON.parse(
        await readFile(join(artifactDir, "27-utility-v3-per-dungeon.json"), "utf8"),
      ) as Array<{ runCount?: number }>;
      dungeonCount = perDungeon.filter((d) => (d.runCount ?? 0) > 0).length;
    } catch {
      // best-effort
    }

    return {
      region,
      realmSlug,
      name,
      classSlug: summary.subject?.classSlug ?? null,
      specSlug,
      roleSlug,
      state: "OK",
      behaviorScore: summary.behaviorScore ?? null,
      confidence: summary.confidence ?? null,
      semanticBand: summary.semanticBand ?? null,
      domainScores: summary.domainScores ?? {},
      redistributedWeights: summary.redistributedWeights ?? {},
      scoredVsExcludedDomains: summary.scoredVsExcludedDomains ?? null,
      runCount: summary.runCount ?? 0,
      dungeonCount,
      artifactDir,
      error: null,
    };
  } catch {
    return null;
  }
}

async function writeReport(
  reportPath: string,
  report: CrossClassValidationReport,
): Promise<void> {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function buildReport(
  results: CharacterValidationResult[],
  characters: CharacterManifestEntry[],
  batchStatus: BatchStatus,
  preflight: RateLimitSummary | null,
  lastGuard: RateLimitSummary | null,
): CrossClassValidationReport {
  const scored = results
    .filter((r) => r.behaviorScore !== null)
    .map((r) => r.behaviorScore as number);
  const calibration = characters.find((c) => (c.role ?? "validation") === "calibration");

  return {
    validatedAt: new Date().toISOString(),
    batchStatus,
    calibrationCharacter: calibration
      ? `${calibration.region.toUpperCase()}/${calibration.realm}/${calibration.name}`
      : "unknown",
    rateLimit: { preflight, lastGuard },
    characters: results,
    summary: {
      total: characters.length,
      ok: results.filter((r) => r.state === "OK").length,
      partial: results.filter((r) => r.state === "PARTIAL").length,
      error: results.filter((r) => r.state === "ERROR").length,
      skipped: results.filter((r) => r.state === "SKIPPED").length,
      deferred: results.filter((r) => r.state === "DEFERRED_RATE_LIMIT").length,
      classSlugsResolved: [
        ...new Set(
          results.map((r) => r.classSlug).filter((s): s is string => s !== null),
        ),
      ].sort(),
      specSlugsResolved: [
        ...new Set(
          results.map((r) => r.specSlug).filter((s): s is string => s !== null),
        ),
      ].sort(),
      behaviorScoreRange: {
        min: scored.length ? Math.min(...scored) : null,
        max: scored.length ? Math.max(...scored) : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Per-character validation
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

  const base: Omit<
    CharacterValidationResult,
    | "behaviorScore"
    | "confidence"
    | "semanticBand"
    | "domainScores"
    | "redistributedWeights"
    | "scoredVsExcludedDomains"
    | "runCount"
    | "dungeonCount"
    | "error"
  > = {
    region,
    realmSlug,
    name,
    classSlug: null,
    specSlug: null,
    roleSlug: null,
    state: "ERROR",
    artifactDir,
  };

  const errorResult = (msg: string): CharacterValidationResult => ({
    ...base,
    state: "ERROR",
    behaviorScore: null,
    confidence: null,
    semanticBand: null,
    domainScores: {},
    redistributedWeights: {},
    scoredVsExcludedDomains: null,
    runCount: 0,
    dungeonCount: 0,
    error: msg,
  });

  try {
    mkdirSync(artifactDir, { recursive: true });

    // Step 1 — Utility probe (skipped if probe artifacts already exist)
    let resolvedClassSlug: string | null = null;
    let resolvedSpecSlug: string | null = null;
    let resolvedRoleSlug: string | null = null;
    let probeState: "OK" | "PARTIAL" | "ERROR" = "OK";

    if (hasProbeArtifacts(artifactDir)) {
      console.log(`    [cache] reusing existing probe artifacts`);
      try {
        const runsJson = JSON.parse(
          await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
        );
        resolvedSpecSlug = dominantSpecSlug(runsJson);
        resolvedRoleSlug = dominantRoleSlug(runsJson);
        // classSlug is available on UtilityNormalizedRun
        resolvedClassSlug =
          (Array.isArray(runsJson) &&
            typeof (runsJson[0] as Record<string, unknown>)?.classSlug === "string"
            ? (runsJson[0] as Record<string, unknown>).classSlug as string
            : null) ?? null;
      } catch {
        // best-effort; classSlug stays null
      }
    } else {
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

      probeState = probeDataset.state;
      resolvedClassSlug = classSlugFromWclClassId(probeDataset.character?.classID ?? null);

      try {
        const runsJson = JSON.parse(
          await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
        );
        resolvedSpecSlug = dominantSpecSlug(runsJson);
        resolvedRoleSlug = dominantRoleSlug(runsJson);
      } catch {
        resolvedSpecSlug = probeDataset.runs[0]?.specialization ?? null;
      }

      // Zip probe artifacts
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
    }

    // Step 2 — V3 simulation (offline on artifacts)
    const { dataset: v3Dataset } = await runUtilityV3Simulation({
      inputDir: artifactDir,
      outputDir: artifactDir,
    });

    const v3ZipPath = join(
      artifactDir,
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-v3-simulation.zip`,
    );
    zipDirectoryContents(artifactDir, v3ZipPath);

    const finalClassSlug = v3Dataset.subject.classSlug ?? resolvedClassSlug;
    const finalSpecSlug = v3Dataset.subject.specSlug ?? resolvedSpecSlug;

    return {
      ...base,
      classSlug: finalClassSlug,
      specSlug: finalSpecSlug,
      roleSlug: resolvedRoleSlug,
      state: probeState === "PARTIAL" ? "PARTIAL" : "OK",
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
    return errorResult(err instanceof Error ? err.message : String(err));
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
    characters = JSON.parse(
      readFileSync(args.charactersFile, "utf8"),
    ) as CharacterManifestEntry[];
    if (!Array.isArray(characters) || characters.length === 0) {
      throw new Error("characters-file must be a non-empty JSON array");
    }
  } catch (err) {
    console.error(
      `FAIL: cannot read characters file: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  await mkdir(args.outputRoot, { recursive: true });
  const reportPath = join(args.outputRoot, "cross-class-validation-report.json");

  const provider = new LiveWarcraftLogsProvider({
    env: {
      WCL_CLIENT_ID: clientId,
      WCL_CLIENT_SECRET: clientSecret,
      WCL_PUBLIC_GRAPHQL_URL:
        process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
      WCL_TOKEN_URL:
        process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
      WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
      WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
      WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
      WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200),
    },
    processEnv: process.env,
  });

  console.log(
    `wcl.probe.utility.cross-class-validate — ${characters.length} characters` +
    (args.resume ? " (--resume)" : ""),
  );

  // ------------------------------------------------------------------
  // Single preflight RateLimitData for the entire batch
  // ------------------------------------------------------------------
  let preflight: WclRateBudgetDecision | null = null;
  const fakeCtx = { now: new Date().toISOString() };

  console.log("\n[preflight] RateLimitData…");
  try {
    preflight = await provider.fetchRateLimit(fakeCtx as Parameters<typeof provider.fetchRateLimit>[0]);
    const pct = preflight.utilizationPercent.toFixed(1);
    console.log(
      `  → action=${preflight.action} utilization=${pct}%` +
      ` remaining=${preflight.snapshot.pointsRemaining}/${preflight.snapshot.limitPerHour}` +
      (preflight.snapshot.resetAt ? ` resetAt=${preflight.snapshot.resetAt}` : ""),
    );

    if (preflight.action === "STOP") {
      console.error(
        `  DEFERRED: WCL quota exhausted (${pct}%). ` +
        `Retry after ${preflight.snapshot.resetAt ?? "next hour"}.`,
      );
      const report = buildReport([], characters, "DEFERRED_RATE_LIMIT", rateLimitSummary(preflight), null);
      await writeReport(reportPath, report);
      console.log(`  Report written: ${reportPath}`);
      process.exit(3);
    }
  } catch (err) {
    console.error(
      `  WARN: preflight RateLimitData failed — proceeding without rate guard. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ------------------------------------------------------------------
  // Iterate characters
  // ------------------------------------------------------------------
  const results: CharacterValidationResult[] = [];
  let lastGuard: WclRateBudgetDecision | null = null;

  for (let i = 0; i < characters.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = characters[i]!;
    const region = entry.region.trim().toUpperCase();
    const realmSlug = entry.realm.trim().toLowerCase();
    const name = entry.name.trim();
    const label = `${region}/${realmSlug}/${name}`;
    const artifactDir = join(
      args.outputRoot,
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
    );

    console.log(`\n[${i + 1}/${characters.length}] ${label}`);

    // ------------------------------------------------------------------
    // Resume: skip characters that are already complete
    // ------------------------------------------------------------------
    if (args.resume && isAlreadyComplete(artifactDir)) {
      console.log(`  [resume] already complete — loading from disk`);
      const cached = await loadCompletedResult(artifactDir, region, realmSlug, name);
      if (cached) {
        results.push(cached);
        console.log(
          `  → state=OK (cached) class=${cached.classSlug ?? "?"} spec=${cached.specSlug ?? "?"} ` +
          `score=${cached.behaviorScore ?? "null"}`,
        );
        continue;
      }
      console.log(`  [resume] could not load cached result — re-running`);
    }

    // ------------------------------------------------------------------
    // Rate-budget guard before each character
    // ------------------------------------------------------------------
    // Characters that have existing probe artifacts don't need live calls
    // for the probe step; still guard because V3 is offline-only.
    const needsLiveCalls = !hasProbeArtifacts(artifactDir);
    if (needsLiveCalls) {
      try {
        const guard = await provider.fetchRateLimit(
          fakeCtx as Parameters<typeof provider.fetchRateLimit>[0],
        );
        lastGuard = guard;
        const pct = guard.utilizationPercent.toFixed(1);
        console.log(
          `  [rate-guard] action=${guard.action} utilization=${pct}%` +
          ` remaining=${guard.snapshot.pointsRemaining}` +
          (guard.snapshot.resetAt ? ` resetAt=${guard.snapshot.resetAt}` : ""),
        );

        if (guard.action === "STOP" || guard.action === "DEFER") {
          console.error(
            `  DEFERRED: WCL quota ${guard.action} at ${pct}%. ` +
            `Remaining characters will not be attempted.`,
          );
          // Mark this and all remaining characters as DEFERRED
          for (let j = i; j < characters.length; j += 1) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const e = characters[j]!;
            const r = e.region.trim().toUpperCase();
            const rl = e.realm.trim().toLowerCase();
            const n = e.name.trim();
            const dir = join(
              args.outputRoot,
              `${r.toLowerCase()}-${rl}-${n.toLowerCase()}`,
            );
            results.push({
              region: r,
              realmSlug: rl,
              name: n,
              classSlug: null,
              specSlug: null,
              roleSlug: null,
              state: "DEFERRED_RATE_LIMIT",
              behaviorScore: null,
              confidence: null,
              semanticBand: null,
              domainScores: {},
              redistributedWeights: {},
              scoredVsExcludedDomains: null,
              runCount: 0,
              dungeonCount: 0,
              artifactDir: dir,
              error: `WCL rate budget ${guard.action} at ${pct}% — deferred`,
            });
          }
          break;
        }
      } catch (err) {
        console.warn(
          `  WARN: rate-guard check failed — proceeding without guard. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ------------------------------------------------------------------
    // Run probe + V3
    // ------------------------------------------------------------------
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

    // ------------------------------------------------------------------
    // Persist report after every character
    // ------------------------------------------------------------------
    const partialBatchStatus: BatchStatus =
      result.state === "DEFERRED_RATE_LIMIT" ? "DEFERRED_RATE_LIMIT" : "PARTIAL";
    const partialReport = buildReport(
      results,
      characters,
      partialBatchStatus,
      preflight ? rateLimitSummary(preflight) : null,
      lastGuard ? rateLimitSummary(lastGuard) : null,
    );
    await writeReport(reportPath, partialReport);
  }

  // ------------------------------------------------------------------
  // Final report
  // ------------------------------------------------------------------
  const hasDeferred = results.some((r) => r.state === "DEFERRED_RATE_LIMIT");
  const hasError = results.some((r) => r.state === "ERROR");
  const batchStatus: BatchStatus = hasDeferred
    ? "DEFERRED_RATE_LIMIT"
    : hasError
      ? results.every((r) => r.state === "ERROR")
        ? "ERROR"
        : "PARTIAL"
      : "OK";

  const finalReport = buildReport(
    results,
    characters,
    batchStatus,
    preflight ? rateLimitSummary(preflight) : null,
    lastGuard ? rateLimitSummary(lastGuard) : null,
  );
  await writeReport(reportPath, finalReport);

  console.log("\nwcl.probe.utility.cross-class-validate — complete");
  console.log(
    JSON.stringify(
      {
        validatedAt: finalReport.validatedAt,
        batchStatus,
        rateLimit: finalReport.rateLimit,
        summary: finalReport.summary,
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
    ),
  );

  if (batchStatus === "DEFERRED_RATE_LIMIT") {
    console.error(
      `\nDEFERRED: ${finalReport.summary.deferred} character(s) deferred due to WCL rate limit. ` +
      `Retry with --resume after ${preflight?.snapshot.resetAt ?? lastGuard?.snapshot.resetAt ?? "next hour"}.`,
    );
    process.exit(3);
  }
  if (hasError) {
    console.error(`\nFAIL: ${finalReport.summary.error} character(s) errored.`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
