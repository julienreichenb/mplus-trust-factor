/**
 * Cross-class Utility V3 validation CLI.
 *
 * For each character in the input manifest:
 *   1. Run the full utility probe (live WCL calls) to collect raw artifacts.
 *   2. Run the V3 simulation offline on those artifacts.
 *   3. Resolve classSlug / specSlug / roleSlug from provider output — never hardcoded.
 *
 * Usage:
 *   pnpm wcl:probe:utility:cross-class-validate -- \
 *     --characters-file tools/fixtures/cross-class-validation-characters.json \
 *     [--output-root raw-artifacts/wcl-probe-utility] \
 *     [--max-runs-per-dungeon 3] \
 *     [--max-reports-per-dungeon 8] \
 *     [--resume]             resume all PARTIAL/ERROR characters with complete artifacts
 *     [--resume-partial]     resume only PARTIAL characters (fetch missing dungeons)
 *     [--retry-errors]       retry only ERROR characters
 *     [--force-refetch]      force live WCL calls even for COMPLETE characters
 *     [--only Aspha,Serahz]  limit run to a comma-separated list of character names
 *
 * Resumability:
 *   --resume skips COMPLETE characters (30-utility-v3-simulation-summary.json present).
 *   --resume-partial attempts to complete PARTIAL characters without refetching existing runs.
 *   --retry-errors retries ERROR characters from scratch.
 *   A failed character never invalidates previously completed characters.
 *   The report is persisted after every character.
 *
 * Rate-limit behaviour:
 *   A single RateLimitData preflight is done for the whole batch.
 *   If quota is exhausted (action === STOP) the batch is marked DEFERRED_RATE_LIMIT.
 *   Before each character that requires live calls, a per-character rate guard runs.
 *   The guard estimates maximum likely cost from: missing dungeon count × per-dungeon cost
 *   derived from already-processed characters, with a conservative fallback of 500 pts/dungeon.
 *   A character is not started when: pointsRemaining < estimatedCharacterCost + safetyReserve.
 *   Actual point consumption is recorded per character.
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
import type { WclRateBudgetDecisionDTO } from "@mplus/contracts";
import { buildWclRateLimitFetchContext } from "@mplus/contracts";
import { roleForSpec } from "@mplus/abilities";
import {
  atomicPublishProbeArtifacts,
  mergeProbeArtifacts,
  persistRejectedMergeCandidate,
  snapshotCanonicalArtifacts,
} from "./utility-probe-resume-merge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CharacterManifestEntry {
  region: string;
  realm: string;
  name: string;
  /** Informational label — never used for scoring logic. */
  role?: string;
  /**
   * When false, exclude from automatic validation (keeps artifacts for diagnostics).
   * Still runnable with --only Name --force-refetch.
   * Defaults to true when omitted.
   */
  enabled?: boolean;
}

export interface ProbeFailureDiagnostics {
  probeState: "ERROR" | "PARTIAL";
  /** WCL-reported error messages from graphqlErrors. */
  wclErrors: string[];
  /** Rejection reasons from candidateRunsRejected, grouped. */
  rejectionReasons: Record<string, number>;
  /** Total reports inspected. */
  reportsInspected: number;
  /** Total fights that passed hydration. */
  fightsInspected: number;
  /** Schema or zone warnings. */
  schemaWarnings: string[];
  /** Whether the character was found at all on WCL. */
  characterFound: boolean;
  /**
   * Summary diagnosis: why the probe produced zero runs.
   * One of: "character_not_found", "all_fights_target_absent",
   * "zone_rankings_aggregate_only", "rate_limited", "unknown".
   */
  diagnosis:
    | "character_not_found"
    | "all_fights_target_absent"
    | "zone_rankings_aggregate_only"
    | "rate_limited"
    | "unknown";
  retryable: boolean;
  /** Files that were successfully written before the failure. */
  partialArtifactPaths: string[];
}

export interface CharacterRateCost {
  pointsBefore: number | null;
  pointsAfter: number | null;
  pointsConsumed: number | null;
  wclRequests: number | null;
  estimatedCost: number | null;
  safetyReserve: number;
  costDecisionReason: string;
}

export interface CharacterValidationResult {
  region: string;
  realmSlug: string;
  name: string;
  /** Resolved from the WCL provider via classID → classSlug. */
  classSlug: string | null;
  /** Resolved from zoneRankings spec field — most common spec across selected runs. */
  specSlug: string | null;
  /** Resolved from zoneRankings role field — majority across runs. */
  roleSlug: string | null;
  mixedRole: boolean;
  roleSource: "zone_rankings" | "inferred" | "unknown";
  state: "COMPLETE" | "PARTIAL" | "ERROR" | "SKIPPED" | "DEFERRED_RATE_LIMIT";
  /**
   * Artifact completeness classification.
   * COMPLETE: 30-utility-v3-simulation-summary.json present.
   * PARTIAL: 07-utility-normalized-runs.json present but missing dungeons.
   * ERROR: probe ran but found no usable runs.
   * NONE: no artifacts at all.
   */
  artifactState: "COMPLETE" | "PARTIAL" | "ERROR" | "NONE";
  completedDungeons: string[];
  missingDungeons: string[];
  /**
   * Per-dungeon classification for missing dungeons.
   * Possible values: "no_candidates", "actor_absent", "report_cap_reached",
   * "actor_absent_and_cap_reached", "report_private", "outside_report_window", "unknown".
   */
  missingDungeonReasons: Record<string, string>;
  behaviorScore: number | null;
  confidence: number | null;
  semanticBand: string | null;
  domainScores: Record<string, number | null>;
  redistributedWeights: Record<string, number>;
  scoredVsExcludedDomains: UtilityV3SimulationDataset["global"]["scoredVsExcludedDomains"] | null;
  runCount: number;
  dungeonCount: number;
  castStopDiagnostics: CastStopDiagnostics | null;
  rateCost: CharacterRateCost | null;
  artifactDir: string;
  error: string | null;
  probeFailure: ProbeFailureDiagnostics | null;
}

export interface CastStopDiagnostics {
  confirmedCastStops: number;
  effectivePerHour: number | null;
  runsScored: number;
  runsAt90Plus: number;
  runsAt100: number;
  uniqueInterruptedSpellIds: number[];
  uniqueHostileTargets: number;
  dungeonsCovered: string[];
  sampleSizeWarning: string | null;
  curveInput: number | null;
  domainScore: number | null;
}

type BatchStatus = "OK" | "PARTIAL" | "DEFERRED_RATE_LIMIT" | "ERROR";

interface CrossClassValidationReport {
  validatedAt: string;
  batchStatus: BatchStatus;
  calibrationCharacter: string;
  rateLimit: {
    preflight: RateLimitSummary | null;
    lastGuard: RateLimitSummary | null;
  };
  characters: CharacterValidationResult[];
  summary: {
    total: number;
    complete: number;
    partial: number;
    error: number;
    skipped: number;
    deferred: number;
    classSlugsResolved: string[];
    specSlugsResolved: string[];
    roleSlugsResolved: string[];
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
  maxRecentReportPages: number;
  resume: boolean;
  resumePartial: boolean;
  retryErrors: boolean;
  forceRefetch: boolean;
  only: Set<string> | null;
} {
  const flags: Record<string, string> = {};
  const boolFlags = new Set<string>();
  const onlyNames = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);

