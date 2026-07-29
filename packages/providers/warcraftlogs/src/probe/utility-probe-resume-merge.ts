/**
 * Resume merge for Utility probe artifacts.
 *
 * Resume must be append/merge, never replace. The probe writes to a staging
 * directory; this module merges staging output with a pre-resume snapshot and
 * atomically publishes the result only when coherence guards pass.
 */
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateUtilityDungeon,
  buildUtilityGlobalSummary,
  summarizeUtilityRun,
} from "./utility-probe-logic.js";
import type { UtilityNormalizedRun } from "./utility-probe-types.js";

export const PROBE_ARTIFACT_FILES = [
  "01-utility-run-selection.json",
  "02-master-data.json",
  "03-interrupts-raw.json",
  "04-casts-raw.json",
  "05-buffs-debuffs-raw.json",
  "06-dispels-raw.json",
  "07-utility-normalized-runs.json",
  "08-utility-opportunities.json",
  "09-utility-per-dungeon.json",
  "10-utility-diagnostics.json",
] as const;

export const V3_ARTIFACT_FILES = [
  "23-utility-v3-simulation-config.json",
  "24-utility-v3-evidence-inventory.json",
  "25-utility-v3-domain-scores.json",
  "26-utility-v3-runs.json",
  "27-utility-v3-per-dungeon.json",
  "28-utility-v3-global.json",
  "29-utility-v3-sensitivity.json",
  "30-utility-v3-simulation-summary.json",
] as const;

export type MissingDungeonReason =
  | "no_candidates"
  | "actor_absent"
  | "report_cap_reached"
  | "actor_absent_and_cap_reached"
  | "report_private"
  | "outside_report_window"
  | "unknown";

export interface RunIdentity {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  playerActorId: number;
}

export interface MergeCoherenceSnapshot {
  completedDungeons: string[];
  runCount: number;
  runIdentities: string[];
}

export interface MergeCoherenceViolation {
  code:
    | "completed_dungeon_count_decreased"
    | "valid_run_count_decreased"
    | "existing_dungeon_lost"
    | "existing_run_lost"
    | "schema_validation_failed";
  message: string;
  details?: Record<string, unknown>;
}

export interface MergeProbeArtifactsInput {
  snapshotDir: string;
  stagingDir: string;
  publishDir: string;
  expectedDungeons: string[];
  focusDungeons: string[];
  priorMissingDungeonReasons?: Record<string, string>;
}

export interface MergeProbeArtifactsResult {
  ok: boolean;
  violations: MergeCoherenceViolation[];
  before: MergeCoherenceSnapshot;
  after: MergeCoherenceSnapshot;
  mergedDir: string | null;
  missingDungeonReasons: Record<string, string>;
  addedRunIdentities: string[];
  preservedRunIdentities: string[];
}

type RawRunEntry = { runId: string; reportCode: string; fightId: number; [key: string]: unknown };
type RunSelectionPayload = {
  probedAt?: string;
  identity?: unknown;
  activeDungeonPool?: string[];
  candidatesByDungeon?: Record<string, unknown[]>;
  rejected?: Array<{ reportCode: string; fightId: number; dungeonSlug: string | null; reason: string }>;
  selectedRuns?: Array<{
    runId: string;
    dungeonSlug: string;
    reportCode: string;
    fightId: number;
    playerActorId: number;
    ownedPetActorIds?: number[];
  }>;
};
type OpportunityEntry = {
  runId: string;
  reportCode: string;
  fightId: number;
  [key: string]: unknown;
};

export function runIdentityKey(run: RunIdentity): string {
  return `${run.reportCode}:${run.fightId}:${run.dungeonSlug}:${run.playerActorId}`;
}

