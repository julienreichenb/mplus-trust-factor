/**
 * Probe-vs-production Survival V1.1.1 parity for Wallidrixe's exact selected runs.
 *
 * 1) Force-refresh production (optional via --skip-refresh)
 * 2) Export the production-selected run identities
 * 3) Re-analyze each fight via the shared canonical analyzer (probe-equivalent path)
 * 4) Diff against persisted RunAnalysis summaries
 *
 * Usage (repo root):
 *   pnpm --filter @mplus/worker exec tsx src/live-survival-parity-wallidrixe.ts
 *   pnpm --filter @mplus/worker exec tsx src/live-survival-parity-wallidrixe.ts --skip-refresh
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { deriveWclContributionTypes } from "@mplus/contracts";
import {
  SURVIVAL_STANDALONE_V1_1_1_CONFIG,
  type SurvivalRunAnalysisSummary,
} from "@mplus/provider-warcraftlogs";
import { getAbilityCatalog } from "@mplus/abilities";
import { createWorkerContainer } from "./container.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { buildRefreshContractHash } from "./orchestration/build-refresh-contract.js";
import { resolveEnqueueAbilityCatalogExecutionPin } from "./orchestration/ability-catalog-enqueue-pin.js";
import { requireEffectiveScoringSeasonRow } from "./orchestration/active-mplus-season/effective-season-peek.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
loadDotEnvFile(resolve(repoRoot, ".env"));
loadDotEnvFile(resolve(here, "../.env"));
process.env.PROVIDER_MODE = "live";
process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
process.env.ACTIVE_SCORE_MODEL_VERSION = process.env.ACTIVE_SCORE_MODEL_VERSION ?? "4";
resetEnvCache();

const skipRefresh = process.argv.includes("--skip-refresh");
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });

const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };
const refreshStartedAt = new Date().toISOString();

const character = await worker.repositories.character.findByIdentity(identity);
if (!character) {
  throw new Error("Wallidrixe character not found — run a refresh first");
}

const season = await requireEffectiveScoringSeasonRow(prisma, { regionId: character.regionId });
if (season.wclZoneId == null) {
  throw new Error(
    `Effective scoring season ${season.slug} has no persisted wclZoneId — catalog not ready`,
  );
}
const abilityCatalogExecutionPin = await resolveEnqueueAbilityCatalogExecutionPin({ prisma });
const refreshContractHash = buildRefreshContractHash({
  scoringModelKey: env.ACTIVE_SCORE_MODEL_KEY,
  scoringModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
  activeSeasonId: season.slug,
  zoneId: season.wclZoneId,
  env: process.env,
  allowFixtureZoneDefault: false,
  abilityCatalogExecutionPin,
});

let refreshResult: Awaited<ReturnType<typeof runRefreshPipeline>> | null = null;
if (!skipRefresh) {
  refreshResult = await runRefreshPipeline(worker, {
    ...identity,
    characterId: character.id,
    priority: "high",
    forceRefresh: true,
    requestedAt: refreshStartedAt,
    refreshContractHash,
  });
}

const analyses = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
  },
  orderBy: { analyzedAt: "desc" },
  include: {
    run: {
      include: {
        dungeon: true,
        sources: { where: { provider: "WARCRAFT_LOGS" } },
      },
    },
  },
});

// Keep the newest analysis per runId (force refresh writes all selected runs).
const byRunId = new Map<string, (typeof analyses)[number]>();
for (const row of analyses) {
  if (!byRunId.has(row.runId)) byRunId.set(row.runId, row);
}
const productionRows = [...byRunId.values()];

const combatFactsRows = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: "wcl-combat-facts-v1",
    runId: { in: productionRows.map((r) => r.runId) },
  },
});
const combatFactsByRunId = new Map(
  combatFactsRows.map((r) => [r.runId, r.summary as Record<string, unknown>]),
);

const classSlug = "warlock";
const specSlug = "demonology";
const catalog = getAbilityCatalog({ classSlug, specSlug });
const ctx = {
  region: identity.region,
  requestId: `parity-${Date.now()}`,
  correlationId: `parity-${Date.now()}`,
  forceRefresh: false,
  now: new Date().toISOString(),
  targetCharacter: identity,
  jobId: `parity-${Date.now()}`,
  characterId: character.id,
  purpose: "survival-parity",
};

const liveWcl = worker.providers.warcraftlogs as unknown as {
  analyzeSurvivalCanonicalRun: (
    input: Record<string, unknown>,
    fetchCtx: typeof ctx,
  ) => Promise<{
    data: {
      summary: SurvivalRunAnalysisSummary;
      requestCount: number;
      maxHpFailureReason: string | null;
      truncated: boolean;
      snapshotCount: number;
      snapshotSourceCounts?: Record<string, number>;
      playerActorId: number;
      deathCount: number;
      pressureClusterCount: number;
      behavioralSurvivalScore: number | null;
    };
  }>;
};

type PerRunDiff = {
  runId: string;
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  fightStartTime: number;
  fightEndTime: number;
  production: Record<string, unknown>;
  probe: Record<string, unknown>;
  diffs: string[];
  scoreDelta: number | null;
  maxHpFailureReason: string | null;
};

const perRun: PerRunDiff[] = [];
let unexplainedDiffCount = 0;

for (const row of productionRows) {
  const source = row.run.sources.find((s) => s.provider === "WARCRAFT_LOGS") ?? row.run.sources[0];
  if (!source?.reportCode || source.fightId == null) {
    perRun.push({
      runId: row.runId,
      reportCode: "missing",
      fightId: -1,
      dungeonSlug: row.run.dungeon.slug,
      fightStartTime: 0,
      fightEndTime: 0,
      production: { error: "no_wcl_source" },
      probe: {},
      diffs: ["no_wcl_source"],
      scoreDelta: null,
      maxHpFailureReason: "no_wcl_source",
    });
    unexplainedDiffCount += 1;
    continue;
  }

  const factsSummary = combatFactsByRunId.get(row.runId) ?? {};
  const persistedFacts = (factsSummary.combatFacts ?? factsSummary) as Record<string, unknown>;
  const playerActorId = Number(persistedFacts.targetSourceId ?? 0);
  const ownedPetActorIds = Array.isArray(persistedFacts.attributedSourceIds)
    ? (persistedFacts.attributedSourceIds as number[]).filter((id) => id !== playerActorId)
    : [];
  // Prefer report-relative fight bounds from combat-facts admin diagnostics when present.
  const fightStart = Number(
    (factsSummary as { fightStartTime?: number }).fightStartTime ??
      (persistedFacts as { fightStartTime?: number }).fightStartTime ??
      0,
  );
  const fightEnd = Number(
    (factsSummary as { fightEndTime?: number }).fightEndTime ??
      (persistedFacts as { fightEndTime?: number }).fightEndTime ??
      fightStart + row.run.durationMs,
  );
  const prod = row.summary as unknown as SurvivalRunAnalysisSummary;

  if (!playerActorId) {
    perRun.push({
      runId: row.runId,
      reportCode: source.reportCode,
      fightId: source.fightId,
      dungeonSlug: row.run.dungeon.slug,
      fightStartTime: fightStart,
      fightEndTime: fightEnd,
      production: { error: "missing_player_actor_id_in_combat_facts" },
      probe: {},
      diffs: ["missing_player_actor_id_in_combat_facts"],
      scoreDelta: null,
      maxHpFailureReason: "missing_player_actor_id_in_combat_facts",
    });
    unexplainedDiffCount += 1;
    continue;
  }

  const probeResult = await liveWcl.analyzeSurvivalCanonicalRun(
    {
      identity,
      characterId: character.id,
      reportCode: source.reportCode,
      fightId: source.fightId,
      reportRevision: persistedFacts.revision ?? source.revision ?? 1,
      dungeonSlug: row.run.dungeon.slug,
      keyLevel: row.run.keyLevel,
      playerActorId,
      ownedPetActorIds,
      fightStartTime: fightStart,
      fightEndTime: fightEnd,
      encounterId: null,
      encounterName: null,
      catalog,
      classSlug,
      specSlug,
      timed: row.run.timed,
      completed: true,
      score: row.run.scoreValue,
    },
    ctx,
  );
  const probe = probeResult.data.summary;

  const fields: Array<[string, unknown, unknown]> = [
    ["playerActorId", playerActorId, probeResult.data.playerActorId],
    ["deaths", prod.deathCount, probe.deathCount],
    ["baselineMaxHp", prod.maxHpResolution.baselineMaxHp, probe.maxHpResolution.baselineMaxHp],
    [
      "temporaryMaxHpIntervals",
      prod.maxHpResolution.temporaryIntervalCount,
      probe.maxHpResolution.temporaryIntervalCount,
    ],
    ["pressureClusters", prod.pressureClusterCount, probe.pressureClusterCount],
    ["defensiveCovered", prod.defensiveCounts.proactive + prod.defensiveCounts.reactive + prod.defensiveCounts.death_only, probe.defensiveCounts.proactive + probe.defensiveCounts.reactive + probe.defensiveCounts.death_only],
    ["defensiveMissed", prod.defensiveCounts.eligible_miss, probe.defensiveCounts.eligible_miss],
    [
      "defensiveNa",
      prod.defensiveCounts.not_applicable +
        prod.defensiveCounts.unavailable +
        prod.defensiveCounts.insufficient_reaction_time,
      probe.defensiveCounts.not_applicable +
        probe.defensiveCounts.unavailable +
        probe.defensiveCounts.insufficient_reaction_time,
    ],
    ["recoveryCovered", prod.recoveryCounts.covered, probe.recoveryCounts.covered],
    ["recoveryMissed", prod.recoveryCounts.eligible_miss, probe.recoveryCounts.eligible_miss],
    [
      "recoveryNa",
      prod.recoveryCounts.not_applicable +
        prod.recoveryCounts.insufficient_reaction_time +
        prod.recoveryCounts.death_only_health_context_unavailable,
      probe.recoveryCounts.not_applicable +
        probe.recoveryCounts.insufficient_reaction_time +
        probe.recoveryCounts.death_only_health_context_unavailable,
    ],
    ["outcomeScore", prod.componentScores.outcome.score, probe.componentScores.outcome.score],
    [
      "defensiveScore",
      prod.componentScores.defensiveResponse.score,
      probe.componentScores.defensiveResponse.score,
    ],
    [
      "recoveryScore",
      prod.componentScores.emergencyRecovery.score,
      probe.componentScores.emergencyRecovery.score,
    ],
    [
      "recoveryState",
      prod.componentScores.emergencyRecovery.state,
      probe.componentScores.emergencyRecovery.state,
    ],
    ["finalRunScore", prod.behavioralSurvivalScore, probe.behavioralSurvivalScore],
  ];

  const criticalFields = new Set([
    "deaths",
    "baselineMaxHp",
    "outcomeScore",
    "defensiveScore",
    "recoveryScore",
    "recoveryState",
    "finalRunScore",
  ]);
  const diffs: string[] = [];
  const criticalDiffs: string[] = [];
  for (const [name, a, b] of fields) {
    if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
      const line = `${name}: production=${JSON.stringify(a)} probe=${JSON.stringify(b)}`;
      diffs.push(line);
      if (criticalFields.has(name)) criticalDiffs.push(line);
    }
  }
  if (criticalDiffs.length > 0) unexplainedDiffCount += 1;

  const scoreDelta =
    prod.behavioralSurvivalScore != null && probe.behavioralSurvivalScore != null
      ? probe.behavioralSurvivalScore - prod.behavioralSurvivalScore
      : null;

  perRun.push({
    runId: row.runId,
    reportCode: source.reportCode,
    fightId: source.fightId,
    dungeonSlug: row.run.dungeon.slug,
    fightStartTime: fightStart,
    fightEndTime: fightEnd,
    production: {
      playerActorId,
      deaths: prod.deathCount,
      baselineMaxHp: prod.maxHpResolution.baselineMaxHp,
      maxHpFailure: prod.maxHpResolution.resolutionFailureReason,
      temporaryIntervals: prod.maxHpResolution.temporaryIntervalCount,
      pressureClusters: prod.pressureClusterCount,
      defensive: prod.defensiveCounts,
      recovery: prod.recoveryCounts,
      outcome: prod.componentScores.outcome,
      defensiveResponse: prod.componentScores.defensiveResponse,
      emergencyRecovery: prod.componentScores.emergencyRecovery,
      finalScore: prod.behavioralSurvivalScore,
    },
    probe: {
      playerActorId: probeResult.data.playerActorId,
      deaths: probe.deathCount,
      baselineMaxHp: probe.maxHpResolution.baselineMaxHp,
      maxHpFailure: probe.maxHpResolution.resolutionFailureReason,
      temporaryIntervals: probe.maxHpResolution.temporaryIntervalCount,
      pressureClusters: probe.pressureClusterCount,
      defensive: probe.defensiveCounts,
      recovery: probe.recoveryCounts,
      outcome: probe.componentScores.outcome,
      defensiveResponse: probe.componentScores.defensiveResponse,
      emergencyRecovery: probe.componentScores.emergencyRecovery,
      finalScore: probe.behavioralSurvivalScore,
      snapshotCount: probeResult.data.snapshotCount,
      truncated: probeResult.data.truncated,
    },
    diffs,
    scoreDelta,
    maxHpFailureReason: probeResult.data.maxHpFailureReason,
  });
}

const latest = await worker.repositories.score.getLatestSnapshot(
  refreshResult?.character.id ?? character.id,
);
const providerStates = await worker.repositories.providerState.listForCharacter(character.id);
const explanation = (latest?.explanation ?? {}) as {
  survivalSummary?: {
    score?: number | null;
    components?: {
      outcome?: number | null;
      defensiveResponse?: number | null;
      emergencyRecovery?: number | null;
    };
    scoreMode?: string | null;
    analyzedRunCount?: number;
    pressureClusterCount?: number;
    deathCount?: number;
    maxHpDiagnostics?: { baselineResolvedRunCount?: number; invalidOutlierCount?: number };
    defensiveCounts?: { covered?: number; missed?: number; na?: number };
    recoveryCounts?: { covered?: number; missed?: number; na?: number };
  };
  observations?: Array<{ metricKey: string }>;
};

const survival = explanation.survivalSummary ?? null;
const scoreCalculatedAt = latest?.calculatedAt?.toISOString?.() ?? null;
const newerProviders = providerStates.filter((s) => {
  if (!scoreCalculatedAt || !s.fetchedAt) return false;
  return Date.parse(s.fetchedAt) > Date.parse(scoreCalculatedAt) + 1000;
});

const maxHpResolved = perRun.filter(
  (r) => (r.production.baselineMaxHp as number | null) != null,
).length;
const totalDeaths = perRun.reduce((n, r) => n + ((r.production.deaths as number) ?? 0), 0);
const totalClusters = perRun.reduce(
  (n, r) => n + ((r.production.pressureClusters as number) ?? 0),
  0,
);

const report = {
  character: identity,
  analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
  adapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
  refreshSkipped: skipRefresh,
  jobStatus: refreshResult?.job.status ?? null,
  productionRunCount: productionRows.length,
  runIdentities: perRun.map((r) => ({
    runId: r.runId,
    reportCode: r.reportCode,
    fightId: r.fightId,
    dungeonSlug: r.dungeonSlug,
    fightStartTime: r.fightStartTime,
    fightEndTime: r.fightEndTime,
  })),
  aggregates: {
    maxHpResolvedCount: `${maxHpResolved}/${perRun.length}`,
    deathCount: totalDeaths,
    pressureClusterCount: totalClusters,
    defensive: survival?.defensiveCounts ?? null,
    recovery: survival?.recoveryCounts ?? null,
    outcome: survival?.components?.outcome ?? null,
    defensiveResponse: survival?.components?.defensiveResponse ?? null,
    emergencyRecovery: survival?.components?.emergencyRecovery ?? null,
    finalSurvivalScore: survival?.score ?? null,
    scoreMode: survival?.scoreMode ?? null,
  },
  parity: {
    unexplainedPerRunDiffCount: unexplainedDiffCount,
    perRunScoreDeltas: perRun.map((r) => ({
      runId: r.runId,
      reportCode: r.reportCode,
      fightId: r.fightId,
      scoreDelta: r.scoreDelta,
      diffCount: r.diffs.length,
      diffs: r.diffs,
    })),
    allPathsEqual: unexplainedDiffCount === 0,
  },
  hasScoreStaleVsProviders: newerProviders.length > 0,
  contributionTypes: deriveWclContributionTypes(explanation.observations ?? []),
  perRun,
};

const outDir = resolve(repoRoot, "raw-artifacts/wcl-probe-survival-v1_1_1-parity");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "eu-archimonde-wallidrixe-parity.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...report, perRun: undefined, artifactPath: outPath }, null, 2));
console.log(`\nFull per-run dump: ${outPath}`);

await prisma.$disconnect();
if (unexplainedDiffCount > 0) process.exitCode = 2;
