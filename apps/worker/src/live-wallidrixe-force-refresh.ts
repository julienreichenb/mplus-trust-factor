/**
 * One-shot live Wallidrixe force refresh + Survival V1.1.1 acceptance dump.
 * Usage (from repo root):
 *   pnpm --filter @mplus/worker exec tsx src/live-wallidrixe-force-refresh.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { deriveWclContributionTypes } from "@mplus/contracts";
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

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });

const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };
const refreshStartedAt = new Date().toISOString();

const character = await worker.repositories.character.findByIdentity(identity);
const season = character
  ? await requireEffectiveScoringSeasonRow(prisma, { regionId: character.regionId })
  : { slug: "unknown", wclZoneId: null as number | null };
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

const result = await runRefreshPipeline(worker, {
  ...identity,
  characterId: character?.id,
  priority: "high",
  forceRefresh: true,
  requestedAt: refreshStartedAt,
  refreshContractHash,
});

const latest = await worker.repositories.score.getLatestSnapshot(result.character.id);
const providerStates = await worker.repositories.providerState.listForCharacter(result.character.id);
const explanation = (latest?.explanation ?? result.score?.explanation ?? {}) as {
  performanceSummary?: {
    currentSeason?: {
      peakScore?: number | null;
      consistencyScore?: number | null;
      score?: number | null;
      provenance?: string;
      dungeons?: Array<{ dungeonSlug: string }>;
    };
  };
  survivalSummary?: {
    score?: number | null;
    confidence?: number;
    availableDungeonCount?: number;
    expectedDungeonCount?: number;
    scoreMode?: string | null;
    analyzedRunCount?: number;
    cachedRunCount?: number;
    newlyFetchedRunCount?: number;
    components?: {
      outcome?: number | null;
      defensiveResponse?: number | null;
      emergencyRecovery?: number | null;
    };
    pressureClusterCount?: number;
    deathCount?: number;
    defensiveCounts?: { covered?: number; missed?: number; na?: number };
    recoveryCounts?: { covered?: number; missed?: number; na?: number };
    maxHpDiagnostics?: { invalidOutlierCount?: number; baselineResolvedRunCount?: number };
    requestCost?: { wclRequestCount?: number; notes?: string[] };
    dungeons?: Array<{ dungeonSlug: string }>;
  };
  coverage?: { selectedRunCount?: number };
  scoringRunSelection?: { selectedRuns?: Array<{ dungeonSlug: string }> };
  observations?: Array<{
    metricKey: string;
    rawValue?: number | null;
    sourceProvider?: string;
    context?: unknown;
  }>;
  refreshContract?: { scoringModelVersion?: number };
};

const scoreCalculatedAt = latest?.calculatedAt?.toISOString?.() ?? result.score?.calculatedAt ?? null;
const newerProviders = providerStates.filter((s) => {
  if (!scoreCalculatedAt || !s.fetchedAt) return false;
  return Date.parse(s.fetchedAt) > Date.parse(scoreCalculatedAt) + 1000;
});

const observations = explanation.observations ?? [];
const contributionTypes = deriveWclContributionTypes(observations);
const wclContributed = contributionTypes.length > 0;
const survival = explanation.survivalSummary ?? null;

const acceptance = {
  refreshStartedAt,
  jobStatus: result.job.status,
  calculatedAt: scoreCalculatedAt,
  calculatedAtNewerThanRequest:
    scoreCalculatedAt != null && Date.parse(scoreCalculatedAt) >= Date.parse(refreshStartedAt) - 1000,
  modelKey: latest?.scoreModel?.key ?? result.score?.modelKey ?? null,
  modelVersion: latest?.scoreModel?.version ?? result.score?.modelVersion ?? null,
  activeModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
  selectedActiveDungeonCount: survival?.availableDungeonCount ?? null,
  expectedDungeonCount: survival?.expectedDungeonCount ?? null,
  hasIcecrown: Boolean(
    explanation.scoringRunSelection?.selectedRuns?.some((r) => r.dungeonSlug.includes("icecrown")) ||
      explanation.performanceSummary?.currentSeason?.dungeons?.some((d) =>
        d.dungeonSlug.includes("icecrown"),
      ) ||
      survival?.dungeons?.some((d) => d.dungeonSlug.includes("icecrown")),
  ),
  analyzedRunCount: survival?.analyzedRunCount ?? null,
  cachedRunCount: survival?.cachedRunCount ?? null,
  newlyFetchedRunCount: survival?.newlyFetchedRunCount ?? null,
  survivalScore: survival?.score ?? null,
  outcome: survival?.components?.outcome ?? null,
  defensiveResponse: survival?.components?.defensiveResponse ?? null,
  emergencyRecovery: survival?.components?.emergencyRecovery ?? null,
  scoreMode: survival?.scoreMode ?? null,
  pressureClusterCount: survival?.pressureClusterCount ?? null,
  invalidMaxHpOutliersRejected: survival?.maxHpDiagnostics?.invalidOutlierCount ?? null,
  survivalConfidence: survival?.confidence ?? null,
  wclContributedToScore: wclContributed,
  contributionTypes,
  hasScoreStaleVsProviders: newerProviders.length > 0,
  staleProviders: newerProviders.map((s) => s.provider),
  requestCost: survival?.requestCost ?? null,
  survivalDimension:
    result.score?.dimensions?.find((d) => d.dimension === "SURVIVAL") ?? null,
  performanceDimension:
    result.score?.dimensions?.find((d) => d.dimension === "PERFORMANCE") ?? null,
  survivalCoverage: {
    defensive: survival?.defensiveCounts ?? null,
    recovery: survival?.recoveryCounts ?? null,
    maxHpResolved: survival?.maxHpDiagnostics?.baselineResolvedRunCount ?? null,
    deathCount: survival?.deathCount ?? null,
  },
  explanatoryRuns:
    (explanation as { survivalSummary?: { dungeons?: unknown } }).survivalSummary ?? null,
};

console.log(JSON.stringify(acceptance, null, 2));
await prisma.$disconnect();