export function runIdentityFromNormalized(run: UtilityNormalizedRun): RunIdentity {
  return {
    reportCode: run.reportCode,
    fightId: run.fightId,
    dungeonSlug: run.dungeonSlug,
    playerActorId: run.playerActorId,
  };
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJsonFile(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function snapshotCanonicalArtifacts(
  canonicalDir: string,
  snapshotDir: string,
): Promise<void> {
  await mkdir(snapshotDir, { recursive: true });
  for (const file of [...PROBE_ARTIFACT_FILES, ...V3_ARTIFACT_FILES]) {
    const src = join(canonicalDir, file);
    if (!existsSync(src)) continue;
    await copyFile(src, join(snapshotDir, file));
  }
}

function mergeByRunId<T extends { runId: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map<string, T>();
  for (const entry of existing) byId.set(entry.runId, entry);
  for (const entry of incoming) byId.set(entry.runId, entry);
  return [...byId.values()];
}

function mergeMasterData(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

function mergeRunSelection(
  existing: RunSelectionPayload,
  incoming: RunSelectionPayload,
): RunSelectionPayload {
  const candidatesByDungeon: Record<string, unknown[]> = {
    ...(existing.candidatesByDungeon ?? {}),
  };
  for (const [slug, rows] of Object.entries(incoming.candidatesByDungeon ?? {})) {
    const prior = candidatesByDungeon[slug] ?? [];
    candidatesByDungeon[slug] = [...prior, ...rows];
  }

  const rejected = [...(existing.rejected ?? []), ...(incoming.rejected ?? [])];
  const selectedById = new Map<string, NonNullable<RunSelectionPayload["selectedRuns"]>[number]>();
  for (const row of existing.selectedRuns ?? []) selectedById.set(row.runId, row);
  for (const row of incoming.selectedRuns ?? []) selectedById.set(row.runId, row);

  return {
    probedAt: incoming.probedAt ?? existing.probedAt,
    identity: incoming.identity ?? existing.identity,
    activeDungeonPool: incoming.activeDungeonPool ?? existing.activeDungeonPool,
    candidatesByDungeon,
    rejected,
    selectedRuns: [...selectedById.values()],
  };
}

function mergeDiagnostics(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const existingReports = new Set((existing.reportsInspected as string[] | undefined) ?? []);
  for (const code of (incoming.reportsInspected as string[] | undefined) ?? []) {
    existingReports.add(code);
  }
  const existingFights = [
    ...((existing.fightsInspected as Array<{ reportCode: string; fightId: number }>) ?? []),
    ...((incoming.fightsInspected as Array<{ reportCode: string; fightId: number }>) ?? []),
  ];
  const existingRejected = [
    ...((existing.candidateRunsRejected as unknown[]) ?? []),
    ...((incoming.candidateRunsRejected as unknown[]) ?? []),
  ];
  const schemaWarnings = [
    ...new Set([
      ...((existing.schemaWarnings as string[] | undefined) ?? []),
      ...((incoming.schemaWarnings as string[] | undefined) ?? []),
    ]),
  ];
  return {
    ...existing,
    ...incoming,
    reportsInspected: [...existingReports],
    fightsInspected: existingFights,
    candidateRunsRejected: existingRejected,
    schemaWarnings,
    resumeMerge: {
      mergedAt: new Date().toISOString(),
      preservedFromSnapshot: true,
      appendedFromStaging: true,
    },
  };
}

export function classifyMissingDungeonReason(
  slug: string,
  candidates: unknown[],
  rejections: Array<{ dungeonSlug: string | null; reason: string }>,
  priorReasons: Record<string, string>,
): MissingDungeonReason | string {
  if (priorReasons[slug]) return priorReasons[slug];
  if (candidates.length === 0) return "no_candidates";
  const dungeonRejections = rejections
    .filter((r) => r.dungeonSlug === slug)
    .map((r) => r.reason);
  if (dungeonRejections.length === 0) return "unknown";
  const hasActorAbsent = dungeonRejections.some((r) => r.includes("player_actor_not_in_fight"));
  const hasReportCap = dungeonRejections.some((r) =>
    r.includes("max_reports_inspected_per_dungeon_cap") || r.includes("over_report_cap"),
  );
  const hasPrivate = dungeonRejections.some((r) => r.includes("private") || r.includes("unauthorized"));
  const hasOutsideWindow = dungeonRejections.some((r) =>
    r.includes("outside") || r.includes("hydrate_report_too_old"),
  );
  if (hasPrivate) return "report_private";
  if (hasOutsideWindow && !hasActorAbsent) return "outside_report_window";
  if (hasActorAbsent && hasReportCap) return "actor_absent_and_cap_reached";
  if (hasActorAbsent) return "actor_absent";
  if (hasReportCap) return "report_cap_reached";
  return dungeonRejections[0] ?? "unknown";
}

export function buildMissingDungeonReasons(
  expectedDungeons: string[],
  mergedRuns: UtilityNormalizedRun[],
  runSelection: RunSelectionPayload,
  priorReasons: Record<string, string>,
): Record<string, string> {
  const completed = new Set(mergedRuns.map((r) => r.dungeonSlug));
  const reasons: Record<string, string> = {};
  const rejections = runSelection.rejected ?? [];
  for (const slug of expectedDungeons) {
    if (completed.has(slug)) continue;
    const candidates = runSelection.candidatesByDungeon?.[slug] ?? [];
    reasons[slug] = classifyMissingDungeonReason(slug, candidates, rejections, priorReasons);
  }
  return reasons;
}

function snapshotFromRuns(runs: UtilityNormalizedRun[]): MergeCoherenceSnapshot {
  const completedDungeons = [...new Set(runs.map((r) => r.dungeonSlug))].sort();
  const runIdentities = runs.map((r) => runIdentityKey(runIdentityFromNormalized(r))).sort();
  return { completedDungeons, runCount: runs.length, runIdentities };
}

export function validateMergeCoherence(
  before: MergeCoherenceSnapshot,
  after: MergeCoherenceSnapshot,
): MergeCoherenceViolation[] {
  const violations: MergeCoherenceViolation[] = [];
  if (after.completedDungeons.length < before.completedDungeons.length) {
    violations.push({
      code: "completed_dungeon_count_decreased",
      message: `Completed dungeon count decreased from ${before.completedDungeons.length} to ${after.completedDungeons.length}`,
      details: { before: before.completedDungeons, after: after.completedDungeons },
    });
  }
  if (after.runCount < before.runCount) {
    violations.push({
      code: "valid_run_count_decreased",
      message: `Valid run count decreased from ${before.runCount} to ${after.runCount}`,
      details: { before: before.runCount, after: after.runCount },
    });
  }
  for (const slug of before.completedDungeons) {
    if (!after.completedDungeons.includes(slug)) {
      violations.push({
        code: "existing_dungeon_lost",
        message: `Previously completed dungeon '${slug}' is missing after merge`,
      });
    }
  }
  const afterSet = new Set(after.runIdentities);
  for (const id of before.runIdentities) {
    if (!afterSet.has(id)) {
      violations.push({
        code: "existing_run_lost",
        message: `Previously valid run '${id}' disappeared after merge`,
      });
    }
  }
  return violations;
}

export async function mergeProbeArtifacts(
  input: MergeProbeArtifactsInput,
): Promise<MergeProbeArtifactsResult> {
  const {
    snapshotDir,
    stagingDir,
    publishDir,
    expectedDungeons,
    priorMissingDungeonReasons = {},
  } = input;

  const existingRuns = await readJsonFile<UtilityNormalizedRun[]>(
    join(snapshotDir, "07-utility-normalized-runs.json"),
    [],
  );
  const stagingRuns = await readJsonFile<UtilityNormalizedRun[]>(
    join(stagingDir, "07-utility-normalized-runs.json"),
    [],
  );

  const before = snapshotFromRuns(existingRuns);

  const mergedByIdentity = new Map<string, UtilityNormalizedRun>();
  for (const run of existingRuns) {
    mergedByIdentity.set(runIdentityKey(runIdentityFromNormalized(run)), run);
  }
  const addedRunIdentities: string[] = [];
  for (const run of stagingRuns) {
    const key = runIdentityKey(runIdentityFromNormalized(run));
    if (!mergedByIdentity.has(key)) addedRunIdentities.push(key);
    mergedByIdentity.set(key, run);
  }
  const mergedRuns = [...mergedByIdentity.values()].sort((a, b) => {
    const d = a.dungeonSlug.localeCompare(b.dungeonSlug);
    if (d !== 0) return d;
    return `${a.reportCode}:${a.fightId}`.localeCompare(`${b.reportCode}:${b.fightId}`);
  });

  const after = snapshotFromRuns(mergedRuns);
  const violations = validateMergeCoherence(before, after);
  if (violations.length > 0) {
    return {
      ok: false,
      violations,
      before,
      after,
      mergedDir: null,
      missingDungeonReasons: {},
      addedRunIdentities,
      preservedRunIdentities: before.runIdentities,
    };
  }

  await mkdir(publishDir, { recursive: true });

  const existingSelection = await readJsonFile<RunSelectionPayload>(
    join(snapshotDir, "01-utility-run-selection.json"),
    {},
  );
  const stagingSelection = await readJsonFile<RunSelectionPayload>(
    join(stagingDir, "01-utility-run-selection.json"),
    {},
  );
  const mergedSelection = mergeRunSelection(existingSelection, stagingSelection);

  const existingMaster = await readJsonFile<Record<string, unknown>>(
    join(snapshotDir, "02-master-data.json"),
    {},
  );
  const stagingMaster = await readJsonFile<Record<string, unknown>>(
    join(stagingDir, "02-master-data.json"),
    {},
  );

  const mergeRaw = async (file: string) => {
    const existing = await readJsonFile<RawRunEntry[]>(join(snapshotDir, file), []);
    const incoming = await readJsonFile<RawRunEntry[]>(join(stagingDir, file), []);
    return mergeByRunId(existing, incoming);
  };

  const mergedInterrupts = await mergeRaw("03-interrupts-raw.json");
  const mergedCasts = await mergeRaw("04-casts-raw.json");
  const mergedBuffsDebuffs = await mergeRaw("05-buffs-debuffs-raw.json");
  const mergedDispels = await mergeRaw("06-dispels-raw.json");

  const existingOpportunities = await readJsonFile<OpportunityEntry[]>(
    join(snapshotDir, "08-utility-opportunities.json"),
    [],
  );
  const stagingOpportunities = await readJsonFile<OpportunityEntry[]>(
    join(stagingDir, "08-utility-opportunities.json"),
    [],
  );

  const existingDiagnostics = await readJsonFile<Record<string, unknown>>(
    join(snapshotDir, "10-utility-diagnostics.json"),
    {},
  );
  const stagingDiagnostics = await readJsonFile<Record<string, unknown>>(
    join(stagingDir, "10-utility-diagnostics.json"),
    {},
  );

  const summaries = mergedRuns.map((r) => summarizeUtilityRun(r));
  const perDungeon = expectedDungeons.map((slug) =>
    aggregateUtilityDungeon(
      slug,
      summaries.filter((s) => s.dungeonSlug === slug),
    ),
  );
  const missingDungeonReasons = buildMissingDungeonReasons(
    expectedDungeons,
    mergedRuns,
    mergedSelection,
    priorMissingDungeonReasons,
  );
  const global = buildUtilityGlobalSummary(perDungeon, expectedDungeons, missingDungeonReasons);

  await Promise.all([
    writeJsonFile(join(publishDir, "01-utility-run-selection.json"), mergedSelection),
    writeJsonFile(join(publishDir, "02-master-data.json"), mergeMasterData(existingMaster, stagingMaster)),
    writeJsonFile(join(publishDir, "03-interrupts-raw.json"), mergedInterrupts),
    writeJsonFile(join(publishDir, "04-casts-raw.json"), mergedCasts),
    writeJsonFile(join(publishDir, "05-buffs-debuffs-raw.json"), mergedBuffsDebuffs),
    writeJsonFile(join(publishDir, "06-dispels-raw.json"), mergedDispels),
    writeJsonFile(join(publishDir, "07-utility-normalized-runs.json"), mergedRuns),
    writeJsonFile(
      join(publishDir, "08-utility-opportunities.json"),
      mergeByRunId(existingOpportunities, stagingOpportunities),
    ),
    writeJsonFile(join(publishDir, "09-utility-per-dungeon.json"), { perDungeon, global }),
    writeJsonFile(
      join(publishDir, "10-utility-diagnostics.json"),
      mergeDiagnostics(existingDiagnostics, stagingDiagnostics),
    ),
  ]);

  return {
    ok: true,
    violations: [],
    before,
    after,
    mergedDir: publishDir,
    missingDungeonReasons,
    addedRunIdentities,
    preservedRunIdentities: before.runIdentities,
  };
}

export async function persistRejectedMergeCandidate(
  canonicalDir: string,
  rejectedDir: string,
  mergeResult: MergeProbeArtifactsResult,
  stagingDir: string,
): Promise<string> {
  await mkdir(rejectedDir, { recursive: true });
  await writeJsonFile(join(rejectedDir, "merge-rejected.json"), {
    rejectedAt: new Date().toISOString(),
    violations: mergeResult.violations,
    before: mergeResult.before,
    after: mergeResult.after,
    stagingDir,
  });
  if (existsSync(stagingDir)) {
    for (const file of PROBE_ARTIFACT_FILES) {
      const src = join(stagingDir, file);
      if (existsSync(src)) await copyFile(src, join(rejectedDir, file));
    }
  }
  return rejectedDir;
}

export async function atomicPublishProbeArtifacts(
  publishDir: string,
  canonicalDir: string,
): Promise<void> {
  await mkdir(canonicalDir, { recursive: true });
  for (const file of PROBE_ARTIFACT_FILES) {
    const src = join(publishDir, file);
    if (!existsSync(src)) continue;
    const dest = join(canonicalDir, file);
    const tmp = `${dest}.tmp`;
    await copyFile(src, tmp);
    await rename(tmp, dest);
  }
  for (const file of V3_ARTIFACT_FILES) {
    const target = join(canonicalDir, file);
    if (existsSync(target)) await rm(target, { force: true });
  }
}

export async function findLatestSnapshotDir(artifactDir: string): Promise<string | null> {
  if (!existsSync(artifactDir)) return null;
  const entries = await readdir(artifactDir, { withFileTypes: true });
  const snapshots = entries
    .filter((e) => e.isDirectory() && e.name.startsWith(".resume-snapshot-"))
    .map((e) => e.name)
    .sort()
    .reverse();
  return snapshots.length > 0 ? join(artifactDir, snapshots[0]!) : null;
}
