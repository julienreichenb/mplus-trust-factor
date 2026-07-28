/**
 * Dump Wallidrixe Survival V1.1.1 production analyses (no WCL calls).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { SURVIVAL_STANDALONE_V1_1_1_CONFIG } from "@mplus/provider-warcraftlogs";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "../../..");
loadDotEnvFile(resolve(repoRoot, ".env"));
loadDotEnvFile(resolve(here, "../.env"));
resetEnvCache();

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const character = await prisma.character.findFirst({
  where: { normalizedName: "wallidrixe" },
});
if (!character) throw new Error("character not found");

const analyses = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
  },
  include: {
    run: { include: { dungeon: true, sources: true } },
  },
  orderBy: { analyzedAt: "desc" },
});

const byRunId = new Map<string, (typeof analyses)[number]>();
for (const a of analyses) {
  if (!byRunId.has(a.runId)) byRunId.set(a.runId, a);
}
const rows = [...byRunId.values()];

const combatFacts = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: "wcl-combat-facts-v1",
    runId: { in: rows.map((r) => r.runId) },
  },
});
const factsByRun = new Map(combatFacts.map((c) => [c.runId, c.summary as Record<string, unknown>]));

const snapshot = await prisma.scoreSnapshot.findFirst({
  where: { characterId: character.id },
  orderBy: { calculatedAt: "desc" },
  include: { scoreModel: true },
});
const expl = (snapshot?.explanation ?? {}) as Record<string, unknown>;
const surv = (expl.survivalSummary ?? null) as Record<string, unknown> | null;

const providerStates = await prisma.characterProviderState.findMany({
  where: { characterId: character.id },
});
const scoreCalculatedAt = snapshot?.calculatedAt?.toISOString() ?? null;
const newerProviders = providerStates.filter((s) => {
  if (!scoreCalculatedAt || !s.fetchedAt) return false;
  return Date.parse(s.fetchedAt.toISOString()) > Date.parse(scoreCalculatedAt) + 1000;
});

const out = {
  analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
  adapterVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.adapterVersion,
  runCount: rows.length,
  runs: rows.map((r) => {
    const s = r.summary as Record<string, unknown>;
    const maxHp = s.maxHpResolution as Record<string, unknown> | undefined;
    const components = s.componentScores as Record<string, unknown> | undefined;
    const src = r.run.sources.find((x) => x.provider === "WARCRAFT_LOGS");
    const facts = factsByRun.get(r.runId) ?? {};
    return {
      runId: r.runId,
      reportCode: src?.reportCode ?? null,
      fightId: src?.fightId ?? null,
      dungeonSlug: r.run.dungeon.slug,
      keyLevel: r.run.keyLevel,
      durationMs: r.run.durationMs,
      playerActorId: facts.targetSourceId ?? null,
      deaths: s.deathCount,
      baselineMaxHp: maxHp?.baselineMaxHp ?? null,
      maxHpFailure: maxHp?.resolutionFailureReason ?? null,
      temporaryIntervals: maxHp?.temporaryIntervalCount ?? null,
      clusters: s.pressureClusterCount,
      outcome: components?.outcome ?? null,
      defensiveResponse: components?.defensiveResponse ?? null,
      emergencyRecovery: components?.emergencyRecovery ?? null,
      finalScore: s.behavioralSurvivalScore,
      defensiveCounts: s.defensiveCounts,
      recoveryCounts: s.recoveryCounts,
    };
  }),
  aggregates: {
    maxHpResolved: rows.filter((r) => {
      const maxHp = (r.summary as Record<string, unknown>).maxHpResolution as
        | Record<string, unknown>
        | undefined;
      return maxHp?.baselineMaxHp != null;
    }).length,
    deathCount: rows.reduce(
      (n, r) => n + Number((r.summary as Record<string, unknown>).deathCount ?? 0),
      0,
    ),
    pressureClusterCount: rows.reduce(
      (n, r) => n + Number((r.summary as Record<string, unknown>).pressureClusterCount ?? 0),
      0,
    ),
  },
  survivalSummary: surv,
  model: {
    key: snapshot?.scoreModel?.key ?? null,
    version: snapshot?.scoreModel?.version ?? null,
    calculatedAt: scoreCalculatedAt,
  },
  hasScoreStaleVsProviders: newerProviders.length > 0,
  staleProviders: newerProviders.map((s) => s.provider),
};

const outDir = resolve(repoRoot, "raw-artifacts/wcl-probe-survival-v1_1_1-parity");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "eu-archimonde-wallidrixe-production-dump.json");
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(JSON.stringify(out, null, 2));
console.log(`\nWrote ${outPath}`);
await prisma.$disconnect();
