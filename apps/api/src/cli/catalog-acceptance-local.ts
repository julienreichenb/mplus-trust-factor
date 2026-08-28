/**
 * Local final acceptance for ability-catalog product flow (A–I).
 * One-shot operator script — not permanent architecture.
 *
 * Analyses (B/G/I) invoke scoring:smoke:character as a subprocess.
 * Catalog refresh/activate/rollback use existing API services against the local DB.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { resolveEnqueueAbilityCatalogExecutionPin } from "@mplus/worker";
import { AbilityCatalogReleaseService } from "../services/ability-catalog-release-service.js";
import { AbilityCatalogReleaseActivationService } from "../services/ability-catalog-release-activation-service.js";
import { AbilityCatalogRefreshOrchestrationService } from "../services/ability-catalog-refresh-orchestration-service.js";
import { AbilityCatalogReplayService } from "../services/ability-catalog-replay-service.js";
import { AbilityCatalogWorkflowService } from "../services/ability-catalog-workflow-service.js";

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

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function log(step: string, data: unknown): void {
  console.log(`\n=== ${step} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function runCmd(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(args[0]!, args.slice(1), {
      cwd,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
    child.on("error", () => resolvePromise(1));
  });
}

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../../..");
loadDotEnvFile(resolve(root, ".env"));

process.env.ABILITY_CATALOG_SIMC_BIN ??= "C:\\Tools\\SimulationCraft\\simc.exe";
// Revision is discovered from the binary — do not set ABILITY_CATALOG_SIMC_REVISION.

resetEnvCache();
const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const audit = {
  userId: null as string | null,
  actorType: "system" as const,
  sessionSecret: env.SESSION_SECRET,
};

const releases = new AbilityCatalogReleaseService(prisma);
const activation = new AbilityCatalogReleaseActivationService(prisma);
const refreshSvc = new AbilityCatalogRefreshOrchestrationService(prisma, env);
const replays = new AbilityCatalogReplayService(prisma);
const workflow = new AbilityCatalogWorkflowService(prisma);

const IDENTITY = { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" };

async function ensureBootstrapActive() {
  const boot = await releases.persistBootstrapRelease0(audit);
  const existing = await prisma.abilityCatalogRelease.findFirst({ where: { status: "ACTIVE" } });
  if (existing) {
    return {
      id: existing.id,
      releaseKey: existing.releaseKey,
      contentDigest: existing.contentDigest,
    };
  }
  const replay = await prisma.abilityCatalogReleaseReplay.findFirst({
    where: { candidateReleaseId: boot.release.id, status: "PASSED" },
  });
  if (!replay) {
    await prisma.abilityCatalogReleaseReplay.create({
      data: {
        idempotencyKey: `acceptance|${boot.release.id}`,
        baseKind: "STATIC",
        baseReleaseId: null,
        candidateReleaseId: boot.release.id,
        corpusDigest: "0".repeat(64),
        replayInputDigest: "1".repeat(64),
        replayEngineVersion: "acceptance",
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
  return {
    id: result.release.id,
    releaseKey: result.release.releaseKey,
    contentDigest: result.release.contentDigest,
  };
}

async function runSmokeAnalysis(label: string) {
  const pinBefore = await resolveEnqueueAbilityCatalogExecutionPin({ prisma });
  const code = await runCmd(
    [
      "pnpm",
      "scoring:smoke:character",
      "--",
      "--region",
      IDENTITY.region,
      "--realm",
      IDENTITY.realmSlug,
      "--character",
      IDENTITY.name,
    ],
    root,
    { ...process.env },
  );
  if (code !== 0) throw new Error(`${label}: smoke failed exit ${code}`);

  const character = await prisma.character.findFirst({
    where: {
      displayName: { equals: IDENTITY.name, mode: "insensitive" },
      realm: { slug: IDENTITY.realmSlug },
      region: { code: IDENTITY.region },
    },
    select: { id: true },
  });
  const score = character
    ? await prisma.characterScore.findFirst({
        where: { characterId: character.id },
        orderBy: { calculatedAt: "desc" },
        select: {
          id: true,
          composite: true,
          abilityCatalogReleaseKey: true,
          abilityCatalogContentDigest: true,
          abilityCatalogReleaseId: true,
          calculatedAt: true,
        },
      })
    : null;
  const snapshot = character
    ? await prisma.scoreSnapshot.findFirst({
        where: { characterId: character.id },
        orderBy: { calculatedAt: "desc" },
        select: {
          id: true,
          overallScore: true,
          abilityCatalogReleaseKey: true,
          abilityCatalogContentDigest: true,
          abilityCatalogReleaseId: true,
        },
      })
    : null;
  log(label, { pinBefore, characterId: character?.id ?? null, score, snapshot });
  return { pinBefore, score, snapshot };
}

async function createDevCandidateFromBootstrap(baseReleaseId: string) {
  const batchId = randomUUID();
  const itemRuleId = randomUUID();
  const draftRuleId = randomUUID();
  const reportDigest = sha256(Buffer.from(`acceptance-dev-${randomUUID()}`));
  const spellId = 98_765_432;
  const canonicalKey = `test.acceptance.${randomUUID().slice(0, 8)}.ability`;

  await prisma.abilityCatalogReviewBatch.create({
    data: {
      id: batchId,
      reportDigest,
      reviewPlanDigest: sha256(Buffer.from(`acceptance-plan-${batchId}`)),
      datasetKind: "PINNED",
      sourceIdentities: { acceptance: true },
      summaryCounts: {},
    },
  });
  await prisma.abilityCatalogReviewItem.create({
    data: {
      id: itemRuleId,
      batchId,
      kind: "NEW_ABILITY_CANDIDATE",
      identityKey: `synthetic.acceptance.${randomUUID().slice(0, 8)}`,
      name: "Acceptance Synthetic Ability",
      reviewReason: "local acceptance isolated curation",
      evidence: {},
      sourceProvenance: {},
      decisionAction: "ACCEPT",
      decidedAt: new Date(),
      version: 1,
    },
  });
  await prisma.abilityCatalogDraftRule.create({
    data: {
      id: draftRuleId,
      reviewItemId: itemRuleId,
      canonicalKey,
      name: "Acceptance Synthetic Ability",
      spellIds: [spellId],
      bindings: [{ spellId, role: "PRIMARY_ACTIVATION" }],
      classSlug: "mage",
      specSlugs: ["frost"],
      raceSlugs: [],
      category: "OFFENSIVE_MINOR",
      dimensionTags: ["PERFORMANCE_OFFENSIVE_COOLDOWN"],
      availability: "BASELINE",
      sourceOwnership: "PLAYER",
      provenance: {
        source: "CURATED_OVERRIDE",
        verifiedAt: "2026-08-27",
        gameVersion: "12.0.0",
        certainty: "verified",
      },
      status: "READY_FOR_PUBLISH_REVIEW",
      version: 1,
    },
  });

  const created = await releases.createReleaseCandidate(
    {
      baseReleaseId,
      includedDraftRuleIds: [{ draftRuleId, draftVersion: 1 }],
      notes: "local acceptance isolated synthetic ADD_RULE",
    },
    audit,
  );
  return {
    releaseId: created.release.id,
    contentDigest: created.release.contentDigest,
    releaseKey: created.release.releaseKey,
    validationStatus: created.release.validationStatus,
    status: created.release.status,
  };
}

try {
  const activeBefore = await ensureBootstrapActive();
  log("A Bootstrap ACTIVE", activeBefore);

  const first = await runSmokeAnalysis("B initial analysis");

  log("C starting refresh", {
    simcBin: env.ABILITY_CATALOG_SIMC_BIN,
  });
  const refreshOut = await refreshSvc.runRefresh(audit);
  const activeAfterRefresh = await prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
  });
  const workflowAfterRefresh = await workflow.getStatus();
  log("C refresh result", {
    batchId: refreshOut.batchId,
    created: refreshOut.created,
    reviewRequired: refreshOut.reviewRequired,
    activeUnchanged: refreshOut.activeUnchanged,
    summary: refreshOut.result.summary,
    reportValid: refreshOut.result.report.validation.valid,
    activeAfterRefresh: activeAfterRefresh
      ? { id: activeAfterRefresh.id, releaseKey: activeAfterRefresh.releaseKey }
      : null,
    workflowState: workflowAfterRefresh.state,
    reviewPending: workflowAfterRefresh.review.pendingItems,
  });

  const itemCount = await prisma.abilityCatalogReviewItem.count({
    where: { batchId: refreshOut.batchId },
  });
  const items = await prisma.abilityCatalogReviewItem.findMany({
    where: { batchId: refreshOut.batchId },
    take: 5,
    select: { id: true, kind: true, name: true, decisionAction: true },
  });
  log("D review queue sample", { itemCount, sample: items });

  const candidate = await createDevCandidateFromBootstrap(activeBefore.id);
  log("E candidate compiled", candidate);

  const replay = await replays.runReplay(
    {
      baseKind: "RELEASE",
      baseReleaseId: activeBefore.id,
      candidateReleaseId: candidate.releaseId,
      maxPerSpec: 2,
      maxTotal: 40,
      force: true,
    },
    audit,
  );
  log("E replay", { status: replay.replay.status, summary: replay.replay.summary });

  if (candidate.validationStatus !== "PASS" || replay.replay.status !== "PASSED") {
    throw new Error(
      `Candidate not activatable: validation=${candidate.validationStatus} replay=${replay.replay.status}`,
    );
  }

  const published = await activation.activate(
    {
      releaseId: candidate.releaseId,
      confirmationDigest: candidate.contentDigest,
      confirm: true,
      expectedPreviousActiveId: activeBefore.id,
    },
    audit,
    { type: "PUBLISH" },
  );
  log("F activated candidate", {
    id: published.release.id,
    releaseKey: published.release.releaseKey,
    previous: published.previousActive?.releaseKey ?? null,
  });

  const second = await runSmokeAnalysis("G post-activation analysis");

  const rolled = await activation.activate(
    {
      releaseId: activeBefore.id,
      confirmationDigest: activeBefore.contentDigest,
      confirm: true,
      reason: "local acceptance rollback to Bootstrap",
      expectedPreviousActiveId: candidate.releaseId,
    },
    audit,
    { type: "ROLLBACK" },
  );
  log("H rollback", { id: rolled.release.id, releaseKey: rolled.release.releaseKey });

  const third = await runSmokeAnalysis("I post-rollback analysis");

  log("SUMMARY", {
    A_active: activeBefore.releaseKey,
    B_pin: first.pinBefore.kind === "RELEASE" ? first.pinBefore.releaseKey : first.pinBefore.catalogVersionId,
    B_scoreRelease: first.score?.abilityCatalogReleaseKey ?? null,
    C_reviewRequired: refreshOut.reviewRequired,
    C_activeUnchanged: activeAfterRefresh?.id === activeBefore.id,
    E_candidate: candidate.releaseKey,
    E_validation: candidate.validationStatus,
    E_replay: replay.replay.status,
    F_active: published.release.releaseKey,
    G_pin: second.pinBefore.kind === "RELEASE" ? second.pinBefore.releaseKey : second.pinBefore.catalogVersionId,
    G_scoreRelease: second.score?.abilityCatalogReleaseKey ?? null,
    previousStillBootstrap: first.score?.abilityCatalogReleaseId === activeBefore.id,
    H_active: rolled.release.releaseKey,
    I_pin: third.pinBefore.kind === "RELEASE" ? third.pinBefore.releaseKey : third.pinBefore.catalogVersionId,
    I_scoreRelease: third.score?.abilityCatalogReleaseKey ?? null,
  });
} catch (err) {
  console.error("ACCEPTANCE FAILED", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
