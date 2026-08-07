/**
 * Live validation: capability-scoped shared evidence for one fight only.
 *
 * Usage:
 *   pnpm wcl:probe:capability-evidence -- --live
 *
 * Fight: 1WKcCz2BnAQmbhfq:1:r1
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import { loadEnv } from "@mplus/config";
import {
  isCapabilityCoverageComplete,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import { createPrismaClient } from "@mplus/database";
import {
  acquireCapabilityEvidencePackage,
  clearCapabilityEvidenceMemoryIndex,
  LiveWarcraftLogsProvider,
  lookupCapabilityEvidenceForParticipant,
  persistCapabilityEvidencePackage,
  productionDefaultCapabilities,
  reloadCapabilityEvidenceFromArtifacts,
  VERIFIED_WCL_FILTER_CONTRACT,
} from "@mplus/provider-warcraftlogs";
import { createRepositories } from "./persistence/index.js";
import { createPersistentSharedEvidenceStore } from "./orchestration/scoring/persistent-shared-evidence-store.js";

const SPIKE_FIGHT = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function createLiveWclClient() {
  const env = loadEnv();
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    throw new Error("REFUSED: --live requires ALLOW_LIVE_PROVIDER_CALLS=true");
  }
  if (!env.WCL_CLIENT_ID || !env.WCL_CLIENT_SECRET) {
    throw new Error("WCL_CLIENT_ID and WCL_CLIENT_SECRET are required for --live");
  }
  return new LiveWarcraftLogsProvider({ env }).getGraphQlClient();
}

async function resolveFightWindow(client: ReturnType<typeof createLiveWclClient>): Promise<{
  fightStartMs: number;
  fightEndMs: number;
  dungeonSlug: string;
  masterData: unknown;
}> {
  const { OPERATIONS } = await import("@mplus/provider-warcraftlogs");
  const result = await client.requestPermissive<{
    reportData?: {
      report?: {
        revision?: number;
        fights?: Array<{
          id?: number;
          startTime?: number;
          endTime?: number;
          name?: string;
          keystoneLevel?: number;
        }>;
        masterData?: unknown;
      } | null;
    };
  }>({
    operationName: OPERATIONS.ReportWithFightAndMasterData.operationName,
    query: OPERATIONS.ReportWithFightAndMasterData.query,
    variables: {
      code: SPIKE_FIGHT.reportCode,
      fightIDs: [SPIKE_FIGHT.fightId],
    },
    region: "EU",
  });

  const report = result.response.data?.reportData?.report;
  if (!report) {
    throw new Error(`Report ${SPIKE_FIGHT.reportCode} not found`);
  }
  const fight = (report.fights ?? []).find((f) => f.id === SPIKE_FIGHT.fightId);
  if (!fight || fight.startTime == null || fight.endTime == null) {
    throw new Error(`Fight ${SPIKE_FIGHT.fightId} missing start/end`);
  }
  return {
    fightStartMs: fight.startTime,
    fightEndMs: fight.endTime,
    dungeonSlug: fight.name ? fight.name.toLowerCase().replace(/\s+/g, "-") : "unknown",
    masterData: report.masterData ?? null,
  };
}

function summarizePackage(pkg: CapabilityEvidencePackageV1) {
  return {
    schemaVersion: pkg.schemaVersion,
    mode: pkg.mode,
    sourceKey: pkg.sourceKey,
    compatibilityKey: pkg.compatibilityKey,
    actorSetHash: pkg.actorSetHash,
    abilityFilterHash: pkg.abilityFilterHash,
    catalogVersion: pkg.catalogVersion,
    acquisitionPlanVersion: pkg.acquisitionPlanVersion,
    graphqlQueryVersion: pkg.graphqlQueryVersion,
    friendlyPlayerActorIds: pkg.friendlyPlayerActorIds,
    accounting: pkg.accounting,
    verifiedFilters: pkg.verifiedFilters,
    coverage: pkg.coverage.map((c) => ({
      capability: c.capability,
      complete: isCapabilityCoverageComplete(c),
      stopReason: c.stopReason,
      pageCount: c.pageCount,
      eventCount: c.eventCount,
      limitations: c.limitations,
    })),
    compactEventCount: pkg.compactEvents.length,
    unknownSummaryCount: pkg.unknownAbilitySummaries.length,
    complete: pkg.complete,
    limitations: pkg.limitations,
    contentHash: pkg.contentHash,
    retention: pkg.retention,
    scoreCalculated: false,
  };
}

export async function runCapabilityEvidenceLiveValidation(options?: {
  outputRoot?: string;
}): Promise<{ summaryPath: string; packagePath: string }> {
  const outputRoot =
    options?.outputRoot ?? join(process.cwd(), "artifacts", "wcl-capability-evidence");
  await mkdir(outputRoot, { recursive: true });

  clearCapabilityEvidenceMemoryIndex();
  const client = createLiveWclClient();
  const fight = await resolveFightWindow(client);

  const env = loadEnv();
  const prismaLive = createPrismaClient(env.DATABASE_URL);
  const prismaReload = createPrismaClient(env.DATABASE_URL);
  const liveRepos = createRepositories(prismaLive);
  const reloadRepos = createRepositories(prismaReload);
  const liveStore = createPersistentSharedEvidenceStore({
    wclSource: liveRepos.wclSource,
    artifacts: liveRepos.artifacts,
    treatLegacyPayloadMissingAsCacheMiss: true,
    replaceLegacyPageArtifactsOnSave: true,
  });

  try {
    const acquired = await acquireCapabilityEvidencePackage({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      client,
      store: liveStore,
      reportCode: SPIKE_FIGHT.reportCode,
      reportRevision: SPIKE_FIGHT.reportRevision,
      fightId: SPIKE_FIGHT.fightId,
      dungeonSlug: fight.dungeonSlug,
      fightStartMs: fight.fightStartMs,
      fightEndMs: fight.fightEndMs,
      region: "EU",
      masterData: fight.masterData,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      forceRefetch: true,
    });

    const persisted = await persistCapabilityEvidencePackage({
      artifacts: reloadRepos.artifacts,
      package: acquired.package,
    });

    const reloaded = await reloadCapabilityEvidenceFromArtifacts({
      artifacts: reloadRepos.artifacts,
      persisted,
    });
    if (reloaded.providerCallsDuringReload !== 0) {
      throw new Error("PostgreSQL reload must perform zero provider calls");
    }

    // Second acquisition from persisted store only (simulate later refresh).
    const reloadOnly = await acquireCapabilityEvidencePackage({
      mode: "PRODUCTION_CAPABILITY_ACQUISITION",
      client: null,
      store: liveStore,
      reportCode: SPIKE_FIGHT.reportCode,
      reportRevision: SPIKE_FIGHT.reportRevision,
      fightId: SPIKE_FIGHT.fightId,
      dungeonSlug: fight.dungeonSlug,
      fightStartMs: fight.fightStartMs,
      fightEndMs: fight.fightEndMs,
      region: "EU",
      masterData: fight.masterData,
      friendlyPlayerActorIds: acquired.package.friendlyPlayerActorIds,
      ownedPetActorIds: acquired.package.ownedPetActorIds,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
      localOnly: true,
      forceRefetch: false,
    });

    const otherActor = acquired.package.friendlyPlayerActorIds.find(
      (id) => id !== acquired.package.friendlyPlayerActorIds[0],
    );
    const secondParticipant =
      otherActor == null
        ? null
        : lookupCapabilityEvidenceForParticipant({
            reportCode: SPIKE_FIGHT.reportCode,
            fightId: SPIKE_FIGHT.fightId,
            reportRevision: SPIKE_FIGHT.reportRevision,
            playerActorId: otherActor,
            capabilitySet: productionDefaultCapabilities(),
            actorSetHash: acquired.package.actorSetHash,
            abilityFilterHash: acquired.package.abilityFilterHash,
            catalogVersion: CURRENT_CATALOG_VERSION_ID,
          });

    const summary = {
      schemaVersion: "wcl-capability-evidence-live-summary-v1",
      fight: SPIKE_FIGHT,
      verifiedWclFilterContract: VERIFIED_WCL_FILTER_CONTRACT,
      liveAcquisition: summarizePackage(acquired.package),
      packageArtifactId: persisted.packageArtifactId,
      reloadProviderCalls: reloaded.providerCallsDuringReload,
      localOnlyReloadProviderCalls: reloadOnly.providerCalls,
      secondParticipantProviderCalls: secondParticipant?.providerCalls ?? null,
      secondParticipantActorId: otherActor ?? null,
      acceptance: {
        buffsCompleteOrPreciseLimit: acquired.package.coverage
          .filter((c) =>
            [
              "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
              "SURVIVAL_DEFENSIVE_ACTIVATIONS",
              "SURVIVAL_RECOVERY_ACTIVATIONS",
              "UTILITY_EXTERNAL_TARGET_CONTEXT",
            ].includes(c.capability),
          )
          .map((c) => ({
            capability: c.capability,
            complete: isCapabilityCoverageComplete(c),
            stopReason: c.stopReason,
          })),
        damageTaken: acquired.package.coverage.find(
          (c) => c.capability === "SURVIVAL_DAMAGE_TAKEN",
        ),
        sharedOnceForFive: acquired.package.friendlyPlayerActorIds.length,
        filteredGlobalSeparation: acquired.package.abilityFilterHash !== "none",
        postgresReloadZeroCalls: reloaded.providerCallsDuringReload === 0,
        secondParticipantZeroCalls: secondParticipant?.providerCalls === 0,
        noScoreCalculated: true,
      },
    };

    const summaryPath = join(outputRoot, `${SPIKE_FIGHT.reportCode}-f${SPIKE_FIGHT.fightId}-capability-summary.json`);
    const packagePath = join(outputRoot, `${SPIKE_FIGHT.reportCode}-f${SPIKE_FIGHT.fightId}-capability-package.json`);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    await writeFile(packagePath, JSON.stringify(acquired.package, null, 2), "utf8");

    console.log(JSON.stringify(summary, null, 2));
    return { summaryPath, packagePath };
  } finally {
    await prismaLive.$disconnect();
    await prismaReload.$disconnect();
  }
}

async function main() {
  const live = process.argv.includes("--live");
  if (!live) {
    console.log(
      "Capability evidence probe defaults to refusing network. Pass --live with ALLOW_LIVE_PROVIDER_CALLS=true.",
    );
    process.exit(0);
  }
  await runCapabilityEvidenceLiveValidation();
}

const isDirect =
  process.argv[1]?.includes("wcl-capability-evidence-probe") ||
  process.argv[1]?.includes("wcl-capability-evidence-probe.ts");
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
