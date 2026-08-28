/**
 * Local-dev cleanup for ability-catalog review/release test state.
 *
 *   pnpm ability-catalog:dev:reset -- --confirm
 *
 * Refuses production. Preserves ACTIVE releases and any release referenced by
 * CharacterScore / ScoreSnapshot. Removes disposable zero-decision review
 * batches and unreferenced DRAFT_BUILD/VALIDATED/REJECTED local candidates.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";

import { assertLocalDevResetAllowed } from "./dev-reset-guards.js";

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

const disposableBatches = batches.filter((b) => b.items.every((i) => i.decisionAction == null));
const preservedDecisionBatches = batches.filter((b) => b.items.some((i) => i.decisionAction != null));

const activeReleases = await prisma.abilityCatalogRelease.findMany({ where: { status: "ACTIVE" } });
const referencedReleaseIds = new Set<string>(activeReleases.map((r) => r.id));

for (const row of await prisma.characterScore.findMany({
  where: { abilityCatalogReleaseId: { not: null } },
  select: { abilityCatalogReleaseId: true },
  distinct: ["abilityCatalogReleaseId"],
})) {
  if (row.abilityCatalogReleaseId) referencedReleaseIds.add(row.abilityCatalogReleaseId);
}
for (const row of await prisma.scoreSnapshot.findMany({
  where: { abilityCatalogReleaseId: { not: null } },
  select: { abilityCatalogReleaseId: true },
  distinct: ["abilityCatalogReleaseId"],
})) {
  if (row.abilityCatalogReleaseId) referencedReleaseIds.add(row.abilityCatalogReleaseId);
}

// Preserve lineage parents of ACTIVE/referenced releases.
let frontier = [...referencedReleaseIds];
while (frontier.length) {
  const parents = await prisma.abilityCatalogRelease.findMany({
    where: { id: { in: frontier }, previousReleaseId: { not: null } },
    select: { previousReleaseId: true },
  });
  frontier = [];
  for (const p of parents) {
    if (p.previousReleaseId && !referencedReleaseIds.has(p.previousReleaseId)) {
      referencedReleaseIds.add(p.previousReleaseId);
      frontier.push(p.previousReleaseId);
    }
  }
}

const candidateReleases = await prisma.abilityCatalogRelease.findMany({
  where: {
    status: { in: ["DRAFT_BUILD", "VALIDATED", "REJECTED"] },
    ...(referencedReleaseIds.size > 0 ? { id: { notIn: [...referencedReleaseIds] } } : {}),
  },
  select: { id: true, releaseKey: true, status: true },
});

const plan = {
  removeBatchIds: disposableBatches.map((b) => b.id),
  removeBatchCount: disposableBatches.length,
  removeItemCount: disposableBatches.reduce((n, b) => n + b.items.length, 0),
  removeDraftRuleCount: disposableBatches.reduce(
    (n, b) => n + b.items.filter((i) => i.draftRule).length,
    0,
  ),
  removeDraftTopologyCount: disposableBatches.reduce(
    (n, b) => n + b.items.filter((i) => i.draftTopology).length,
    0,
  ),
  removeDecisionEventCount: disposableBatches.reduce(
    (n, b) => n + b.items.reduce((m, i) => m + i.decisionEvents.length, 0),
    0,
  ),
  preserveDecisionBatchIds: preservedDecisionBatches.map((b) => b.id),
  preserveActiveReleaseIds: activeReleases.map((r) => r.id),
  preserveReferencedReleaseIds: [...referencedReleaseIds],
  removeCandidateReleaseIds: candidateReleases.map((r) => r.id),
  removeCandidateReleases: candidateReleases,
};

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
  // Delete disposable review batches (items/drafts/events cascade).
  const deletedBatches = await tx.abilityCatalogReviewBatch.deleteMany({
    where: { id: { in: plan.removeBatchIds } },
  });

  // Delete unreferenced disposable candidate releases + their replays.
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

  // Collapse redundant inactive baselines (keep newest active per source).
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
    // inactive duplicates of same contentHash — safe to drop if unused
    // (baselines have no FK from scores; keep one inactive history row max per contentHash)
  }
  const byHash = new Map<string, string[]>();
  for (const row of baselines.filter((b) => !b.isActive)) {
    const list = byHash.get(row.contentHash) ?? [];
    list.push(row.id);
    byHash.set(row.contentHash, list);
  }
  for (const ids of byHash.values()) {
    // keep newest (first in designatedAt desc list order among inactive)
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