    // --only accepts comma-separated names AND trailing bare name tokens (PowerShell
    // splits "Aspha,Serahz,Sjelelele" into separate argv entries after the first).
    if (key === "only") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        for (const part of next.split(",")) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed) onlyNames.add(trimmed);
        }
        i += 1;
      }
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        i += 1;
        const bare = argv[i]!.trim().toLowerCase();
        if (bare) onlyNames.add(bare);
      }
      continue;
    }

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
      "Usage: --characters-file <path.json> [--output-root <dir>] " +
      "[--max-runs-per-dungeon 3] [--max-reports-per-dungeon 8] " +
      "[--resume] [--resume-partial] [--retry-errors] [--force-refetch] [--only Name1,Name2]",
    );
  }
  const only = onlyNames.size > 0 ? onlyNames : null;
  return {
    charactersFile,
    outputRoot:
      flags["output-root"]?.trim() ||
      join(process.cwd(), "raw-artifacts", "wcl-probe-utility"),
    maxRunsPerDungeon: Number(flags["max-runs-per-dungeon"] ?? 3),
    maxReportsPerDungeon: Number(flags["max-reports-per-dungeon"] ?? 8),
    maxRecentReportPages: Number(flags["max-recent-report-pages"] ?? 1),
    resume: boolFlags.has("resume") || envFlag(flags["resume"]),
    resumePartial: boolFlags.has("resume-partial") || envFlag(flags["resume-partial"]),
    retryErrors: boolFlags.has("retry-errors") || envFlag(flags["retry-errors"]),
    forceRefetch: boolFlags.has("force-refetch") || envFlag(flags["force-refetch"]),
    only,
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

function rateLimitSummary(decision: WclRateBudgetDecisionDTO): RateLimitSummary {
  const pointsLimit = decision.snapshot.pointsLimit;
  const pointsRemaining = decision.snapshot.pointsRemaining;
  return {
    action: decision.action,
    utilizationPercent: decision.utilizationPercent,
    limitPerHour: pointsLimit,
    pointsSpentThisHour: Math.max(0, pointsLimit - pointsRemaining),
    pointsRemaining,
    resetAt: decision.snapshot.resetAt,
    fetchedAt: decision.snapshot.fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Artifact state detection
// ---------------------------------------------------------------------------

const ACTIVE_SEASON_DUNGEONS = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
];

type ArtifactState = "COMPLETE" | "PARTIAL" | "ERROR" | "NONE";

interface ArtifactStatus {
  state: ArtifactState;
  completedDungeons: string[];
  missingDungeons: string[];
}

async function detectArtifactState(artifactDir: string): Promise<ArtifactStatus> {
  // COMPLETE: V3 simulation summary present
  if (existsSync(join(artifactDir, "30-utility-v3-simulation-summary.json"))) {
    // Still need to classify as PARTIAL if missing dungeons
    try {
      const perDungeon = JSON.parse(
        await readFile(join(artifactDir, "27-utility-v3-per-dungeon.json"), "utf8"),
      ) as Array<{ dungeonSlug: string; runCount: number }>;
      const completed = perDungeon.filter((d) => d.runCount > 0).map((d) => d.dungeonSlug);
      const missing = ACTIVE_SEASON_DUNGEONS.filter((s) => !completed.includes(s));
      // COMPLETE only when all 8 dungeons covered
      if (missing.length === 0) return { state: "COMPLETE", completedDungeons: completed, missingDungeons: [] };
      return { state: "PARTIAL", completedDungeons: completed, missingDungeons: missing };
    } catch {
      return { state: "COMPLETE", completedDungeons: [], missingDungeons: [] };
    }
  }
  // PARTIAL: normalized runs present
  if (existsSync(join(artifactDir, "07-utility-normalized-runs.json"))) {
    try {
      const runs = JSON.parse(
        await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
      ) as Array<{ dungeonSlug: string }>;
      const completed = [...new Set(runs.map((r) => r.dungeonSlug))];
      const missing = ACTIVE_SEASON_DUNGEONS.filter((s) => !completed.includes(s));
      if (runs.length === 0) return { state: "ERROR", completedDungeons: [], missingDungeons: ACTIVE_SEASON_DUNGEONS };
      return { state: "PARTIAL", completedDungeons: completed, missingDungeons: missing };
    } catch {
      return { state: "ERROR", completedDungeons: [], missingDungeons: ACTIVE_SEASON_DUNGEONS };
    }
  }
  return { state: "NONE", completedDungeons: [], missingDungeons: ACTIVE_SEASON_DUNGEONS };
}

// ---------------------------------------------------------------------------
// Probe failure diagnostics
// ---------------------------------------------------------------------------

async function buildProbeFailureDiagnostics(
  artifactDir: string,
  probeState: "ERROR" | "PARTIAL",
  characterFound: boolean,
): Promise<ProbeFailureDiagnostics> {
  const partialArtifactPaths: string[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const n = String(i).padStart(2, "0");
    const files = [`${n}-utility-run-selection.json`, `${n}-utility-per-dungeon.json`,
                   `${n}-master-data.json`, `${n}-utility-diagnostics.json`];
    for (const f of files) {
      const p = join(artifactDir, f);
      if (existsSync(p)) partialArtifactPaths.push(p);
    }
  }

  let wclErrors: string[] = [];
  const rejectionReasons: Record<string, number> = {};
  let reportsInspected = 0;
  let fightsInspected = 0;
  let schemaWarnings: string[] = [];

  try {
    const diag = JSON.parse(
      await readFile(join(artifactDir, "10-utility-diagnostics.json"), "utf8"),
    ) as {
      reportsInspected?: string[];
      fightsInspected?: unknown[];
      candidateRunsRejected?: Array<{ reason: string }>;
      graphqlErrors?: Array<{ message?: string; category?: string }>;
      schemaWarnings?: string[];
    };
    reportsInspected = diag.reportsInspected?.length ?? 0;
    fightsInspected = diag.fightsInspected?.length ?? 0;
    wclErrors = (diag.graphqlErrors ?? []).map(
      (e) => e.message ?? JSON.stringify(e),
    );
    schemaWarnings = diag.schemaWarnings ?? [];
    for (const rej of diag.candidateRunsRejected ?? []) {
      // Normalize reason: strip fight index suffix (hydrate_fight_N_reason → reason)
      const normalized = rej.reason.replace(/^hydrate_fight_\d+_/, "");
      rejectionReasons[normalized] = (rejectionReasons[normalized] ?? 0) + 1;
    }
  } catch {
    // best-effort
  }

  // Diagnosis
  let diagnosis: ProbeFailureDiagnostics["diagnosis"] = "unknown";
  if (!characterFound) {
    diagnosis = "character_not_found";
  } else if (wclErrors.some((e) => /rate.limit|rate limit|429/i.test(e))) {
    diagnosis = "rate_limited";
  } else if (schemaWarnings.some((w) => /zoneRankings returned.*aggregate row/i.test(w))) {
    diagnosis = "zone_rankings_aggregate_only";
  } else if (
    Object.keys(rejectionReasons).length > 0 &&
    Object.keys(rejectionReasons).every((k) => k.includes("target_absent"))
  ) {
    diagnosis = "all_fights_target_absent";
  }

  return {
    probeState,
    wclErrors,
    rejectionReasons,
    reportsInspected,
    fightsInspected,
    schemaWarnings,
    characterFound,
    diagnosis,
    // zone_rankings_aggregate_only is retryable: increasing maxRecentReportPages
    // or wider report window may surface the missing dungeon candidates.
    retryable: diagnosis !== "character_not_found" && diagnosis !== "all_fights_target_absent",
    partialArtifactPaths: [...new Set(partialArtifactPaths)],
  };
}

// ---------------------------------------------------------------------------
// Cast-stop saturation diagnostics
// ---------------------------------------------------------------------------

async function buildCastStopDiagnostics(
  artifactDir: string,
  v3Dataset: UtilityV3SimulationDataset,
): Promise<CastStopDiagnostics> {
  const castStopRunScores = v3Dataset.runSimulations.map((r) => ({
    dungeonSlug: r.dungeonSlug,
    score: r.domains.castStops?.domainScore ?? null,
    effectivePerHour: r.domains.castStops?.effectivePerHour ?? null,
    tierCounts: r.domains.castStops?.tierCounts,
  }));
  const scoredRuns = castStopRunScores.filter((r) => r.score !== null && r.score > 50);
  const runsAt90 = castStopRunScores.filter((r) => (r.score ?? 0) >= 90).length;
  const runsAt100 = castStopRunScores.filter((r) => (r.score ?? 0) >= 100).length;
  const dungeonsCovered = [...new Set(scoredRuns.map((r) => r.dungeonSlug))];

  // Confirmed cast stops from evidence inventory
  const confirmedItems = v3Dataset.evidenceInventory.filter(
    (e) => e.domain === "castStops" && (e.tier === "CONFIRMED_IMPACT" || e.tier === "CONFIRMED_APPLICATION"),
  );
  const confirmedCount = confirmedItems.length;

  // Unique interrupted spell IDs and targets from normalized runs artifact
  const uniqueInterruptedSpells = new Set<number>();
  const uniqueTargets = new Set<number | string>();
  try {
    const runs = JSON.parse(
      await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
    ) as Array<{
      interruptEvents?: Array<{ interruptedSpellId?: number; targetID?: number; canonical?: unknown }>;
    }>;
    for (const run of runs) {
      for (const evt of run.interruptEvents ?? []) {
        if (evt.interruptedSpellId) uniqueInterruptedSpells.add(evt.interruptedSpellId);
        if (evt.targetID) uniqueTargets.add(evt.targetID);
      }
    }
  } catch {
    // best-effort
  }

  const avgEffPerHour =
    scoredRuns.length > 0
      ? scoredRuns.reduce((s, r) => s + (r.effectivePerHour ?? 0), 0) / scoredRuns.length
      : null;

  const totalRunCount = v3Dataset.runSimulations.length;
  let sampleSizeWarning: string | null = null;
  const globalCastStopScore = v3Dataset.global.domainScores.castStops;
  if (globalCastStopScore !== null && globalCastStopScore >= 90 && totalRunCount < 8) {
    sampleSizeWarning =
      `castStops score ${globalCastStopScore.toFixed(1)} is based on only ${totalRunCount} run(s) ` +
      `across ${dungeonsCovered.length} dungeon(s). ` +
      `A score of ${globalCastStopScore >= 100 ? "100" : "90+"} with fewer than 8 dungeons ` +
      `is insufficient for calibration even when the observed behavior is valid. ` +
      `Complete all 8 active-season dungeons before treating this score as representative.`;
  }

  return {
    confirmedCastStops: confirmedCount,
    effectivePerHour: avgEffPerHour,
    runsScored: scoredRuns.length,
    runsAt90Plus: runsAt90,
    runsAt100,
    uniqueInterruptedSpellIds: [...uniqueInterruptedSpells].sort((a, b) => a - b),
    uniqueHostileTargets: uniqueTargets.size,
    dungeonsCovered,
    sampleSizeWarning,
    curveInput: avgEffPerHour,
    domainScore: globalCastStopScore,
  };
}

// ---------------------------------------------------------------------------
// Rate cost helpers
// ---------------------------------------------------------------------------

const DEFAULT_COST_PER_DUNGEON = 500;
const SAFETY_RESERVE = 1500;

/** Estimate maximum likely WCL points for a character with `missingDungeons` remaining. */
function estimateCharacterCost(
  missingDungeons: number,
  historicalCostPerDungeon: number | null,
): { estimated: number; reason: string } {
  if (missingDungeons === 0) return { estimated: 0, reason: "no_missing_dungeons" };
  const perDungeon = historicalCostPerDungeon ?? DEFAULT_COST_PER_DUNGEON;
  const source = historicalCostPerDungeon != null ? "measured_history" : "conservative_fallback";
  return {
    estimated: missingDungeons * perDungeon,
    reason: `${missingDungeons} missing dungeon(s) × ${perDungeon.toFixed(0)} pts/dungeon (${source})`,
  };
}

// ---------------------------------------------------------------------------
// Completed result loader
// ---------------------------------------------------------------------------

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
      subject?: {
        classSlug?: string | null;
        specSlug?: string | null;
        roleSlug?: string | null;
        mixedRole?: boolean;
        roleSource?: "zone_rankings" | "inferred" | "unknown";
      };
    };

    const artifactStatus = await detectArtifactState(artifactDir);

    return {
      region,
      realmSlug,
      name,
      classSlug: summary.subject?.classSlug ?? null,
      specSlug: summary.subject?.specSlug ?? null,
      roleSlug: summary.subject?.roleSlug ?? null,
      mixedRole: summary.subject?.mixedRole ?? false,
      roleSource: summary.subject?.roleSource ?? "unknown",
      state: artifactStatus.state === "COMPLETE" ? "COMPLETE" : "PARTIAL",
      artifactState: artifactStatus.state,
      completedDungeons: artifactStatus.completedDungeons,
      missingDungeons: artifactStatus.missingDungeons,
      missingDungeonReasons: {},
      behaviorScore: summary.behaviorScore ?? null,
      confidence: summary.confidence ?? null,
      semanticBand: summary.semanticBand ?? null,
      domainScores: summary.domainScores ?? {},
      redistributedWeights: summary.redistributedWeights ?? {},
      scoredVsExcludedDomains: summary.scoredVsExcludedDomains ?? null,
      runCount: summary.runCount ?? 0,
      dungeonCount: artifactStatus.completedDungeons.length,
      castStopDiagnostics: null,
      rateCost: {
        pointsBefore: null,
        pointsAfter: null,
        pointsConsumed: 0,
        wclRequests: 0,
        estimatedCost: 0,
        safetyReserve: SAFETY_RESERVE,
        costDecisionReason: "cache_only_no_missing_dungeons",
      },
      artifactDir,
      error: null,
      probeFailure: null,
    };
  } catch {
    return null;
  }
}

