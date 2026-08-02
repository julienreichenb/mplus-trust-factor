/**
 * Agent 11 calibration cohort bootstrap CLI.
 *
 * Usage:
 *   CALIBRATION_BOOTSTRAP_ENV=test pnpm calibration:cohort-bootstrap -- \
 *     --cohort-file /inputs/resolved.v1.json --environment test --dry-run
 *
 *   CALIBRATION_BOOTSTRAP_ENV=test ALLOW_LIVE_PROVIDER_CALLS=true pnpm calibration:cohort-bootstrap -- \
 *     --cohort-file /inputs/resolved.v1.json --environment test --execute --limit 37 --concurrency 2
 *
 * Dry-run: read-only DB probes + plan artifacts. Never providers, enqueue, or writes.
 * Execute: reuses CharacterService.resolveCharacter (normal pipeline) with bounded concurrency.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "@mplus/config";
import { createPrismaClient } from "@mplus/database";
import { createLogger } from "@mplus/observability";
import {
  assertCalibrationBootstrapEnv,
  assertLiveProviderCallsAllowedForExecute,
  assertPositiveTestBootstrapTarget,
  assertResumeManifestCompatible,
  BOOTSTRAP_DEFAULT_CONCURRENCY,
  BOOTSTRAP_RUNNER_VERSION,
  BOOTSTRAP_SCHEMA_VERSION,
  formatSanitizedDbTarget,
  parseBoundedPositiveInt,
  parseLimitOption,
  resolveBootstrapDatabaseUrl,
} from "./bootstrap-env-guards.js";
import { probeAllIdentities } from "./cohort-bootstrap-db.js";
import {
  BOOTSTRAP_EVENTS,
  executeBootstrapPlan,
  type ExecuteBootstrapDeps,
} from "./cohort-bootstrap-execute.js";
import {
  dedupeCohortIdentities,
  filterIdentitiesByMemberSelection,
  hashFileContents,
  parseCohortBootstrapDoc,
} from "./cohort-bootstrap-identity.js";
import { countByState, planBootstrapCohort } from "./cohort-bootstrap-plan.js";
import {
  buildManifestDocument,
  buildPlanDocument,
  buildSummaryDocument,
  planEntriesToManifestEntries,
  writeBootstrapArtifacts,
} from "./cohort-bootstrap-artifacts.js";
import type { BootstrapManifest, BootstrapManifestEntry } from "./cohort-bootstrap-types.js";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const DEFAULT_COHORT = "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json";
const DEFAULT_OUTPUT = "tmp/calibration/agent11-2026-08-01";

function resolveInputPath(p: string): string {
  const fromCwd = resolve(p);
  if (existsSync(fromCwd)) return fromCwd;
  const fromRoot = resolve(ROOT, p);
  if (existsSync(fromRoot)) return fromRoot;
  return fromCwd;
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const multi = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === "include-member" || key === "exclude-member") {
      if (!next || next.startsWith("--")) {
        throw new Error(`REFUSED: --${key} requires a value`);
      }
      const list = multi.get(key) ?? [];
      list.push(next);
      multi.set(key, list);
      i += 1;
      continue;
    }
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, values, multi };
}

function loadDotEnvKeys(path: string, allowKeys: Set<string>): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowKeys.has(key)) continue;
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertNoV2FlagMutation(): void {
  // Soft assertion: runner must not set these. We never write them; refuse if CLI asks to flip.
}

export interface CohortBootstrapCliOptions {
  /** Injectable deps for tests. */
  deps?: {
    prismaUrl?: string;
    resolveCharacter?: ExecuteBootstrapDeps["resolveCharacter"];
    nowIso?: string;
    skipPrismaDisconnect?: boolean;
  };
}

