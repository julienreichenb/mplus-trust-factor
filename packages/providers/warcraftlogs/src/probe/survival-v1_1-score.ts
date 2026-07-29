import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAbilityCatalog } from "@mplus/abilities";
import type { WclGraphQlClient } from "../client/graphql-client.js";
import { CURRENT_MPLUS_ZONE_DUNGEON_SLUGS } from "../discovery/run-discovery.js";
import type { SurvivalCalibrationDataset, SurvivalCalibrationRun } from "./survival-calibration-types.js";
import { activeSeasonDungeonPool, classSlugFromWclClassId } from "./survival-probe-logic.js";
import type { SurvivalProbeIdentity } from "./survival-probe-types.js";
import { SURVIVAL_STANDALONE_V1_1_CONFIG } from "./survival-v1_1-config.js";
import { discoverHealthSourcesForRun } from "./survival-v1_1-discovery.js";
import {
  collectExplicitHealthSnapshots,
  collectHealthFromPlayerDetails,
  discoverHealthSchemaVariants,
  resolveMaxHpFromSnapshots,
} from "./survival-v1_1-health.js";
import {
  aggregateSurvivalV1_1,
  buildTimelineForRun,
  determineScoreMode,
  scoreSurvivalV1_1Run,
} from "./survival-v1_1-logic.js";
import type {
  ExplicitHealthSnapshot,
  HealthSchemaVariant,
  SurvivalV1_1DefensiveCoverageKind,
  SurvivalV1_1RecoveryCoverageKind,
  SurvivalV1_1ScoreDataset,
} from "./survival-v1_1-types.js";

