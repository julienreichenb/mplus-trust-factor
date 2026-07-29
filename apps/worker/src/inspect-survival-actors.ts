import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { SURVIVAL_STANDALONE_V1_1_1_CONFIG } from "@mplus/provider-warcraftlogs";

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
resetEnvCache();
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const character = await prisma.character.findFirst({
  where: { normalizedName: "wallidrixe" },
});
if (!character) throw new Error("missing character");

const analyses = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: SURVIVAL_STANDALONE_V1_1_1_CONFIG.analysisVersion,
  },
  include: { run: { include: { dungeon: true, sources: true } } },
  orderBy: { analyzedAt: "desc" },
});
const by = new Map<string, (typeof analyses)[number]>();
for (const a of analyses) if (!by.has(a.runId)) by.set(a.runId, a);

const facts = await prisma.runAnalysis.findMany({
  where: {
    characterId: character.id,
    analysisVersion: "wcl-combat-facts-v1",
    runId: { in: [...by.keys()] },
  },
});
const factsBy = new Map(facts.map((f) => [f.runId, f.summary as Record<string, unknown>]));

for (const row of by.values()) {
  const s = row.summary as Record<string, unknown>;
  const maxHp = s.maxHpResolution as Record<string, unknown> | undefined;
  const src = row.run.sources.find((x) => x.provider === "WARCRAFT_LOGS");
  const fsum = factsBy.get(row.runId) ?? {};
  const cf = (fsum.combatFacts ?? fsum) as Record<string, unknown>;
  const coverage = cf.coverage as Record<string, boolean> | undefined;
  console.log(
    JSON.stringify({
      report: `${src?.reportCode}:${src?.fightId}`,
      dungeon: row.run.dungeon.slug,
      maxHp: maxHp?.baselineMaxHp ?? null,
      fail: maxHp?.resolutionFailureReason ?? null,
      actor: cf.targetSourceId ?? null,
      pets: cf.attributedSourceIds ?? null,
      dmgCount: Array.isArray(cf.damageTaken) ? cf.damageTaken.length : null,
      coverage,
    }),
  );
}
await prisma.$disconnect();