export async function main(
  argv = process.argv.slice(2),
  cliOpts: CohortBootstrapCliOptions = {},
): Promise<number> {
  loadDotEnvKeys(
    resolve(ROOT, ".env"),
    new Set(["SCORE_TTL_SECONDS", "LOG_LEVEL", "APP_VERSION"]),
  );

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }
  const { flags, values, multi } = parsed;

  const dryRun = flags.has("dry-run");
  const execute = flags.has("execute");
  if (dryRun && execute) {
    console.error("REFUSED: --dry-run and --execute are mutually exclusive");
    return 2;
  }
  if (!dryRun && !execute) {
    console.error("REFUSED: specify --dry-run or --execute");
    return 2;
  }

  const environment = values.get("environment")?.trim() ?? "";
  if (environment !== "test") {
    console.error(
      `REFUSED: --environment must be exactly "test" (got: ${environment === "" ? "(missing)" : JSON.stringify(environment)})`,
    );
    return 2;
  }

  try {
    assertCalibrationBootstrapEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  if (execute) {
    try {
      assertLiveProviderCallsAllowedForExecute();
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 2;
    }
  }

  if (flags.has("activate-model") || flags.has("publish-v2") || flags.has("enable-scoring-v2")) {
    console.error("REFUSED: bootstrap runner must not activate models, publish V2, or flip Scoring V2 flags");
    return 2;
  }
  assertNoV2FlagMutation();

  const cohortFile = resolveInputPath(values.get("cohort-file") ?? resolve(ROOT, DEFAULT_COHORT));
  if (!existsSync(cohortFile)) {
    console.error(`REFUSED: cohort file not found: ${cohortFile}`);
    return 2;
  }
  // policy-file is optional for bootstrap (resolved cohort already carries exclusion reasons).
  const policyFile = values.get("policy-file");
  if (policyFile) {
    const policyPath = resolveInputPath(policyFile);
    if (!existsSync(policyPath)) {
      console.error(`REFUSED: policy file not found: ${policyPath}`);
      return 2;
    }
  }

  const outputDirRaw = values.get("output-dir");
  const outputDir = !outputDirRaw
    ? resolve(ROOT, DEFAULT_OUTPUT)
    : outputDirRaw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(outputDirRaw)
      ? resolve(outputDirRaw)
      : resolve(ROOT, outputDirRaw);

  let concurrency: number;
  let limit: number | null;
  try {
    concurrency = parseBoundedPositiveInt(values.get("concurrency"), {
      name: "concurrency",
      defaultValue: BOOTSTRAP_DEFAULT_CONCURRENCY,
      min: 1,
      max: 8,
    });
    limit = parseLimitOption(values.get("limit"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  const retryFailures = flags.has("retry-failures");
  const includeMemberIds = new Set(multi.get("include-member") ?? []);
  const excludeMemberIds = new Set(multi.get("exclude-member") ?? []);

  const resumePath = values.get("resume-manifest");
  let resumeRaw: unknown = null;
  if (resumePath) {
    const abs = resolveInputPath(resumePath);
    if (!existsSync(abs)) {
      console.error(`REFUSED: resume manifest not found: ${abs}`);
      return 2;
    }
    try {
      resumeRaw = JSON.parse(readFileSync(abs, "utf8"));
    } catch {
      console.error("REFUSED: resume manifest is not valid JSON");
      return 2;
    }
  }

  let dbUrl: string;
  try {
    dbUrl = cliOpts.deps?.prismaUrl ?? resolveBootstrapDatabaseUrl();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  let sanitizedTarget;
  try {
    sanitizedTarget = assertPositiveTestBootstrapTarget(dbUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }

  const cohortRawText = readFileSync(cohortFile, "utf8");
  const sourceFileHash = hashFileContents(cohortRawText);
  let cohortDoc;
  try {
    cohortDoc = parseCohortBootstrapDoc(JSON.parse(cohortRawText));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  let resumeManifest: BootstrapManifest | null = null;
  if (resumeRaw != null) {
    try {
      assertResumeManifestCompatible(resumeRaw as BootstrapManifest, {
        schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
        cohortId: cohortDoc.cohortId,
        sourceFileHash,
      });
      resumeManifest = resumeRaw as BootstrapManifest;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 2;
    }
  }

  const allIdentities = dedupeCohortIdentities(cohortDoc.members);
  const identities = filterIdentitiesByMemberSelection(allIdentities, {
    includeMemberIds,
    excludeMemberIds,
  });

  const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info", name: "calibration-bootstrap" });
  const emit = (event: string, payload: Record<string, unknown>) => {
    logger.info({ event, ...payload }, event);
  };

  const generatedAt = cliOpts.deps?.nowIso ?? new Date().toISOString();
  const mode = dryRun ? "dry-run" : "execute";

  emit(BOOTSTRAP_EVENTS.started, {
    event: BOOTSTRAP_EVENTS.started,
    mode,
    cohortId: cohortDoc.cohortId,
    uniqueIdentityCount: identities.length,
    memberCount: cohortDoc.members.length,
    runnerVersion: BOOTSTRAP_RUNNER_VERSION,
    dbTarget: formatSanitizedDbTarget(sanitizedTarget),
    concurrency,
    limit,
  });

  console.log(`CALIBRATION_BOOTSTRAP_ENV=test`);
  console.log(`bootstrapDbTarget: ${formatSanitizedDbTarget(sanitizedTarget)}`);
  console.log(`mode=${mode} cohortId=${cohortDoc.cohortId} identities=${identities.length}`);

  const prisma = createPrismaClient(dbUrl);
  const safety = {
    characterPublishedScoreMutations: 0,
    modelActivations: 0,
    publicationJobsCreated: 0,
    featureFlagsMutated: 0,
    providerCalls: 0,
  };

  try {
    const dbByIdentityKey = await probeAllIdentities(prisma, identities);
    const { entries, counts } = planBootstrapCohort({
      cohortId: cohortDoc.cohortId,
      identities,
      dbByIdentityKey,
      includeMemberIds,
      resumeManifest,
      retryFailures,
      limit,
    });

    for (const entry of entries) {
      emit(BOOTSTRAP_EVENTS.identityPlanned, {
        event: BOOTSTRAP_EVENTS.identityPlanned,
        identityKey: entry.identityKey,
        initialState: entry.initialState,
        plannedOperation: entry.plannedOperation,
        reason: entry.reason,
      });
    }

    let executeResult = {
      overrides: new Map<string, Partial<BootstrapManifestEntry>>(),
      enqueuedJobIds: [] as string[],
      skippedIdentityKeys: [] as string[],
      failedIdentityKeys: [] as string[],
    };

    if (execute) {
      let resolveCharacter = cliOpts.deps?.resolveCharacter;
      let apiClose: (() => Promise<void>) | null = null;
      if (!resolveCharacter) {
        const { createApiContainer } = await import("../../container.js");
        const { CharacterService } = await import("../character-service.js");
        const env = loadEnv({
          ...process.env,
          DATABASE_URL: dbUrl,
        });
        const container = createApiContainer(env);
        apiClose = () => container.close();
        const service = new CharacterService(container);
        resolveCharacter = (identity, opts) => service.resolveCharacter(identity, opts);
      }

      try {
        executeResult = await executeBootstrapPlan(entries, {
          resolveCharacter,
          emit,
          safety,
        }, {
          concurrency,
          correlationPrefix: `calib-bootstrap:${cohortDoc.cohortId}`,
        });
      } finally {
        if (apiClose) await apiClose();
      }
    } else {
      // Dry-run: record planned skips without resolve / enqueue.
      for (const entry of entries) {
        if (entry.plannedOperation === "ENQUEUE_RESOLVE_REFRESH") {
          executeResult.skippedIdentityKeys.push(entry.identityKey);
        } else {
          executeResult.skippedIdentityKeys.push(entry.identityKey);
          emit(BOOTSTRAP_EVENTS.identitySkipped, {
            event: BOOTSTRAP_EVENTS.identitySkipped,
            identityKey: entry.identityKey,
            initialState: entry.initialState,
            reason: entry.reason,
          });
        }
      }
      if (safety.providerCalls !== 0 || safety.characterPublishedScoreMutations !== 0) {
        console.error("REFUSED: dry-run safety ledger was mutated");
        return 2;
      }
    }

    const countMap = countByState(entries);
    const planDoc = buildPlanDocument({
      cohortId: cohortDoc.cohortId,
      sourceFileHash,
      sanitizedDatabaseTarget: sanitizedTarget,
      generatedAt,
      mode,
      counts: { ...counts, ...countMap },
      identities: entries,
    });
    const manifest = buildManifestDocument({
      cohortId: cohortDoc.cohortId,
      sourceFileHash,
      sanitizedDatabaseTarget: sanitizedTarget,
      generatedAt,
      mode,
      identities: planEntriesToManifestEntries(entries, executeResult.overrides),
    });
    const summary = buildSummaryDocument({
      cohortId: cohortDoc.cohortId,
      sourceFileHash,
      sanitizedDatabaseTarget: sanitizedTarget,
      generatedAt,
      mode,
      memberCount: cohortDoc.members.length,
      uniqueIdentityCount: allIdentities.length,
      counts: { ...counts, ...countMap },
      enqueuedJobIds: executeResult.enqueuedJobIds,
      skippedIdentityKeys: executeResult.skippedIdentityKeys,
      failedIdentityKeys: executeResult.failedIdentityKeys,
      concurrency,
      limit,
      retryFailures,
    });

    const paths = writeBootstrapArtifacts(outputDir, planDoc, manifest, summary);
    const partialFailure = execute && executeResult.failedIdentityKeys.length > 0;
    emit(partialFailure ? BOOTSTRAP_EVENTS.failed : BOOTSTRAP_EVENTS.completed, {
      event: partialFailure ? BOOTSTRAP_EVENTS.failed : BOOTSTRAP_EVENTS.completed,
      mode,
      cohortId: cohortDoc.cohortId,
      plannedEnqueue: countMap.plannedEnqueue ?? 0,
      enqueued: executeResult.enqueuedJobIds.length,
      failed: executeResult.failedIdentityKeys.length,
      outputDir,
      ok: !partialFailure,
    });

    console.log(`wrote ${paths.planPath}`);
    console.log(`wrote ${paths.manifestPath}`);
    console.log(`wrote ${paths.summaryJsonPath}`);
    console.log(`wrote ${paths.summaryMdPath}`);
    console.log(
      `summary: members=${summary.memberCount} identities=${summary.uniqueIdentityCount} ` +
        `plannedEnqueue=${countMap.plannedEnqueue ?? 0} enqueued=${executeResult.enqueuedJobIds.length}`,
    );

    // Stable fingerprint for dry-run determinism checks (excluding timestamps).
    const stableHash = createHash("sha256")
      .update(
        JSON.stringify({
          cohortId: planDoc.cohortId,
          sourceFileHash,
          identities: planDoc.identities.map((i) => ({
            identityKey: i.identityKey,
            initialState: i.initialState,
            plannedOperation: i.plannedOperation,
            bootstrapJobKey: i.bootstrapJobKey,
          })),
        }),
        "utf8",
      )
      .digest("hex");
    console.log(`planStableHash=${stableHash}`);

    return executeResult.failedIdentityKeys.length > 0 && execute ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    emit(BOOTSTRAP_EVENTS.failed, { event: BOOTSTRAP_EVENTS.failed, message });
    console.error(message);
    return 1;
  } finally {
    if (!cliOpts.deps?.skipPrismaDisconnect) {
      await prisma.$disconnect();
    }
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return entry.replace(/\\/g, "/").endsWith("/calibration/cohort-bootstrap-cli.ts");
  }
}

if (isMain()) {
  main().then((code) => process.exit(code));
}
