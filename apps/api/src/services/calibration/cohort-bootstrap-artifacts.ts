/**
 * Artifact writers for cohort bootstrap (plan / manifest / summary).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOOTSTRAP_PLAN_SCHEMA_VERSION,
  BOOTSTRAP_RUNNER_VERSION,
  BOOTSTRAP_SCHEMA_VERSION,
  BOOTSTRAP_SUMMARY_SCHEMA_VERSION,
  type SanitizedDbTarget,
} from "./bootstrap-env-guards.js";
import type {
  BootstrapManifest,
  BootstrapManifestEntry,
  BootstrapPlanDocument,
  BootstrapPlanEntry,
  BootstrapSummaryDocument,
} from "./cohort-bootstrap-types.js";

export function ensureOutputDir(outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
}

export function buildPlanDocument(input: {
  cohortId: string;
  sourceFileHash: string;
  sanitizedDatabaseTarget: SanitizedDbTarget;
  generatedAt: string;
  mode: "dry-run" | "execute";
  counts: Record<string, number>;
  identities: BootstrapPlanEntry[];
}): BootstrapPlanDocument {
  return {
    schemaVersion: BOOTSTRAP_PLAN_SCHEMA_VERSION,
    cohortId: input.cohortId,
    sourceFileHash: input.sourceFileHash,
    targetEnvironment: "test",
    sanitizedDatabaseTarget: {
      hostname: input.sanitizedDatabaseTarget.hostname,
      port: input.sanitizedDatabaseTarget.port,
      database: input.sanitizedDatabaseTarget.database,
    },
    generatedAt: input.generatedAt,
    runnerVersion: BOOTSTRAP_RUNNER_VERSION,
    mode: input.mode,
    counts: input.counts,
    identities: input.identities,
  };
}

export function buildManifestDocument(input: {
  cohortId: string;
  sourceFileHash: string;
  sanitizedDatabaseTarget: SanitizedDbTarget;
  generatedAt: string;
  mode: "dry-run" | "execute";
  identities: BootstrapManifestEntry[];
}): BootstrapManifest {
  return {
    schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
    cohortId: input.cohortId,
    sourceFileHash: input.sourceFileHash,
    targetEnvironment: "test",
    sanitizedDatabaseTarget: {
      hostname: input.sanitizedDatabaseTarget.hostname,
      port: input.sanitizedDatabaseTarget.port,
      database: input.sanitizedDatabaseTarget.database,
    },
    generatedAt: input.generatedAt,
    runnerVersion: BOOTSTRAP_RUNNER_VERSION,
    mode: input.mode,
    identities: input.identities,
  };
}

export function planEntriesToManifestEntries(
  plan: BootstrapPlanEntry[],
  overrides?: Map<string, Partial<BootstrapManifestEntry>>,
): BootstrapManifestEntry[] {
  return plan.map((e) => {
    const o = overrides?.get(e.identityKey);
    return {
      identityKey: e.identityKey,
      memberIds: e.memberIds,
      region: e.region,
      realmSlug: e.realmSlug,
      name: e.name,
      initialState: e.initialState,
      plannedOperation: o?.plannedOperation ?? e.plannedOperation,
      bootstrapJobKey: e.bootstrapJobKey,
      jobIds: o?.jobIds ?? [],
      attemptCount: o?.attemptCount ?? 0,
      resultState: o?.resultState ?? e.initialState,
      errorCode: o?.errorCode ?? e.errorCode,
      characterId: o?.characterId ?? e.characterId,
      reason: o?.reason ?? e.reason,
    };
  });
}

export function buildSummaryDocument(input: {
  cohortId: string;
  sourceFileHash: string;
  sanitizedDatabaseTarget: SanitizedDbTarget;
  generatedAt: string;
  mode: "dry-run" | "execute";
  memberCount: number;
  uniqueIdentityCount: number;
  counts: Record<string, number>;
  enqueuedJobIds: string[];
  skippedIdentityKeys: string[];
  failedIdentityKeys: string[];
  concurrency: number;
  limit: number | null;
  retryFailures: boolean;
}): BootstrapSummaryDocument {
  return {
    schemaVersion: BOOTSTRAP_SUMMARY_SCHEMA_VERSION,
    cohortId: input.cohortId,
    sourceFileHash: input.sourceFileHash,
    targetEnvironment: "test",
    sanitizedDatabaseTarget: {
      hostname: input.sanitizedDatabaseTarget.hostname,
      port: input.sanitizedDatabaseTarget.port,
      database: input.sanitizedDatabaseTarget.database,
    },
    generatedAt: input.generatedAt,
    runnerVersion: BOOTSTRAP_RUNNER_VERSION,
    mode: input.mode,
    memberCount: input.memberCount,
    uniqueIdentityCount: input.uniqueIdentityCount,
    counts: input.counts,
    enqueuedJobIds: input.enqueuedJobIds,
    skippedIdentityKeys: input.skippedIdentityKeys,
    failedIdentityKeys: input.failedIdentityKeys,
    concurrency: input.concurrency,
    limit: input.limit,
    retryFailures: input.retryFailures,
  };
}

export function renderSummaryMarkdown(summary: BootstrapSummaryDocument): string {
  const lines = [
    `# Cohort bootstrap summary`,
    ``,
    `- cohortId: \`${summary.cohortId}\``,
    `- mode: \`${summary.mode}\``,
    `- runner: \`${summary.runnerVersion}\``,
    `- generatedAt: \`${summary.generatedAt}\``,
    `- sourceFileHash: \`${summary.sourceFileHash}\``,
    `- target: hostname=\`${summary.sanitizedDatabaseTarget.hostname}\` port=\`${summary.sanitizedDatabaseTarget.port}\` database=\`${summary.sanitizedDatabaseTarget.database}\``,
    `- members: ${summary.memberCount}`,
    `- unique identities: ${summary.uniqueIdentityCount}`,
    `- concurrency: ${summary.concurrency}`,
    `- limit: ${summary.limit ?? "(none)"}`,
    `- retryFailures: ${summary.retryFailures}`,
    ``,
    `## Counts`,
    ``,
  ];
  for (const [k, v] of Object.entries(summary.counts).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push(``);
  lines.push(`## Enqueued job IDs (${summary.enqueuedJobIds.length})`);
  lines.push(``);
  if (summary.enqueuedJobIds.length === 0) {
    lines.push(`_(none)_`);
  } else {
    for (const id of summary.enqueuedJobIds) {
      lines.push(`- \`${id}\``);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

export function writeBootstrapArtifacts(
  outputDir: string,
  plan: BootstrapPlanDocument,
  manifest: BootstrapManifest,
  summary: BootstrapSummaryDocument,
): {
  planPath: string;
  manifestPath: string;
  summaryJsonPath: string;
  summaryMdPath: string;
} {
  ensureOutputDir(outputDir);
  const planPath = resolve(outputDir, "cohort-bootstrap.plan.json");
  const manifestPath = resolve(outputDir, "cohort-bootstrap.manifest.json");
  const summaryJsonPath = resolve(outputDir, "cohort-bootstrap.summary.json");
  const summaryMdPath = resolve(outputDir, "cohort-bootstrap.summary.md");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(summaryMdPath, renderSummaryMarkdown(summary), "utf8");
  return { planPath, manifestPath, summaryJsonPath, summaryMdPath };
}