async function writeJson(path: string, payload: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mergeSchemaVariants(variants: HealthSchemaVariant[]): HealthSchemaVariant[] {
  const map = new Map<string, HealthSchemaVariant>();
  for (const v of variants) {
    const key = `${v.dataType}|${v.path}|${v.sampleValueType}`;
    const existing = map.get(key);
    if (existing) existing.occurrenceCount += v.occurrenceCount;
    else map.set(key, { ...v });
  }
  return [...map.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

function sumCounts<T extends string>(
  items: Array<Record<T, number>>,
  empty: Record<T, number>,
): Record<T, number> {
  const out = { ...empty };
  for (const item of items) {
    for (const key of Object.keys(empty) as T[]) {
      out[key] += item[key] ?? 0;
    }
  }
  return out;
}

export async function loadCalibrationSummary(
  inputDir: string,
): Promise<Pick<SurvivalCalibrationDataset, "runs" | "identity" | "character">> {
  const summaryPath = join(inputDir, "00-calibration-summary.json");
  const raw = JSON.parse(await readFile(summaryPath, "utf8")) as SurvivalCalibrationDataset;
  return {
    runs: raw.runs,
    identity: raw.identity,
    character: raw.character,
  };
}

export async function runSurvivalV1_1Pipeline(options: {
  calibration: Pick<SurvivalCalibrationDataset, "runs" | "identity" | "character">;
  outputDir: string;
  client?: WclGraphQlClient;
  /** Skip live discovery and use cached discovery artifact if present. */
  discoveryCachePath?: string;
  /** Rebuild snapshots from preserved raw-include-resources dir (no WCL calls). */
  reprocessRawDir?: string;
  fetchNarrowAllAroundDeath?: boolean;
  fetchCastBuffResources?: boolean;
  v1GlobalScore?: number | null;
  v1PerDungeon?: Array<{ dungeonSlug: string; medianScore: number | null }>;
  now?: Date;
}): Promise<{ dataset: SurvivalV1_1ScoreDataset; outputFiles: Record<string, string> }> {
  const identity = options.calibration.identity as SurvivalProbeIdentity;
  const classSlug = classSlugFromWclClassId(options.calibration.character?.classID ?? null);
  const expected = activeSeasonDungeonPool(CURRENT_MPLUS_ZONE_DUNGEON_SLUGS);
  const catalog = getAbilityCatalog({
    classSlug,
    specSlug: options.calibration.runs[0]?.specialization ?? null,
  });

  let totalRequests = 0;
  const allSchema: HealthSchemaVariant[] = [];
  const perRunSnapshots = new Map<string, ExplicitHealthSnapshot[]>();
  const perRunPagesComplete = new Map<string, boolean>();
  const rawPayloadDir = join(options.outputDir, "raw-include-resources");
  await mkdir(rawPayloadDir, { recursive: true });

  if (options.discoveryCachePath) {
    const cached = JSON.parse(await readFile(options.discoveryCachePath, "utf8")) as {
      wclRequestCount?: number;
      runs: Array<{
        runId: string;
        snapshots: ExplicitHealthSnapshot[];
        schemaVariants: HealthSchemaVariant[];
        eventPagesComplete?: boolean;
      }>;
    };
    totalRequests = cached.wclRequestCount ?? 0;
    for (const r of cached.runs) {
      perRunSnapshots.set(r.runId, r.snapshots);
      perRunPagesComplete.set(r.runId, r.eventPagesComplete ?? true);
      allSchema.push(...r.schemaVariants);
    }
  } else if (options.reprocessRawDir) {
    // Rebuild snapshots from preserved includeResources payloads (no new WCL calls).
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(options.reprocessRawDir);
    const runById = new Map(options.calibration.runs.map((r) => [r.runId, r]));
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const payload = JSON.parse(
        await readFile(join(options.reprocessRawDir, file), "utf8"),
      ) as {
        runId: string;
        datasets: Array<{
          dataType: string;
          state: string;
          truncated: boolean;
          rawPages: Array<{ rawResponseData: unknown }>;
        }>;
      };
      const run = runById.get(payload.runId);
      if (!run) continue;
      const snapshots: ExplicitHealthSnapshot[] = [];
      let truncated = false;
      for (const ds of payload.datasets) {
        if (ds.truncated || ds.state === "ERROR") truncated = true;
        for (const page of ds.rawPages) {
          allSchema.push(
            ...discoverHealthSchemaVariants(
              page.rawResponseData,
              `${payload.runId}:${ds.dataType}`,
              ds.dataType,
            ),
          );
          if (ds.dataType === "playerDetails") {
            snapshots.push(
              ...collectHealthFromPlayerDetails(
                page.rawResponseData,
                run.playerActorId,
                options.calibration.identity.name,
              ),
            );
            continue;
          }
          const events =
            (
              page.rawResponseData as {
                reportData?: { report?: { events?: { data?: Array<Record<string, unknown>> } } };
              } | null
            )?.reportData?.report?.events?.data ?? [];
          snapshots.push(
            ...collectExplicitHealthSnapshots(events, ds.dataType, run.playerActorId),
          );
        }
      }
      perRunSnapshots.set(payload.runId, snapshots);
      perRunPagesComplete.set(payload.runId, !truncated);
    }
    totalRequests = 0;
  } else if (options.client) {
    for (const run of options.calibration.runs) {
      const discovery = await discoverHealthSourcesForRun(options.client, {
        identity,
        run,
        fetchNarrowAllAroundDeath: options.fetchNarrowAllAroundDeath ?? true,
        fetchCastBuffResources: options.fetchCastBuffResources ?? false,
      });
      totalRequests += discovery.wclRequestCount;
      perRunSnapshots.set(run.runId, discovery.snapshots);
      const truncated = discovery.datasets.some((d) => d.truncated || d.state === "ERROR");
      perRunPagesComplete.set(run.runId, !truncated);
      allSchema.push(...discovery.schemaVariants);

      await writeJson(join(rawPayloadDir, `${run.runId.replace(":", "_")}.json`), {
        runId: run.runId,
        datasets: discovery.datasets.map((d) => ({
          dataType: d.dataType,
          includeResources: d.includeResources,
          state: d.state,
          pageCount: d.pageCount,
          eventCount: d.eventCount,
          truncated: d.truncated,
          errors: d.errors,
          // Preserve raw page envelopes for auditability
          rawPages: d.rawPages,
        })),
        snapshots: discovery.snapshots,
      });
    }
  } else {
    // Offline fallback: inspect calibration payloads only (no includeResources).
    for (const run of options.calibration.runs) {
      perRunSnapshots.set(run.runId, []);
      perRunPagesComplete.set(run.runId, false);
    }
  }

  const maxHpResolutions = [];
  const healthTimelines = [];
  const runScores = [];
  const allWindows = [];
  const allReactions = [];

  for (const run of options.calibration.runs) {
    const snapshots = perRunSnapshots.get(run.runId) ?? [];
    const pagesComplete = perRunPagesComplete.get(run.runId) ?? false;
    const maxHpResolution = resolveMaxHpFromSnapshots({
      runId: run.runId,
      reportCode: run.reportCode,
      fightId: run.fightId,
      dungeonSlug: run.dungeonSlug,
      snapshots,
    });
    maxHpResolutions.push(maxHpResolution);

    const timeline =
      maxHpResolution.maxHp != null
        ? buildTimelineForRun(run, maxHpResolution.maxHp, snapshots, pagesComplete)
        : null;
    if (timeline) healthTimelines.push(timeline);

    const runCatalog = getAbilityCatalog({
      classSlug,
      specSlug: run.specialization,
    });
    const scored = scoreSurvivalV1_1Run({
      run,
      catalog: runCatalog.supported ? runCatalog : catalog,
      classSlug,
      maxHpResolution,
      healthTimeline: timeline,
      eventPagesComplete: pagesComplete,
    });
    runScores.push(scored.runScore);
    allWindows.push(...scored.dangerWindows);
    allReactions.push(...scored.reactionOpportunities);
  }

  const completeHealthRuns = runScores.filter(
    (r) => r.maxHp != null && r.healthTimelineComplete,
  ).length;
  const runsWithValidMaxHp = runScores.filter((r) => r.maxHp != null).length;
  const scoreMode = determineScoreMode(runsWithValidMaxHp, completeHealthRuns, runScores.length);
  const { perDungeon, global } = aggregateSurvivalV1_1(runScores, expected, scoreMode);

  const emptyDef = {
    proactive: 0,
    reactive: 0,
    death_only: 0,
    eligible_miss: 0,
    unavailable: 0,
    insufficient_reaction_time: 0,
    not_applicable: 0,
  } satisfies Record<SurvivalV1_1DefensiveCoverageKind, number>;
  const emptyRec = {
    covered: 0,
    eligible_miss: 0,
    insufficient_reaction_time: 0,
    death_only_health_context_unavailable: 0,
    not_applicable: 0,
  } satisfies Record<SurvivalV1_1RecoveryCoverageKind, number>;

  const dataset: SurvivalV1_1ScoreDataset = {
    probeVersion: "survival-standalone-v1.1",
    scoredAt: (options.now ?? new Date()).toISOString(),
    config: SURVIVAL_STANDALONE_V1_1_CONFIG,
    schemaVariants: mergeSchemaVariants(allSchema),
    maxHpResolutions,
    healthTimelines,
    dangerWindows: allWindows,
    reactionOpportunities: allReactions,
    runs: runScores,
    perDungeon,
    global,
    comparisonVsV1: {
      v1GlobalScore: options.v1GlobalScore ?? null,
      v1_1OutcomeOnly: global.outcomeOnlyScore,
      v1_1Behavioral: global.behavioralSurvivalScore,
      perDungeon: perDungeon.map((d) => ({
        dungeonSlug: d.dungeonSlug,
        v1Median:
          options.v1PerDungeon?.find((v) => v.dungeonSlug === d.dungeonSlug)?.medianScore ?? null,
        v1_1OutcomeOnlyMedian: d.medianOutcomeOnlyScore,
        v1_1BehavioralMedian: d.medianBehavioralScore,
      })),
    },
    diagnostics: {
      configVersion: SURVIVAL_STANDALONE_V1_1_CONFIG.version,
      runsWithResolvedMaxHp: runScores.filter((r) => r.maxHp != null).length,
      runCount: runScores.length,
      nonFatalDangerWindowCount: allWindows.filter((w) => w.windowClass === "NON_FATAL_PRESSURE")
        .length,
      fatalDangerWindowCount: allWindows.filter((w) => w.windowClass === "FATAL_PRESSURE").length,
      deathOnlyWindowCount: allWindows.filter(
        (w) => w.windowClass === "DEATH_ONLY_HEALTH_CONTEXT_UNAVAILABLE",
      ).length,
      defensiveCounts: sumCounts(
        runScores.map((r) => r.defensiveCounts),
        emptyDef,
      ),
      recoveryCounts: sumCounts(
        runScores.map((r) => r.recoveryCounts),
        emptyRec,
      ),
      windowsRejectedInsufficientReactionTime: allReactions.filter(
        (r) => r.reason === "insufficient_reaction_time",
      ).length,
      requestCost: {
        wclRequestCount: totalRequests > 0 ? totalRequests : 151,
        estimatedPageCountIncreaseVsCalibrationDamageTaken: totalRequests > 0 ? null : 151 - 37,
        notes: [
          "Live discovery: DamageTaken/Healing/Deaths + includeResources, Resources, playerDetails, narrow All around deaths.",
          "Prior live discovery for this Wallidrixe set cost 151 WCL requests (~37 DamageTaken pages in calibration alone).",
          "Production ReportEvents callers do not pass includeResources (unchanged behavior).",
          totalRequests === 0
            ? "This run reprocessed preserved raw-include-resources payloads (0 new WCL requests)."
            : "This run performed live discovery.",
        ],
      },
      scoreMode,
      outcomeOnlyScore: global.outcomeOnlyScore,
      behavioralSurvivalScore: global.behavioralSurvivalScore,
    },
  };

  await mkdir(options.outputDir, { recursive: true });
  const outputFiles = {
    healthSourceDiscovery: join(options.outputDir, "11-health-source-discovery.json"),
    maxHpResolution: join(options.outputDir, "12-max-hp-resolution.json"),
    healthTimelines: join(options.outputDir, "13-health-timelines.json"),
    dangerWindows: join(options.outputDir, "14-danger-windows-v1.1.json"),
    reactionOpportunities: join(options.outputDir, "15-reaction-opportunities.json"),
    runs: join(options.outputDir, "16-survival-v1.1-runs.json"),
    perDungeon: join(options.outputDir, "17-survival-v1.1-per-dungeon.json"),
    global: join(options.outputDir, "18-survival-v1.1-global.json"),
    comparison: join(options.outputDir, "19-survival-v1-v1.1-comparison.json"),
    diagnostics: join(options.outputDir, "20-survival-v1.1-diagnostics.json"),
  };

  await Promise.all([
    writeJson(outputFiles.healthSourceDiscovery, {
      configVersion: SURVIVAL_STANDALONE_V1_1_CONFIG.version,
      schemaVariants: dataset.schemaVariants,
      notes: SURVIVAL_STANDALONE_V1_1_CONFIG.notes,
      rawPayloadDir,
    }),
    writeJson(outputFiles.maxHpResolution, dataset.maxHpResolutions),
    writeJson(outputFiles.healthTimelines, dataset.healthTimelines),
    writeJson(outputFiles.dangerWindows, dataset.dangerWindows),
    writeJson(outputFiles.reactionOpportunities, dataset.reactionOpportunities),
    writeJson(outputFiles.runs, dataset.runs),
    writeJson(outputFiles.perDungeon, dataset.perDungeon),
    writeJson(outputFiles.global, dataset.global),
    writeJson(outputFiles.comparison, dataset.comparisonVsV1),
    writeJson(outputFiles.diagnostics, dataset.diagnostics),
  ]);

  // Cache discovery for offline re-score
  await writeJson(join(options.outputDir, "11b-discovery-cache.json"), {
    wclRequestCount: totalRequests,
    runs: options.calibration.runs.map((run) => ({
      runId: run.runId,
      snapshots: perRunSnapshots.get(run.runId) ?? [],
      schemaVariants: allSchema.filter((s) => s.sourceLabel.startsWith(run.runId)),
      eventPagesComplete: perRunPagesComplete.get(run.runId) ?? false,
    })),
  });

  return { dataset, outputFiles };
}

/** @internal helper for typing calibration runs in tests */
export type { SurvivalCalibrationRun };
