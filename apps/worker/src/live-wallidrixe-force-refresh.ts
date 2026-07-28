/**
 * One-shot live Wallidrixe force refresh + acceptance dump.
 * Usage (from repo root):
 *   pnpm --filter @mplus/worker exec tsx src/live-wallidrixe-force-refresh.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createWorkerContainer } from "./container.js";
import { runRefreshPipeline } from "./orchestration/refresh-pipeline.js";
import { buildRefreshContractHash } from "./orchestration/build-refresh-contract.js";
import { ensureCurrentSeason } from "./persistence/run-repository.js";

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
resetEnvCache();

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });

const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };
const refreshStartedAt = new Date().toISOString();

const character = await worker.repositories.character.findByIdentity(identity);
const season = character
  ? await ensureCurrentSeason(prisma, character.regionId)
  : { slug: "unknown" };
const refreshContractHash = buildRefreshContractHash({
  scoringModelKey: env.ACTIVE_SCORE_MODEL_KEY,
  scoringModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
  activeSeasonId: season.slug,
  env: process.env,
  allowFixtureZoneDefault: false,
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
  coverage?: { selectedRunCount?: number };
  scoringRunSelection?: { selectedRuns?: Array<{ dungeonSlug: string }> };
  observations?: Array<{ metricKey: string; rawValue?: number | null; sourceProvider?: string }>;
};

const scoreCalculatedAt = latest?.calculatedAt?.toISOString?.() ?? result.score?.calculatedAt ?? null;
const newerProviders = providerStates.filter((s) => {
  if (!scoreCalculatedAt || !s.fetchedAt) return false;
  return Date.parse(s.fetchedAt) > Date.parse(scoreCalculatedAt) + 1000;
});

const observationProviders = (explanation.observations ?? []).map((o) => o.sourceProvider);
const wclContributed = observationProviders.some(
  (p) => p === "warcraftlogs" || p === "WARCRAFT_LOGS",
);

const acceptance = {
  refreshStartedAt,
  jobStatus: result.job.status,
  calculatedAt: scoreCalculatedAt,
  calculatedAtNewerThanRequest:
    scoreCalculatedAt != null && Date.parse(scoreCalculatedAt) >= Date.parse(refreshStartedAt) - 1000,
  modelKey: latest?.scoreModel?.key ?? result.score?.modelKey ?? null,
  modelVersion: latest?.scoreModel?.version ?? result.score?.modelVersion ?? null,
  activeModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
  selectedRunCount: explanation.coverage?.selectedRunCount ?? null,
  hasIcecrown: Boolean(
    explanation.scoringRunSelection?.selectedRuns?.some((r) => r.dungeonSlug.includes("icecrown")) ||
      explanation.performanceSummary?.currentSeason?.dungeons?.some((d) =>
        d.dungeonSlug.includes("icecrown"),
      ),
  ),
  performanceScore: explanation.performanceSummary?.currentSeason?.score ?? null,
  peak: explanation.performanceSummary?.currentSeason?.peakScore ?? null,
  consistency: explanation.performanceSummary?.currentSeason?.consistencyScore ?? null,
  provenance: explanation.performanceSummary?.currentSeason?.provenance ?? null,
  wclContributedToScore: wclContributed,
  providerFetchedAt: Object.fromEntries(providerStates.map((s) => [s.provider, s.fetchedAt])),
  hasScoreStaleVsProviders: newerProviders.length > 0,
  staleProviders: newerProviders.map((s) => s.provider),
  performanceDimension:
    result.score?.dimensions?.find((d) => d.dimension === "PERFORMANCE") ?? null,
};

console.log(JSON.stringify(acceptance, null, 2));
await prisma.$disconnect();
