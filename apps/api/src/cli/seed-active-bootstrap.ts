/**
 * Test/dev seed: persist Bootstrap Release 0 (if missing), ensure replay PASS, activate ACTIVE.
 * Used by isolated test DB seed — not a production operator command.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogReleaseService } from "../services/ability-catalog-release-service.js";
import { AbilityCatalogReleaseActivationService } from "../services/ability-catalog-release-activation-service.js";

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
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
const releases = new AbilityCatalogReleaseService(prisma);
const activation = new AbilityCatalogReleaseActivationService(prisma);

const audit = {
  userId: null as string | null,
  actorType: "system" as const,
  sessionSecret: env.SESSION_SECRET,
};

try {
  const boot = await releases.persistBootstrapRelease0(audit);

  const existingActive = await prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
  });
  if (existingActive) {
    console.log(`seed-active-bootstrap: ACTIVE already set (${existingActive.releaseKey})`);
    process.exit(0);
  }

  const replay = await prisma.abilityCatalogReleaseReplay.findFirst({
    where: { candidateReleaseId: boot.release.id, status: "PASSED" },
  });
  if (!replay) {
    await prisma.abilityCatalogReleaseReplay.create({
      data: {
        idempotencyKey: `seed-active-bootstrap|${boot.release.id}`,
        baseKind: "STATIC",
        baseReleaseId: null,
        candidateReleaseId: boot.release.id,
        corpusDigest: "0".repeat(64),
        replayInputDigest: "1".repeat(64),
        replayEngineVersion: "seed",
        status: "PASSED",
        summary: { changedAnalyses: 0, unresolvedFailures: 0 },
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  await prisma.abilityCatalogRelease.update({
    where: { id: boot.release.id },
    data: { status: "VALIDATED" },
  });

  const result = await activation.activate(
    {
      releaseId: boot.release.id,
      confirmationDigest: boot.release.contentDigest,
      confirm: true,
      expectedPreviousActiveId: null,
    },
    audit,
    { type: "PUBLISH" },
  );

  console.log(
    `seed-active-bootstrap: ACTIVE ${result.release.releaseKey} (${result.release.id})`,
  );
} finally {
  await prisma.$disconnect();
}
