import { createServer, type Server } from "node:http";
import { getConfigSummary, loadEnv } from "@mplus/config";
import { QUEUE_NAMES } from "@mplus/contracts";
import { createWorkerContainer } from "./container.js";
import { closeWorkers, createWorkers } from "./processors.js";
import { createQueueProducers } from "./queues.js";

function startHealthServer(
  port: number,
  checkReady: () => Promise<{ ok: boolean; detail?: string }>,
): Server {
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      if (req.method === "GET" && url.startsWith("/health/live")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/health/ready")) {
        const ready = await checkReady();
        res.writeHead(ready.ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: ready.ok ? "ok" : "not_ready", detail: ready.detail }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    })();
  });
  server.listen(port, "0.0.0.0");
  return server;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const container = createWorkerContainer(env);
  const connection = container.createRedisConnection();
  // Separate Redis connection for admission snapshot maintenance so shutdown
  // can stop the refresher before quitting the queue connection.
  const admissionRedis = container.createRedisConnection();

  // Prefer DB-cached season authority within TTL so API+worker do not double-call Blizzard.
  try {
    const {
      bootstrapSeasonAuthorityForRegions,
      listPersistedRegionsForAuthority,
    } = await import("./orchestration/season-authority.js");
    const regions = await listPersistedRegionsForAuthority(container.prisma);
    if (regions.length > 0) {
      const results = await bootstrapSeasonAuthorityForRegions(
        {
          prisma: container.prisma,
          blizzard: container.providers.blizzard,
          logger: container.logger,
        },
        regions,
      );
      for (const result of results) {
        container.logger.info(
          {
            event: "season_authority_ready",
            readiness: result.status,
            region: result.region,
            authoritativeSeasonId: result.authority?.blizzardSeasonId ?? null,
            authoritativeSeasonSlug: result.authority?.slug ?? null,
            authoritySource: result.authority?.authoritySource ?? null,
            authorityVerifiedAt: result.authority?.authorityVerifiedAt?.toISOString() ?? null,
          },
          `season authority bootstrap: ${result.status}`,
        );
      }
    }
  } catch (error) {
    container.logger.warn(
      { err: error, event: "season_authority_ready", readiness: "unavailable" },
      "season authority bootstrap failed — refresh jobs will verify or defer at execution",
    );
  }

  // Experience season dates + Raider.IO slug binding + previous-season population policy.
  // Soft-fail: never blocks worker startup. Not gated on WCL.
  try {
    const { listPersistedRegionsForAuthority } = await import(
      "./orchestration/season-authority.js"
    );
    const { runExperienceSeasonBootstrapSafe } = await import(
      "./orchestration/scoring/experience-season-bootstrap.js"
    );
    const { recordProviderResult } = await import("./orchestration/provider-recording.js");
    const regions = await listPersistedRegionsForAuthority(container.prisma);
    if (regions.length > 0) {
      const allowProviderCalls =
        container.env.ALLOW_LIVE_PROVIDER_CALLS === true &&
        (container.env.PROVIDER_MODE === "live" || container.env.PROVIDER_MODE === "fixture");
      await runExperienceSeasonBootstrapSafe({
        prisma: container.prisma,
        regions,
        blizzard: container.providers.blizzard,
        raiderIo: container.providers.raiderio,
        persistProviderResult: (result) =>
          recordProviderResult(container.repositories, result),
        logger: container.logger,
        allowProviderCalls:
          allowProviderCalls &&
          !container.disabledProviders.has("blizzard") &&
          !container.disabledProviders.has("raiderio"),
      });
    }
  } catch (error) {
    container.logger.warn(
      { err: error, event: "experience_season_bootstrap" },
      "experience season bootstrap failed — continuing worker startup",
    );
  }

  // Realm catalog readiness (index-first). Independent of score-model seeding.
  // Empty catalog + failed bootstrap fails closed before queues report ready.
  let realmCatalogReady = true;
  try {
    const { ensureRealmCatalogReady } = await import("./orchestration/bootstrap-realm-catalog.js");
    const catalog = await ensureRealmCatalogReady({
      blizzard: container.providers.blizzard,
      realms: container.repositories.realm,
      logger: container.logger,
      staleAfterSeconds: env.REALM_CATALOG_STALE_SECONDS,
    });
    realmCatalogReady = catalog.ready;
    if (catalog.failClosed) {
      container.logger.error(
        {
          event: "realm_catalog_ready",
          readiness: "unavailable",
          providerMode: env.PROVIDER_MODE,
          errors: catalog.errors,
        },
        "realm catalog bootstrap failed closed — worker will not report ready",
      );
      if (env.PROVIDER_MODE === "live") {
        await admissionRedis.quit();
        await connection.quit();
        await container.prisma.$disconnect();
        process.exit(1);
      }
    }
  } catch (error) {
    container.logger.error(
      { err: error, event: "realm_catalog_ready", readiness: "unavailable" },
      "realm catalog bootstrap threw",
    );
    if (env.PROVIDER_MODE === "live") {
      await admissionRedis.quit();
      await connection.quit();
      await container.prisma.$disconnect();
      process.exit(1);
    }
    realmCatalogReady = false;
  }

  const { bootstrapWclAdmissionSnapshotRefresher } = await import(
    "./orchestration/refresh-admission/snapshot-refresher.js"
  );
  const { checkAdmissionSnapshotReadiness } = await import(
    "./orchestration/refresh-admission/snapshot-readiness.js"
  );

  const snapshotRefresher = await bootstrapWclAdmissionSnapshotRefresher({
    redis: admissionRedis,
    appEnv: env.APP_ENV,
    warcraftlogs: container.providers.warcraftlogs,
    logger: container.logger,
    intervalMs: Math.max(10_000, env.REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS * 500),
    maxAgeSeconds: env.REFRESH_WCL_SNAPSHOT_MAX_AGE_SECONDS,
    admissionMode: env.REFRESH_ADMISSION_MODE,
    wclEnabled: env.WCL_ENABLED,
    wclDisabledBySet: container.disabledProviders.has("warcraftlogs"),
  });

  const { startEvidenceExportRecoverySweeper } = await import(
    "./orchestration/scoring/evidence-export-recovery.js"
  );
  const evidenceExportRecoverySweeper = startEvidenceExportRecoverySweeper({
    prisma: container.prisma,
    logger: container.logger,
  });

  const enforceNeedsSnapshot = env.REFRESH_ADMISSION_MODE === "enforce" && env.WCL_ENABLED;
  const refresherUnavailable =
    enforceNeedsSnapshot &&
    (snapshotRefresher.reason === "capability_missing" ||
      snapshotRefresher.reason === "initial_refresh_failed" ||
      !snapshotRefresher.started);

  if (enforceNeedsSnapshot && refresherUnavailable) {
    container.logger.error(
      {
        event: "admission_snapshot_ready",
        readiness: "unavailable",
        reason: snapshotRefresher.reason,
      },
      "admission snapshot refresher unavailable — worker will not report ready",
    );
  }

  const producers = createQueueProducers(connection, container);
  const workers = createWorkers(connection, container);

  try {
    const { runScheduledScoringSeasonDataSync } = await import(
      "./orchestration/active-mplus-season/scoring-season-data-sync.js"
    );
    const { shouldRegisterAutomaticBackgroundSchedulers } = await import(
      "./scheduling/automatic-schedulers.js"
    );
    const seasonSyncSchedule = await producers.registerScoringSeasonDataSyncSchedule();
    const relevantSchedule = await producers.registerRelevantCharacterDiscoverySchedule();
    const exportSchedule = await producers.registerProviderDataExportSchedule();
    const importSchedule = await producers.registerProviderDataImportSchedule();
    container.logger.info(
      {
        event: "automatic_scheduler_registration",
        appEnv: env.APP_ENV,
        providerDataRole: env.PROVIDER_DATA_ROLE,
        scoringSeasonDataSync: seasonSyncSchedule.registered,
        relevantCharacterDiscovery: relevantSchedule.registered,
        providerDataExport: exportSchedule.registered,
        providerDataImport: importSchedule.registered,
      },
      "automatic background scheduler registration complete",
    );
    // Startup sync is automatic provider refresh — only on deployed envs.
    if (shouldRegisterAutomaticBackgroundSchedulers(env.APP_ENV)) {
      await runScheduledScoringSeasonDataSync({
        prisma: container.prisma,
        logger: container.logger,
        warcraftlogs: container.providers.warcraftlogs,
        blizzard: container.providers.blizzard,
        providerMode: env.PROVIDER_MODE,
      });
    }
  } catch (error) {
    container.logger.warn(
      { err: error, event: "season_data_sync_failed" },
      "season base-data bootstrap failed — continuing worker startup",
    );
  }

  // `run()` resolves only once the worker is closed, so it must not be awaited here.
  for (const worker of workers) {
    void worker.run().catch((error) => {
      container.logger.error({ queue: worker.name, err: error }, "worker run loop crashed");
    });
  }

  let healthServer: Server | null = null;
  if (env.WORKER_HEALTH_PORT > 0) {
    healthServer = startHealthServer(env.WORKER_HEALTH_PORT, async () => {
      try {
        if (!realmCatalogReady && env.PROVIDER_MODE === "live") {
          return { ok: false, detail: "realm_catalog_not_ready" };
        }
        const pong = await connection.ping();
        if (pong !== "PONG") {
          return { ok: false, detail: "redis_ping_failed" };
        }
        await container.prisma.$queryRaw`SELECT 1`;

        const admissionReady = await checkAdmissionSnapshotReadiness({
          env,
          redis: admissionRedis,
          refresherUnavailable,
        });
        if (!admissionReady.ok) {
          return { ok: false, detail: admissionReady.detail };
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "readiness_check_failed",
        };
      }
    });
    container.logger.info({ port: env.WORKER_HEALTH_PORT }, "worker health server listening");
  }

  container.logger.info(
    {
      queues: Object.values(QUEUE_NAMES),
      status: refresherUnavailable ? "not_ready" : "ready",
      realmCatalogReady,
      admissionSnapshotRefresher: {
        started: snapshotRefresher.started,
        reason: snapshotRefresher.reason,
        hasInitialSnapshot: snapshotRefresher.initialSnapshot != null,
      },
      config: getConfigSummary(env),
    },
    refresherUnavailable
      ? "worker started — admission snapshot not ready (enforce+WCL)"
      : "worker started",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info({ signal }, "worker shutting down");
    if (healthServer) {
      await new Promise<void>((resolve) => healthServer!.close(() => resolve()));
    }
    // Stop background sweepers before closing Redis / workers.
    evidenceExportRecoverySweeper.stop();
    await snapshotRefresher.stop();
    await closeWorkers(workers);
    await producers.close();
    try {
      await admissionRedis.quit();
    } catch {
      /* ignore */
    }
    await connection.quit();
    await container.prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
