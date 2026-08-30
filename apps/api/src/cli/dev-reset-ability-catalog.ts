/**
 * Local-dev cleanup for ability-catalog review/release test state.
 *
 *   pnpm ability-catalog:dev:reset -- --confirm
 *
 * Refuses production. Preserves ACTIVE releases and any release referenced by
 * CharacterScore / ScoreSnapshot. Removes all review/import workflow batches
 * (including mixed-decision OPEN batches) and unreferenced DRAFT_BUILD/VALIDATED/
 * REJECTED local candidates.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";

import { assertLocalDevResetAllowed } from "./dev-reset-guards.js";
import { buildAbilityCatalogDevResetPlan } from "./dev-reset-ability-catalog-plan.js";

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

function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const root = findWorkspaceRoot(here);
loadDotEnvFile(resolve(root, ".env"));
resetEnvCache();

assertLocalDevResetAllowed();

const confirm = process.argv.includes("--confirm");
const json = process.argv.includes("--json");

const prisma = createPrismaClient();

const batches = await prisma.abilityCatalogReviewBatch.findMany({
  include: {
    items: {
      select: {
        id: true,
        decisionAction: true,
        draftRule: { select: { id: true } },
        draftTopology: { select: { id: true } },
        decisionEvents: { select: { id: true } },
      },
    },
  },
  orderBy: { createdAt: "desc" },
});

const activeReleases = await prisma.abilityCatalogRelease.findMany({ where: { status: "ACTIVE" } });
const characterScoreReleaseIds: string[] = [];
for (const row of await prisma.characterScore.findMany({
  where: { abilityCatalogReleaseId: { not: null } },
  select: { abilityCatalogReleaseId: true },
  distinct: ["abilityCatalogReleaseId"],
})) {
  if (row.abilityCatalogReleaseId) characterScoreReleaseIds.push(row.abilityCatalogReleaseId);
}

const scoreSnapshotReleaseIds: string[] = [];
for (const row of await prisma.scoreSnapshot.findMany({
  where: { abilityCatalogReleaseId: { not: null } },
  select: { abilityCatalogReleaseId: true },
  distinct: ["abilityCatalogReleaseId"],
})) {
  if (row.abilityCatalogReleaseId) scoreSnapshotReleaseIds.push(row.abilityCatalogReleaseId);
}

const allReleasesForLineage = await prisma.abilityCatalogRelease.findMany({
  select: { id: true, previousReleaseId: true },
});

const candidateReleases = await prisma.abilityCatalogRelease.findMany({
  where: { status: { in: ["DRAFT_BUILD", "VALIDATED", "REJECTED"] } },
  select: { id: true, releaseKey: true, status: true, previousReleaseId: true },
});

const plan = buildAbilityCatalogDevResetPlan({
  batches,
  activeReleases: activeReleases.map((release) => ({
    id: release.id,
    releaseKey: release.releaseKey,
    status: release.status,
    previousReleaseId: release.previousReleaseId,
  })),
  characterScoreReleaseIds,
  scoreSnapshotReleaseIds,
  allReleasesForLineage,
  candidateReleases: candidateReleases.map((release) => ({
    id: release.id,
    releaseKey: release.releaseKey,
    status: release.status,
    previousReleaseId: release.previousReleaseId,
  })),
});

if (!confirm) {
  const msg = {
    dryRun: true,
    hint: "Re-run with --confirm to apply.",
    plan,
  };
  console.log(json ? JSON.stringify(msg, null, 2) : JSON.stringify(msg, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

const result = await prisma.$transaction(async (tx) => {
  const deletedBatches = await tx.abilityCatalogReviewBatch.deleteMany({
    where: { id: { in: plan.removeBatchIds } },
  });

  const replayDelete = await tx.abilityCatalogReleaseReplay.deleteMany({
    where: {
      OR: [
        { baseReleaseId: { in: plan.removeCandidateReleaseIds } },
        { candidateReleaseId: { in: plan.removeCandidateReleaseIds } },
      ],
    },
  });
  const deletedReleases = await tx.abilityCatalogRelease.deleteMany({
    where: { id: { in: plan.removeCandidateReleaseIds } },
  });

  const baselines = await tx.abilityCatalogSourceBaseline.findMany({
    orderBy: { designatedAt: "desc" },
  });
  const seenActive = new Set<string>();
  const redundantBaselineIds: string[] = [];
  for (const row of baselines) {
    if (row.isActive) {
      const key = `${row.source}|active`;
      if (seenActive.has(key)) redundantBaselineIds.push(row.id);
      else seenActive.add(key);
      continue;
    }
  }
  const byHash = new Map<string, string[]>();
  for (const row of baselines.filter((baseline) => !baseline.isActive)) {
    const list = byHash.get(row.contentHash) ?? [];
    list.push(row.id);
    byHash.set(row.contentHash, list);
  }
  for (const ids of byHash.values()) {
    for (const id of ids.slice(1)) redundantBaselineIds.push(id);
  }
  const deletedBaselines = await tx.abilityCatalogSourceBaseline.deleteMany({
    where: { id: { in: [...new Set(redundantBaselineIds)] } },
  });

  return {
    deletedBatches: deletedBatches.count,
    deletedReplays: replayDelete.count,
    deletedReleases: deletedReleases.count,
    deletedBaselines: deletedBaselines.count,
  };
});

const after = {
  batchesRemaining: await prisma.abilityCatalogReviewBatch.count(),
  openBatches: await prisma.abilityCatalogReviewBatch.count({ where: { status: "OPEN" } }),
  activeReleases: await prisma.abilityCatalogRelease.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, releaseKey: true, status: true, wowBuild: true },
  }),
};

const payload = { applied: true, plan, result, after };
console.log(JSON.stringify(payload, null, 2));
await prisma.$disconnect();