/** Cache-only path: reuse probe artifacts, optionally rescore V3 locally, zero WCL calls. */
async function validateCharacterCacheOnly(
  entry: CharacterManifestEntry,
  outputRoot: string,
  opts: { rescore?: boolean } = {},
): Promise<CharacterValidationResult> {
  const region = entry.region.trim().toUpperCase();
  const realmSlug = entry.realm.trim().toLowerCase();
  const name = entry.name.trim();
  const artifactDir = join(
    outputRoot,
    `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
  );
  const artifactStatus = await detectArtifactState(artifactDir);

  const base = await loadCompletedResult(artifactDir, region, realmSlug, name);
  if (!base && !opts.rescore) {
    return {
      region,
      realmSlug,
      name,
      classSlug: null,
      specSlug: null,
      roleSlug: null,
      mixedRole: false,
      roleSource: "unknown",
      state: artifactStatus.state === "COMPLETE" ? "COMPLETE" : "PARTIAL",
      artifactState: artifactStatus.state,
      completedDungeons: artifactStatus.completedDungeons,
      missingDungeons: artifactStatus.missingDungeons,
      missingDungeonReasons: {},
      behaviorScore: null,
      confidence: null,
      semanticBand: null,
      domainScores: {},
      redistributedWeights: {},
      scoredVsExcludedDomains: null,
      runCount: 0,
      dungeonCount: artifactStatus.completedDungeons.length,
      castStopDiagnostics: null,
      rateCost: {
        pointsBefore: null,
        pointsAfter: null,
        pointsConsumed: 0,
        wclRequests: 0,
        estimatedCost: 0,
        safetyReserve: SAFETY_RESERVE,
        costDecisionReason: "cache_only_no_missing_dungeons",
      },
      artifactDir,
      error: "Missing V3 summary for cache-only load",
      probeFailure: null,
    };
  }

  if (!opts.rescore && base) return base;

  console.log(`    [cache] reusing probe artifacts (state=${artifactStatus.state}), local V3 rescore`);
  const { dataset: v3Dataset } = await runUtilityV3Simulation({
    inputDir: artifactDir,
    outputDir: artifactDir,
  });

  zipDirectoryContents(
    artifactDir,
    join(artifactDir, `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-v3-simulation.zip`),
  );

  const updatedArtifactStatus = await detectArtifactState(artifactDir);
  const castStopDiag = await buildCastStopDiagnostics(artifactDir, v3Dataset);

  let missingDungeonReasons: Record<string, string> = {};
  try {
    const perDungeon = JSON.parse(
      await readFile(join(artifactDir, "09-utility-per-dungeon.json"), "utf8"),
    ) as { global?: { coverage?: { missingDungeonReasons?: Record<string, string> } } };
    missingDungeonReasons = perDungeon.global?.coverage?.missingDungeonReasons ?? {};
  } catch { /* best-effort */ }
  for (const slug of updatedArtifactStatus.missingDungeons) {
    if (!missingDungeonReasons[slug]) missingDungeonReasons[slug] = "unknown";
  }

  const finalState = updatedArtifactStatus.state === "COMPLETE" ? "COMPLETE" : "PARTIAL";

  return {
    region,
    realmSlug,
    name,
    classSlug: v3Dataset.subject.classSlug,
    specSlug: v3Dataset.subject.specSlug,
    roleSlug: v3Dataset.subject.roleSlug,
    mixedRole: v3Dataset.subject.mixedRole ?? false,
    roleSource: v3Dataset.subject.roleSource ?? "unknown",
    state: finalState,
    artifactState: updatedArtifactStatus.state,
    completedDungeons: updatedArtifactStatus.completedDungeons,
    missingDungeons: updatedArtifactStatus.missingDungeons,
    missingDungeonReasons,
    behaviorScore: v3Dataset.global.behaviorScore,
    confidence: v3Dataset.global.confidence,
    semanticBand: v3Dataset.global.semanticBand,
    domainScores: v3Dataset.global.domainScores as Record<string, number | null>,
    redistributedWeights: v3Dataset.global.redistributedWeights as Record<string, number>,
    scoredVsExcludedDomains: v3Dataset.global.scoredVsExcludedDomains,
    runCount: v3Dataset.global.runCount,
    dungeonCount: v3Dataset.global.dungeonCount,
    castStopDiagnostics: castStopDiag,
    rateCost: {
      pointsBefore: null,
      pointsAfter: null,
      pointsConsumed: 0,
      wclRequests: 0,
      estimatedCost: 0,
      safetyReserve: SAFETY_RESERVE,
      costDecisionReason: "cache_only_no_missing_dungeons",
    },
    artifactDir,
    error: null,
    probeFailure: null,
  };
}

function characterResultKey(r: { region: string; realmSlug: string; name: string }): string {
  return `${r.region.toLowerCase()}:${r.realmSlug.toLowerCase()}:${r.name.toLowerCase()}`;
}

function ensureAllRequestedCharactersInReport(
  results: CharacterValidationResult[],
  activeCharacters: CharacterManifestEntry[],
  outputRoot: string,
): CharacterValidationResult[] {
  const byKey = new Map(results.map((r) => [characterResultKey(r), r]));
  const merged = [...results];
  for (const entry of activeCharacters) {
    const region = entry.region.trim().toUpperCase();
    const realmSlug = entry.realm.trim().toLowerCase();
    const name = entry.name.trim();
    const key = characterResultKey({ region, realmSlug, name });
    if (byKey.has(key)) continue;
    merged.push({
      region,
      realmSlug,
      name,
      classSlug: null,
      specSlug: null,
      roleSlug: null,
      mixedRole: false,
      roleSource: "unknown",
      state: "SKIPPED",
      artifactState: "NONE",
      completedDungeons: [],
      missingDungeons: ACTIVE_SEASON_DUNGEONS,
      missingDungeonReasons: {},
      behaviorScore: null,
      confidence: null,
      semanticBand: null,
      domainScores: {},
      redistributedWeights: {},
      scoredVsExcludedDomains: null,
      runCount: 0,
      dungeonCount: 0,
      castStopDiagnostics: null,
      rateCost: null,
      artifactDir: join(outputRoot, `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`),
      error: "Character was requested but not processed in this batch",
      probeFailure: null,
    });
  }
  return merged;
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
  activeCharacters?: CharacterManifestEntry[],
): CrossClassValidationReport {
  const scored = results
    .filter((r) => r.behaviorScore !== null)
    .map((r) => r.behaviorScore as number);
  const calibration = characters.find((c) => (c.role ?? "validation") === "calibration");
  const reportPopulation = activeCharacters ?? characters;

  return {
    validatedAt: new Date().toISOString(),
    batchStatus,
    calibrationCharacter: calibration
      ? `${calibration.region.toUpperCase()}/${calibration.realm}/${calibration.name}`
      : "unknown",
    rateLimit: { preflight, lastGuard },
    characters: results,
    summary: {
      total: reportPopulation.length,
      complete: results.filter((r) => r.state === "COMPLETE").length,
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
      roleSlugsResolved: [
        ...new Set(
          results.map((r) => r.roleSlug).filter((s): s is string => s !== null),
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
  historicalCostPerDungeon: number | null,
  opts: {
    /** When set, only probe these dungeons (PARTIAL resume). */
    focusDungeons?: string[] | null;
    /** Number of recentReports pages to fetch during discovery. */
    maxRecentReportPages?: number;
    /** When true, allow live WCL even for COMPLETE characters. */
    forceRefetch?: boolean;
  } = {},
): Promise<CharacterValidationResult> {
  const region = entry.region.trim().toUpperCase();
  const realmSlug = entry.realm.trim().toLowerCase();
  const name = entry.name.trim();
  const artifactDir = join(
    outputRoot,
    `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
  );

  const errorResult = (
    msg: string,
    extras: Partial<CharacterValidationResult> = {},
  ): CharacterValidationResult => ({
    region,
    realmSlug,
    name,
    classSlug: null,
    specSlug: null,
    roleSlug: null,
    mixedRole: false,
    roleSource: "unknown",
    state: "ERROR",
    artifactState: "NONE",
    completedDungeons: [],
    missingDungeons: ACTIVE_SEASON_DUNGEONS,
    missingDungeonReasons: {},
    behaviorScore: null,
    confidence: null,
    semanticBand: null,
    domainScores: {},
    redistributedWeights: {},
    scoredVsExcludedDomains: null,
    runCount: 0,
    dungeonCount: 0,
    castStopDiagnostics: null,
    rateCost: null,
    artifactDir,
    error: msg,
    probeFailure: null,
    ...extras,
  });

  try {
    mkdirSync(artifactDir, { recursive: true });

    const artifactStatus = await detectArtifactState(artifactDir);
    const hasExplicitFocus = (opts.focusDungeons?.length ?? 0) > 0;
    const noMissingDungeons = artifactStatus.missingDungeons.length === 0;
    const cacheOnlyComplete =
      !opts.forceRefetch &&
      artifactStatus.state === "COMPLETE" &&
      noMissingDungeons;
    // PARTIAL state needs live calls when focusDungeons is set (resume-partial mode)
    const needsLiveCalls =
      !cacheOnlyComplete &&
      !noMissingDungeons &&
      (artifactStatus.state === "NONE" ||
        artifactStatus.state === "ERROR" ||
        (artifactStatus.state === "PARTIAL" && hasExplicitFocus));

    // Point consumption tracking
    let pointsBefore: number | null = null;
    let pointsAfter: number | null = null;
    let probeWclRequests: number | null = null;

    let resolvedClassSlug: string | null = null;
    let resolvedSpecSlug: string | null = null;
    let resolvedRoleSlug: string | null = null;
    let mixedRole = false;
    let roleSource: "zone_rankings" | "inferred" | "unknown" = "unknown";
    let probeState: "OK" | "PARTIAL" | "ERROR" = "OK";
    let characterFound = false;

    if (!needsLiveCalls) {
      // Re-use existing probe artifacts — zero live WCL consumption
      console.log(`    [cache] reusing probe artifacts (state=${artifactStatus.state})`);
      pointsBefore = null;
      pointsAfter = null;
      probeWclRequests = 0;
      try {
        const runs = JSON.parse(
          await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
        ) as Array<{ classSlug?: string | null; specialization?: string | null; roleSlug?: string | null; dungeonSlug?: string }>;
        resolvedClassSlug = runs[0]?.classSlug ?? null;
        resolvedSpecSlug = runs[0]?.specialization ?? null;
        const roleCounts = new Map<string, number>();
        for (const r of runs) {
          if (r.roleSlug) roleCounts.set(r.roleSlug, (roleCounts.get(r.roleSlug) ?? 0) + 1);
        }
        if (roleCounts.size > 0) {
          let best: string | null = null;
          let bestCount = 0;
          for (const [slug, count] of roleCounts) {
            if (count > bestCount) { best = slug; bestCount = count; }
          }
          resolvedRoleSlug = best;
          mixedRole = roleCounts.size > 1;
          roleSource = "zone_rankings";
        }
        // Fallback: infer role from specSlug via catalog when WCL returned null
        if (resolvedRoleSlug === null && resolvedSpecSlug) {
          const inferred = roleForSpec(resolvedSpecSlug);
          if (inferred) { resolvedRoleSlug = inferred; roleSource = "inferred"; }
        }
        probeState = artifactStatus.state === "COMPLETE" ? "OK" : "PARTIAL";
        characterFound = runs.length > 0;
      } catch {
        // best-effort
      }
    } else {
      // Live probe run
      const identity: UtilityProbeIdentity = {
        region: region as UtilityProbeIdentity["region"],
        realmSlug,
        name,
      };

      const isResumeMerge = hasExplicitFocus && artifactStatus.state === "PARTIAL";
      const resumeTs = Date.now();
      const snapshotDir = join(artifactDir, `.resume-snapshot-${resumeTs}`);
      const stagingDir = join(artifactDir, `.resume-staging-${resumeTs}`);
      const publishDir = join(artifactDir, `.resume-publish-${resumeTs}`);
      const rejectedDir = join(artifactDir, `.resume-rejected-${resumeTs}`);

      let probeOutputDir = artifactDir;
      let priorMissingDungeonReasons: Record<string, string> = {};

      if (isResumeMerge) {
        console.log(`    [resume] snapshotting ${artifactStatus.completedDungeons.length} existing dungeon(s)`);
        await snapshotCanonicalArtifacts(artifactDir, snapshotDir);
        probeOutputDir = stagingDir;
        try {
          const perDungeon = JSON.parse(
            await readFile(join(snapshotDir, "09-utility-per-dungeon.json"), "utf8"),
          ) as { global?: { coverage?: { missingDungeonReasons?: Record<string, string> } } };
          priorMissingDungeonReasons =
            perDungeon.global?.coverage?.missingDungeonReasons ?? {};
        } catch {
          // best-effort
        }
      }

      const { dataset: probeDataset } = await runUtilityProbe({
        identity,
        outputDir: probeOutputDir,
        client: provider.getGraphQlClient(),
        zoneConfig: provider.getZoneConfig(),
        maxRunsPerDungeon,
        maxReportsInspectedPerDungeon: maxReportsPerDungeon,
        maxRecentReportPages: opts.maxRecentReportPages ?? 1,
        focusDungeons: opts.focusDungeons ?? null,
        cleanOutputDir: true,
      });

      probeState = probeDataset.state;
      characterFound = probeDataset.character != null;
      resolvedClassSlug = classSlugFromWclClassId(probeDataset.character?.classID ?? null);
      pointsBefore = probeDataset.rateLimit.initial?.pointsSpentThisHour ?? null;
      pointsAfter = probeDataset.rateLimit.final?.pointsSpentThisHour ?? null;
      probeWclRequests = probeDataset.diagnostics.wclRequestCount;

      if (isResumeMerge) {
        console.log(`    [resume] merging staging into snapshot (${probeDataset.runs.length} new run(s))`);
        const mergeResult = await mergeProbeArtifacts({
          snapshotDir,
          stagingDir,
          publishDir,
          expectedDungeons: ACTIVE_SEASON_DUNGEONS,
          focusDungeons: opts.focusDungeons ?? [],
          priorMissingDungeonReasons,
        });

        if (!mergeResult.ok) {
          const rejectedPath = await persistRejectedMergeCandidate(
            artifactDir,
            rejectedDir,
            mergeResult,
            stagingDir,
          );
          const pointsConsumed =
            pointsBefore != null && pointsAfter != null ? pointsAfter - pointsBefore : null;
          return errorResult(
            `Resume merge rejected: ${mergeResult.violations.map((v) => v.message).join("; ")}`,
            {
              classSlug: resolvedClassSlug,
              specSlug: resolvedSpecSlug,
              artifactState: "PARTIAL",
              completedDungeons: artifactStatus.completedDungeons,
              missingDungeons: artifactStatus.missingDungeons,
              missingDungeonReasons: priorMissingDungeonReasons,
              probeFailure: {
                probeState: "PARTIAL",
                wclErrors: [],
                rejectionReasons: {},
                reportsInspected: 0,
                fightsInspected: 0,
                schemaWarnings: mergeResult.violations.map((v) => v.message),
                characterFound,
                diagnosis: "unknown",
                retryable: true,
                partialArtifactPaths: [rejectedPath, snapshotDir],
              },
              rateCost: {
                pointsBefore,
                pointsAfter,
                pointsConsumed,
                wclRequests: probeWclRequests,
                estimatedCost: null,
                safetyReserve: SAFETY_RESERVE,
                costDecisionReason: "merge_rejected",
              },
            },
          );
        }

        await atomicPublishProbeArtifacts(publishDir, artifactDir);
        console.log(
          `    [resume] published merged artifacts: ${mergeResult.before.runCount} -> ${mergeResult.after.runCount} runs, ` +
          `${mergeResult.before.completedDungeons.length} -> ${mergeResult.after.completedDungeons.length} dungeons`,
        );
        probeState =
          mergeResult.after.completedDungeons.length >= ACTIVE_SEASON_DUNGEONS.length
            ? "OK"
            : "PARTIAL";
      }

      // roleSlug from normalized runs written to disk
      try {
        const runs = JSON.parse(
          await readFile(join(artifactDir, "07-utility-normalized-runs.json"), "utf8"),
        ) as Array<{ specialization?: string | null; roleSlug?: string | null }>;
        resolvedSpecSlug = runs[0]?.specialization ?? null;
        const roleCounts = new Map<string, number>();
        for (const r of runs) {
          if (r.roleSlug) roleCounts.set(r.roleSlug, (roleCounts.get(r.roleSlug) ?? 0) + 1);
        }
        if (roleCounts.size > 0) {
          let best: string | null = null;
          let bestCount = 0;
          for (const [slug, count] of roleCounts) {
            if (count > bestCount) { best = slug; bestCount = count; }
          }
          resolvedRoleSlug = best;
          mixedRole = roleCounts.size > 1;
          roleSource = "zone_rankings";
        }
        if (resolvedRoleSlug === null && resolvedSpecSlug) {
          const inferred = roleForSpec(resolvedSpecSlug);
          if (inferred) { resolvedRoleSlug = inferred; roleSource = "inferred"; }
        }
      } catch {
        resolvedSpecSlug = probeDataset.runs[0]?.specialization ?? null;
      }

      zipDirectoryContents(
        artifactDir,
        join(artifactDir, `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-probe.zip`),
      );

      if (probeDataset.state === "ERROR") {
        const probeFailure = await buildProbeFailureDiagnostics(
          artifactDir,
          "ERROR",
          characterFound,
        );
        const pointsConsumed =
          pointsBefore != null && pointsAfter != null
            ? pointsAfter - pointsBefore
            : null;
        const { estimated, reason } = estimateCharacterCost(ACTIVE_SEASON_DUNGEONS.length, historicalCostPerDungeon);
        return errorResult(
          `Probe state=ERROR — diagnosis: ${probeFailure.diagnosis}. ` +
          `Reports inspected: ${probeFailure.reportsInspected}. ` +
          `Rejection reasons: ${JSON.stringify(probeFailure.rejectionReasons)}. ` +
          (probeFailure.schemaWarnings.length > 0
            ? `Warnings: ${probeFailure.schemaWarnings.join("; ")}.`
            : ""),
          {
            classSlug: resolvedClassSlug,
            artifactState: "ERROR",
            probeFailure,
            rateCost: {
              pointsBefore,
              pointsAfter,
              pointsConsumed,
              wclRequests: probeWclRequests,
              estimatedCost: estimated,
              safetyReserve: SAFETY_RESERVE,
              costDecisionReason: reason,
            },
          },
        );
      }
    }

    // V3 simulation
    const { dataset: v3Dataset } = await runUtilityV3Simulation({
      inputDir: artifactDir,
      outputDir: artifactDir,
    });

    zipDirectoryContents(
      artifactDir,
      join(artifactDir, `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}-utility-v3-simulation.zip`),
    );

    const finalClassSlug = v3Dataset.subject.classSlug ?? resolvedClassSlug;
    const finalSpecSlug = v3Dataset.subject.specSlug ?? resolvedSpecSlug;
    const finalRoleSlug = v3Dataset.subject.roleSlug ?? resolvedRoleSlug;
    const finalMixedRole = v3Dataset.subject.mixedRole ?? mixedRole;
    const finalRoleSource = v3Dataset.subject.roleSource ?? roleSource;

    const updatedArtifactStatus = await detectArtifactState(artifactDir);
    const castStopDiag = await buildCastStopDiagnostics(artifactDir, v3Dataset);

    // Load missingDungeonReasons from merged probe per-dungeon artifact
    let missingDungeonReasons: Record<string, string> = {};
    try {
      const perDungeonPath = join(artifactDir, "09-utility-per-dungeon.json");
      if (existsSync(perDungeonPath)) {
        const perDungeon = JSON.parse(await readFile(perDungeonPath, "utf8")) as {
          global?: { coverage?: { missingDungeonReasons?: Record<string, string> } };
        };
        missingDungeonReasons = perDungeon.global?.coverage?.missingDungeonReasons ?? {};
      }
    } catch { /* best-effort */ }
    // Ensure every missing dungeon has a reason
    for (const slug of updatedArtifactStatus.missingDungeons) {
      if (!missingDungeonReasons[slug]) missingDungeonReasons[slug] = "unknown";
    }

    const missingCount = updatedArtifactStatus.missingDungeons.length;
    const { estimated: estimatedCost, reason: costReason } = estimateCharacterCost(
      missingCount,
      historicalCostPerDungeon,
    );

    const finalResultState =
      updatedArtifactStatus.state === "COMPLETE" ? "COMPLETE" : "PARTIAL";
    const liveWclUsed = needsLiveCalls;
    const pointsConsumed = liveWclUsed && pointsBefore != null && pointsAfter != null
      ? pointsAfter - pointsBefore
      : liveWclUsed ? null : 0;

    return {
      region,
      realmSlug,
      name,
      classSlug: finalClassSlug,
      specSlug: finalSpecSlug,
      roleSlug: finalRoleSlug,
      mixedRole: finalMixedRole,
      roleSource: finalRoleSource,
      state: finalResultState,
      artifactState: updatedArtifactStatus.state,
      completedDungeons: updatedArtifactStatus.completedDungeons,
      missingDungeons: updatedArtifactStatus.missingDungeons,
      missingDungeonReasons: missingDungeonReasons,
      behaviorScore: v3Dataset.global.behaviorScore,
      confidence: v3Dataset.global.confidence,
      semanticBand: v3Dataset.global.semanticBand,
      domainScores: v3Dataset.global.domainScores as Record<string, number | null>,
      redistributedWeights: v3Dataset.global.redistributedWeights as Record<string, number>,
      scoredVsExcludedDomains: v3Dataset.global.scoredVsExcludedDomains,
      runCount: v3Dataset.global.runCount,
      dungeonCount: v3Dataset.global.dungeonCount,
      castStopDiagnostics: castStopDiag,
      rateCost: {
        pointsBefore: liveWclUsed ? pointsBefore : null,
        pointsAfter: liveWclUsed ? pointsAfter : null,
        pointsConsumed,
        wclRequests: liveWclUsed ? probeWclRequests : 0,
        estimatedCost: liveWclUsed ? estimatedCost : 0,
        safetyReserve: SAFETY_RESERVE,
        costDecisionReason: liveWclUsed
          ? costReason
          : noMissingDungeons
            ? "cache_only_no_missing_dungeons"
            : "cache_only_reused_artifacts",
      },
      artifactDir,
      error: null,
      probeFailure: finalResultState === "COMPLETE"
        ? null
        : probeState === "ERROR"
          ? await buildProbeFailureDiagnostics(artifactDir, "ERROR", characterFound)
          : probeState === "PARTIAL"
            ? await buildProbeFailureDiagnostics(artifactDir, "PARTIAL", characterFound)
            : null,
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

  // Active panel = enabled characters (enabled !== false). Disabled diagnostic
  // profiles (Makmakmak/Sjelelele) keep artifacts but never auto-consume WCL
  // quota unless selected via --only AND --force-refetch.
  const isEnabled = (c: CharacterManifestEntry): boolean => c.enabled !== false;
  const panelCharacters = characters.filter(isEnabled);
  let activeCharacters = args.only
    ? characters.filter((c) => args.only!.has(c.name.toLowerCase()))
    : panelCharacters;

  if (args.only) {
    const disabledOnly = activeCharacters.filter((c) => !isEnabled(c) && !args.forceRefetch);
    if (disabledOnly.length > 0) {
      console.warn(
        `WARN: disabled diagnostic character(s) ignored without --force-refetch: ` +
        disabledOnly.map((c) => c.name).join(", "),
      );
    }
    activeCharacters = activeCharacters.filter((c) => isEnabled(c) || args.forceRefetch);
  }

  if (activeCharacters.length === 0) {
    console.error(
      `FAIL: no runnable characters. ` +
      `Available (enabled): ${panelCharacters.map((c) => c.name).join(", ")}. ` +
      `Disabled (need --force-refetch): ${characters.filter((c) => !isEnabled(c)).map((c) => c.name).join(", ") || "(none)"}`,
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

  const flags: string[] = [];
  if (args.resume) flags.push("--resume");
  if (args.resumePartial) flags.push("--resume-partial");
  if (args.retryErrors) flags.push("--retry-errors");
  if (args.forceRefetch) flags.push("--force-refetch");
  if (args.only) flags.push(`--only ${[...args.only].join(",")}`);
  console.log(
    `wcl.probe.utility.cross-class-validate — ${activeCharacters.length}/${characters.length} characters` +
    (flags.length ? ` (${flags.join(", ")})` : ""),
  );

  // ------------------------------------------------------------------
  // Single preflight RateLimitData
  // ------------------------------------------------------------------
  let preflight: WclRateBudgetDecisionDTO | null = null;
  const rateLimitCtx = buildWclRateLimitFetchContext({
    requestId: "utility-cross-class-preflight",
  });

  console.log("\n[preflight] RateLimitData…");
  try {
    preflight = await provider.fetchRateLimit(rateLimitCtx);
    if (!preflight) {
      throw new Error("fetchRateLimit returned null");
    }
    const pct = preflight.utilizationPercent.toFixed(1);
    console.log(
      `  → action=${preflight.action} utilization=${pct}%` +
      ` remaining=${preflight.snapshot.pointsRemaining}/${preflight.snapshot.pointsLimit}` +
      (preflight.snapshot.resetAt ? ` resetAt=${preflight.snapshot.resetAt}` : ""),
    );
    if (preflight.action === "STOP") {
      console.error(
        `  DEFERRED: WCL quota exhausted (${pct}%). ` +
        `Retry after ${preflight.snapshot.resetAt ?? "next hour"}.`,
      );
      const report = buildReport([], characters, "DEFERRED_RATE_LIMIT", rateLimitSummary(preflight), null, activeCharacters);
      await writeReport(reportPath, report);
      process.exit(3);
    }
  } catch (err) {
    console.error(`  WARN: preflight failed — proceeding without rate guard. ${err instanceof Error ? err.message : String(err)}`);
  }

  // ------------------------------------------------------------------
  // Iterate characters
  // ------------------------------------------------------------------
  const results: CharacterValidationResult[] = [];
  let lastGuard: WclRateBudgetDecisionDTO | null = null;
  // Track measured cost per dungeon from processed characters for cost estimation
  const measuredCostsPerDungeon: number[] = [];

  for (let i = 0; i < activeCharacters.length; i += 1) {
    const entry = activeCharacters[i]!;
    const region = entry.region.trim().toUpperCase();
    const realmSlug = entry.realm.trim().toLowerCase();
    const name = entry.name.trim();
    const label = `${region}/${realmSlug}/${name}`;
    const artifactDir = join(
      args.outputRoot,
      `${region.toLowerCase()}-${realmSlug}-${name.toLowerCase()}`,
    );

    console.log(`\n[${i + 1}/${activeCharacters.length}] ${label}`);

    // Detect current artifact state
    const artifactStatus = await detectArtifactState(artifactDir);
    console.log(`  [artifacts] state=${artifactStatus.state} completed=${artifactStatus.completedDungeons.length}/8 missing=${artifactStatus.missingDungeons.length}`);

    // ------------------------------------------------------------------
    // Resume / skip logic
    // ------------------------------------------------------------------
    const cacheOnlyRequested =
      (args.resume || args.resumePartial) &&
      artifactStatus.state === "COMPLETE" &&
      artifactStatus.missingDungeons.length === 0 &&
      !args.forceRefetch;

    if (cacheOnlyRequested) {
      console.log(`  [cache] COMPLETE with no missing dungeons — zero live WCL calls`);
      const result = await validateCharacterCacheOnly(entry, args.outputRoot, { rescore: true });
      results.push(result);
      console.log(
        `  → state=${result.state} class=${result.classSlug ?? "?"} score=${result.behaviorScore ?? "null"} ` +
        `cost=${result.rateCost?.pointsConsumed ?? 0}pts wclRequests=${result.rateCost?.wclRequests ?? 0}`,
      );
      const partialReport = buildReport(
        ensureAllRequestedCharactersInReport(results, activeCharacters, args.outputRoot),
        characters,
        "PARTIAL",
        preflight ? rateLimitSummary(preflight) : null,
        lastGuard ? rateLimitSummary(lastGuard) : null,
        activeCharacters,
      );
      await writeReport(reportPath, partialReport);
      continue;
    }

    if (args.resumePartial && artifactStatus.state === "PARTIAL") {
      console.log(`  [resume-partial] PARTIAL — will fetch only missing ${artifactStatus.missingDungeons.join(", ")}`);
      // Fall through to validateCharacter which will skip the probe (hasProbeArtifacts check inside)
    }

    if (!args.retryErrors && artifactStatus.state === "ERROR" && !needsRun(args, artifactStatus.state)) {
      console.log(`  [skip] artifact state=ERROR and --retry-errors not set — marking SKIPPED`);
      results.push({
        region,
        realmSlug,
        name,
        classSlug: null,
        specSlug: null,
        roleSlug: null,
        mixedRole: false,
        roleSource: "unknown",
        state: "SKIPPED",
        artifactState: "ERROR",
        completedDungeons: [],
        missingDungeons: ACTIVE_SEASON_DUNGEONS,
        missingDungeonReasons: {},
        behaviorScore: null,
        confidence: null,
        semanticBand: null,
        domainScores: {},
        redistributedWeights: {},
        scoredVsExcludedDomains: null,
        runCount: 0,
        dungeonCount: 0,
        castStopDiagnostics: null,
        rateCost: null,
        artifactDir,
        error: "Artifact state=ERROR — use --retry-errors to retry",
        probeFailure: await buildProbeFailureDiagnostics(artifactDir, "ERROR", false),
      });
      const partialReport = buildReport(
        ensureAllRequestedCharactersInReport(results, activeCharacters, args.outputRoot),
        characters,
        "PARTIAL",
        preflight ? rateLimitSummary(preflight) : null,
        lastGuard ? rateLimitSummary(lastGuard) : null,
        activeCharacters,
      );
      await writeReport(reportPath, partialReport);
      continue;
    }

    // ------------------------------------------------------------------
    // Rate-budget guard (only for characters that need live calls)
    // ------------------------------------------------------------------
    const needsLive =
      artifactStatus.state === "NONE" ||
      artifactStatus.state === "ERROR" ||
      (args.resumePartial && artifactStatus.state === "PARTIAL" && artifactStatus.missingDungeons.length > 0);
    if (needsLive) {
      const historicalCostPerDungeon =
        measuredCostsPerDungeon.length > 0
          ? measuredCostsPerDungeon.reduce((a, b) => a + b, 0) / measuredCostsPerDungeon.length
          : null;
      const missingCount = artifactStatus.state === "PARTIAL"
        ? artifactStatus.missingDungeons.length
        : ACTIVE_SEASON_DUNGEONS.length;
      const { estimated: estimatedCost, reason: costReason } = estimateCharacterCost(
        missingCount,
        historicalCostPerDungeon,
      );

      try {
        const guard = await provider.fetchRateLimit(
          buildWclRateLimitFetchContext({
            requestId: `utility-cross-class-guard-${i}`,
          }),
        );
        lastGuard = guard;
        const pct = guard.utilizationPercent.toFixed(1);
        const remaining = guard.snapshot.pointsRemaining;
        const required = estimatedCost + SAFETY_RESERVE;
        console.log(
          `  [rate-guard] action=${guard.action} utilization=${pct}% remaining=${remaining}` +
          ` estimatedCost=${estimatedCost.toFixed(0)} safetyReserve=${SAFETY_RESERVE} required=${required.toFixed(0)}` +
          (guard.snapshot.resetAt ? ` resetAt=${guard.snapshot.resetAt}` : ""),
        );

        if (guard.action === "STOP" || guard.action === "DEFER" || remaining < required) {
          const reason = guard.action === "STOP" || guard.action === "DEFER"
            ? `WCL rate budget ${guard.action} at ${pct}%`
            : `insufficient quota: ${remaining} remaining < ${required.toFixed(0)} required (${costReason})`;
          console.error(`  DEFERRED: ${reason}. Remaining characters will not be attempted.`);

          for (let j = i; j < activeCharacters.length; j += 1) {
            const e = activeCharacters[j]!;
            const r = e.region.trim().toUpperCase();
            const rl = e.realm.trim().toLowerCase();
            const n = e.name.trim();
            results.push({
              region: r, realmSlug: rl, name: n,
              classSlug: null, specSlug: null, roleSlug: null,
              mixedRole: false, roleSource: "unknown",
              state: "DEFERRED_RATE_LIMIT",
              artifactState: "NONE", completedDungeons: [], missingDungeons: ACTIVE_SEASON_DUNGEONS,
              missingDungeonReasons: {},
              behaviorScore: null, confidence: null, semanticBand: null,
              domainScores: {}, redistributedWeights: {}, scoredVsExcludedDomains: null,
              runCount: 0, dungeonCount: 0, castStopDiagnostics: null,
              rateCost: {
                pointsBefore: null, pointsAfter: null, pointsConsumed: null,
                wclRequests: null, estimatedCost,
                safetyReserve: SAFETY_RESERVE, costDecisionReason: reason,
              },
              artifactDir: join(args.outputRoot, `${r.toLowerCase()}-${rl}-${n.toLowerCase()}`),
              error: reason, probeFailure: null,
            });
          }
          break;
        }
      } catch (err) {
        console.warn(`  WARN: rate-guard check failed — proceeding. ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ------------------------------------------------------------------
    // Run probe + V3
    // ------------------------------------------------------------------
    const historicalCostPerDungeon =
      measuredCostsPerDungeon.length > 0
        ? measuredCostsPerDungeon.reduce((a, b) => a + b, 0) / measuredCostsPerDungeon.length
        : null;
    // For PARTIAL resume, pass missingDungeons as focusDungeons
    const partialFocusDungeons =
      args.resumePartial &&
      artifactStatus.state === "PARTIAL" &&
      artifactStatus.missingDungeons.length > 0
        ? artifactStatus.missingDungeons
        : null;
    const result = await validateCharacter(
      entry,
      args.outputRoot,
      provider,
      args.maxRunsPerDungeon,
      args.maxReportsPerDungeon,
      historicalCostPerDungeon,
      {
        focusDungeons: partialFocusDungeons,
        maxRecentReportPages: args.maxRecentReportPages,
        forceRefetch: args.forceRefetch,
      },
    );
    results.push(result);

    // Update historical cost model
    if (result.rateCost?.pointsConsumed != null && result.dungeonCount > 0) {
      measuredCostsPerDungeon.push(result.rateCost.pointsConsumed / result.dungeonCount);
    }

    console.log(
      `  → state=${result.state} class=${result.classSlug ?? "?"} spec=${result.specSlug ?? "?"} ` +
      `role=${result.roleSlug ?? "?"} score=${result.behaviorScore ?? "null"} ` +
      `cost=${result.rateCost?.pointsConsumed ?? "?"}pts`,
    );
    if (result.castStopDiagnostics?.sampleSizeWarning) {
      console.warn(`  [castStops] ${result.castStopDiagnostics.sampleSizeWarning}`);
    }
    if (result.probeFailure) {
      console.log(`  [probeFailure] diagnosis=${result.probeFailure.diagnosis} retryable=${result.probeFailure.retryable}`);
    }

    // Persist after every character
    const partialBatchStatus: BatchStatus =
      result.state === "DEFERRED_RATE_LIMIT" ? "DEFERRED_RATE_LIMIT" : "PARTIAL";
    const partialReport = buildReport(
      ensureAllRequestedCharactersInReport(results, activeCharacters, args.outputRoot),
      characters,
      partialBatchStatus,
      preflight ? rateLimitSummary(preflight) : null,
      lastGuard ? rateLimitSummary(lastGuard) : null,
      activeCharacters,
    );
    await writeReport(reportPath, partialReport);
  }

  // Ensure every --only character appears in the final report
  const finalResults = ensureAllRequestedCharactersInReport(results, activeCharacters, args.outputRoot);

  // ------------------------------------------------------------------
  // Final report
  // ------------------------------------------------------------------
  const hasDeferred = finalResults.some((r) => r.state === "DEFERRED_RATE_LIMIT");
  const hasError = finalResults.some((r) => r.state === "ERROR");
  const allComplete = finalResults.every((r) => r.state === "COMPLETE" || r.state === "SKIPPED");
  const batchStatus: BatchStatus = hasDeferred
    ? "DEFERRED_RATE_LIMIT"
    : allComplete ? "OK"
      : hasError ? (finalResults.every((r) => r.state === "ERROR") ? "ERROR" : "PARTIAL")
        : finalResults.some((r) => r.state === "PARTIAL") ? "PARTIAL"
          : "OK";

  const finalReport = buildReport(
    finalResults,
    characters,
    batchStatus,
    preflight ? rateLimitSummary(preflight) : null,
    lastGuard ? rateLimitSummary(lastGuard) : null,
    activeCharacters,
  );
  await writeReport(reportPath, finalReport);

  console.log("\nwcl.probe.utility.cross-class-validate — complete");
  console.log(JSON.stringify({
    validatedAt: finalReport.validatedAt,
    batchStatus,
    rateLimit: finalReport.rateLimit,
    summary: finalReport.summary,
    characters: finalResults.map((r) => ({
      character: `${r.region}/${r.realmSlug}/${r.name}`,
      classSlug: r.classSlug,
      specSlug: r.specSlug,
      roleSlug: r.roleSlug,
      mixedRole: r.mixedRole,
      state: r.state,
      artifactState: r.artifactState,
      completedDungeons: r.completedDungeons.length,
      missingDungeons: r.missingDungeons,
      behaviorScore: r.behaviorScore,
      confidence: r.confidence,
      semanticBand: r.semanticBand,
      runCount: r.runCount,
      castStopWarning: r.castStopDiagnostics?.sampleSizeWarning ?? null,
      rateCost: r.rateCost ? {
        pointsConsumed: r.rateCost.pointsConsumed,
        wclRequests: r.rateCost.wclRequests,
        estimatedCost: r.rateCost.estimatedCost,
      } : null,
      probeDiagnosis: r.probeFailure?.diagnosis ?? null,
      error: r.error,
    })),
    reportPath,
  }, null, 2));

  if (batchStatus === "DEFERRED_RATE_LIMIT") {
    console.error(
      `\nDEFERRED: ${finalReport.summary.deferred} character(s) deferred. ` +
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

/** Determine if a character needs to be run given the current CLI flags and artifact state. */
function needsRun(
  args: { resume: boolean; resumePartial: boolean; retryErrors: boolean },
  state: ArtifactState,
): boolean {
  if (state === "NONE") return true;
  if (state === "ERROR") return args.retryErrors;
  if (state === "PARTIAL") return args.resumePartial || args.resume;
  if (state === "COMPLETE") return false;
  return true;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
