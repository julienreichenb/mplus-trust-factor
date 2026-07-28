import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(resolve(root, "packages/database/package.json"));
const { loadEnv } = req(resolve(root, "packages/config/dist/index.js"));
const { createPrismaClient } = req(resolve(root, "packages/database/dist/index.js"));
const { createWorkerContainer } = req(resolve(root, "apps/worker/dist/container.js"));
const { runRefreshPipeline } = req(resolve(root, "apps/worker/dist/orchestration/refresh-pipeline.js"));

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const container = createWorkerContainer(env, { prisma });

const result = await runRefreshPipeline(container, {
  region: "EU",
  realmSlug: "archimonde",
  name: "Wallidrixe",
  priority: "high",
  forceRefresh: true,
  requestedAt: new Date().toISOString(),
});

const explanation =
  result.score?.explanation && typeof result.score.explanation === "object"
    ? result.score.explanation
    : {};
const scoring = explanation.scoringV3Analysis ?? {};

console.log(
  JSON.stringify(
    {
      jobStatus: result.job.status,
      envModelVersion: env.ACTIVE_SCORE_MODEL_VERSION,
      dbModelVersion: explanation.modelVersion,
      selectedRunCount: scoring.selectedRunCount ?? explanation.coverage?.selectedRunCount,
      missingDungeonSlugs: scoring.missingDungeonSlugs ?? [],
      availableRunCount: explanation.coverage?.availableRunCount,
      historicalPeak: explanation.experienceSummary?.historicalPeak,
      survivalConfidence: explanation.survivalSummary?.confidence,
      utilityConfidence: explanation.utilitySummary?.confidence,
      survivalSelectedRunCount: explanation.survivalSummary?.selectedRunCount,
      utilitySelectedRunCount: explanation.utilitySummary?.selectedRunCount,
      seasonSlug: explanation.seasonSlug,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
