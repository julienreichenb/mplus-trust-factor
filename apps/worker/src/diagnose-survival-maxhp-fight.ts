/**
 * One-fight max-HP diagnostic (no full refresh).
 * Usage: pnpm --filter @mplus/worker exec tsx src/diagnose-survival-maxhp-fight.ts rmd1P7KygazYHVD3 2 56
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createWorkerContainer } from "./container.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
loadDotEnvFile(resolve(root, ".env"));
process.env.PROVIDER_MODE = "live";
process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
resetEnvCache();

const reportCode = process.argv[2] ?? "rmd1P7KygazYHVD3";
const fightId = Number(process.argv[3] ?? 2);
const playerActorId = Number(process.argv[4] ?? 56);

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const worker = createWorkerContainer(env, { prisma });
const identity = { region: "EU" as const, realmSlug: "archimonde", name: "Wallidrixe" };

const live = worker.providers.warcraftlogs as unknown as {
  analyzeSurvivalCanonicalRun: (
    input: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> }>;
};

const result = await live.analyzeSurvivalCanonicalRun(
  {
    identity,
    characterId: "diag",
    reportCode,
    fightId,
    reportRevision: 1,
    dungeonSlug: "diag",
    keyLevel: 20,
    playerActorId,
    ownedPetActorIds: [],
    fightStartTime: 0,
    fightEndTime: 2_000_000,
    catalog: (await import("@mplus/abilities")).getAbilityCatalog({
      classSlug: "warlock",
      specSlug: "demonology",
    }),
    classSlug: "warlock",
    specSlug: "demonology",
  },
  {
    region: "EU",
    requestId: `diag-${Date.now()}`,
    now: new Date().toISOString(),
    targetCharacter: identity,
  },
);

const summary = result.data.summary as {
  maxHpResolution: Record<string, unknown>;
  behavioralSurvivalScore: number | null;
  deathCount: number;
  pressureClusterCount: number;
};
console.log(
  JSON.stringify(
    {
      reportCode,
      fightId,
      playerActorId,
      snapshotCount: result.data.snapshotCount,
      snapshotSourceCounts: result.data.snapshotSourceCounts,
      maxHpFailureReason: result.data.maxHpFailureReason,
      baselineMaxHp: summary.maxHpResolution.baselineMaxHp,
      resolutionFailureReason: summary.maxHpResolution.resolutionFailureReason,
      rejectionReasons: summary.maxHpResolution.rejectionReasons,
      deathCount: summary.deathCount,
      pressureClusterCount: summary.pressureClusterCount,
      finalScore: summary.behavioralSurvivalScore,
    },
    null,
    2,
  ),
);
await prisma.$disconnect();
