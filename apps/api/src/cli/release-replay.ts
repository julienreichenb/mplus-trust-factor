/**
 * Ability catalog release shadow replay CLI (Phase 3B.3).
 *
 *   pnpm ability-catalog:release:replay -- \
 *     --base-release-id <uuid> --candidate-release-id <uuid>
 *
 * Acceptance modes:
 *   --self-bootstrap
 *   --static-vs-bootstrap
 *
 * Does not publish or activate.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, resetEnvCache } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { AbilityCatalogReplayService } from "../services/ability-catalog-replay-service.js";

function arg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function argInt(argv: string[], name: string): number | undefined {
  const v = arg(argv, name);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function printUsage(): never {
  console.error(`Usage:
  pnpm ability-catalog:release:replay -- --base-release-id <uuid> --candidate-release-id <uuid> [options]
  pnpm ability-catalog:release:replay -- --self-bootstrap [options]
  pnpm ability-catalog:release:replay -- --static-vs-bootstrap [options]

Options:
  --max-per-spec <n>   default 3
  --max-total <n>      default 120
  --force              re-run even if identical idempotent report exists
  --json
  --out <path>         write full report JSON

THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.`);
  process.exit(2);
}

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

const argv = process.argv.slice(2);
const selfBootstrap = argv.includes("--self-bootstrap");
const staticVsBootstrap = argv.includes("--static-vs-bootstrap");
const json = argv.includes("--json");
const force = argv.includes("--force");
const maxPerSpec = argInt(argv, "--max-per-spec");
const maxTotal = argInt(argv, "--max-total");
const outPath = arg(argv, "--out");
const baseReleaseId = arg(argv, "--base-release-id");
const candidateReleaseId = arg(argv, "--candidate-release-id");
const bootstrapReleaseId = arg(argv, "--bootstrap-release-id");

if (!selfBootstrap && !staticVsBootstrap && (!baseReleaseId || !candidateReleaseId)) {
  printUsage();
}

const env = loadEnv();
const prisma = createPrismaClient(env.DATABASE_URL);
const service = new AbilityCatalogReplayService(prisma);
const audit = {
  actorType: "system" as const,
  sessionSecret: env.SESSION_SECRET,
  userId: null,
};

try {
  const result = selfBootstrap
    ? await service.runSelfBootstrap(
        { maxPerSpec, maxTotal, force, bootstrapReleaseId },
        audit,
      )
    : staticVsBootstrap
      ? await service.runStaticVsBootstrap(
          { maxPerSpec, maxTotal, force, bootstrapReleaseId },
          audit,
        )
      : await service.runReplay(
          {
            baseReleaseId: baseReleaseId!,
            candidateReleaseId: candidateReleaseId!,
            baseKind: "RELEASE",
            maxPerSpec,
            maxTotal,
            force,
          },
          audit,
        );

  const payload = {
    notice: "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG.",
    reused: result.reused,
    replayId: result.replay.id,
    status: result.report.status,
    corpusDigest: result.report.corpusDigest,
    replayInputDigest: result.report.replayInputDigest,
    summary: result.report.summary,
    timing: result.report.timing,
    coverageNote: result.report.corpus.note,
    corpusCoveragePass: result.report.corpus.corpusCoveragePass,
    expectedSpecCount: result.report.corpus.expectedSpecCount,
    nativeV4SpecCount: result.report.corpus.nativeV4SpecCount,
    derivedSpecCount: result.report.corpus.derivedSpecCount,
    missingSpecCount: result.report.corpus.missingSpecCount,
    failures: result.report.failures,
  };

  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(resolve(outPath), JSON.stringify(result.report, null, 2), "utf8");
  }

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(result.report.summary.humanSummary);
    console.log("---");
    console.log(
      Object.entries({
        notice: payload.notice,
        status: payload.status,
        reused: payload.reused,
        replayId: payload.replayId,
        corpusDigest: payload.corpusDigest,
        loadMs: result.report.timing.loadMs,
        baseReplayMs: result.report.timing.baseReplayMs,
        candidateReplayMs: result.report.timing.candidateReplayMs,
        diffMs: result.report.timing.diffMs,
        totalMs: result.report.timing.totalMs,
        selected: result.report.timing.selectedCount,
        available: result.report.timing.corpusAvailableCount,
        coverageNote: payload.coverageNote,
      })
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("\n"),
    );
  }

  if (result.report.status !== "PASSED") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
