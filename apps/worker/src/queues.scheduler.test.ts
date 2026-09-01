import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContainer } from "./container.js";
import {
  PROVIDER_DATA_EXPORT_SCHEDULER_ID,
  PROVIDER_DATA_IMPORT_SCHEDULER_ID,
  SCORING_SEASON_DATA_SYNC_CRON_PATTERN,
  SCORING_SEASON_DATA_SYNC_CRON_TZ,
  SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
} from "./scheduling/automatic-schedulers.js";

const queueInstances: Array<{
  name: string;
  upsertJobScheduler: ReturnType<typeof vi.fn>;
  removeJobScheduler: ReturnType<typeof vi.fn>;
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string) => {
    const instance = {
      name,
      upsertJobScheduler: vi.fn(async () => undefined),
      removeJobScheduler: vi.fn(async () => undefined),
      add: vi.fn(async (_n: string, data: unknown) => ({ id: `job-${name}`, data })),
      close: vi.fn(async () => undefined),
    };
    queueInstances.push(instance);
    return instance;
  }),
}));

vi.mock("./orchestration/enqueue.js", () => ({
  persistAndEnqueue: vi.fn(),
}));

import { createQueueProducers } from "./queues.js";
import { QUEUE_NAMES } from "@mplus/contracts";
import { relevantCharacterDiscoveryDedupeKey } from "./dedupe.js";

function containerFor(
  appEnv: "development" | "staging" | "production",
  providerDataRole: "collector" | "consumer" = "collector",
): WorkerContainer {
  return {
    env: { APP_ENV: appEnv, PROVIDER_DATA_ROLE: providerDataRole, PROVIDER_DATA_DIR: "/tmp/pd" },
    prisma: {
      region: {
        findMany: vi.fn(async () => [
          { code: "EU" },
          { code: "US" },
          { code: "KR" },
          { code: "TW" },
        ]),
      },
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    repositories: { job: {} },
  } as unknown as WorkerContainer;
}

function queueNamed(name: string) {
  return queueInstances.find((q) => q.name === name);
}

describe("automatic scheduler registration by APP_ENV + PROVIDER_DATA_ROLE", () => {
  beforeEach(() => {
    queueInstances.length = 0;
    vi.clearAllMocks();
  });

  it("APP_ENV=development does not register nightly scoring sync, discovery, drain, or corpus jobs", async () => {
    const producers = createQueueProducers({} as never, containerFor("development", "collector"));
    const season = await producers.registerScoringSeasonDataSyncSchedule();
    const relevant = await producers.registerRelevantCharacterDiscoverySchedule();
    const exp = await producers.registerProviderDataExportSchedule();
    const imp = await producers.registerProviderDataImportSchedule();
    expect(season).toEqual({ registered: false });
    expect(relevant).toEqual({ registered: false });
    expect(exp).toEqual({ registered: false });
    expect(imp).toEqual({ registered: false });

    const syncQ = queueNamed(QUEUE_NAMES.scoringSeasonDataSync);
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(syncQ?.upsertJobScheduler).not.toHaveBeenCalled();
    expect(relQ?.upsertJobScheduler).not.toHaveBeenCalled();
    expect(syncQ?.removeJobScheduler).toHaveBeenCalledWith(SCORING_SEASON_DATA_SYNC_SCHEDULER_ID);
    await producers.close();
  });

  it("APP_ENV=staging + collector registers scoring sync, discovery/drain, and export", async () => {
    const producers = createQueueProducers({} as never, containerFor("staging", "collector"));
    expect(await producers.registerScoringSeasonDataSyncSchedule()).toEqual({ registered: true });
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: true,
    });
    expect(await producers.registerProviderDataExportSchedule()).toEqual({ registered: true });
    expect(await producers.registerProviderDataImportSchedule()).toEqual({ registered: false });

    const syncQ = queueNamed(QUEUE_NAMES.scoringSeasonDataSync);
    expect(syncQ?.upsertJobScheduler).toHaveBeenCalledWith(
      SCORING_SEASON_DATA_SYNC_SCHEDULER_ID,
      { pattern: SCORING_SEASON_DATA_SYNC_CRON_PATTERN, tz: SCORING_SEASON_DATA_SYNC_CRON_TZ },
      expect.objectContaining({
        name: QUEUE_NAMES.scoringSeasonDataSync,
        data: expect.objectContaining({ trigger: "schedule" }),
      }),
    );

    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(relQ?.upsertJobScheduler).toHaveBeenCalled();
    const modes = relQ?.upsertJobScheduler.mock.calls.map(
      (call) => (call[2] as { data: { mode: string } }).data.mode,
    );
    expect(modes).toContain("daily_discovery");
    expect(modes).toContain("drain_feed");

    const exportQ = queueNamed(QUEUE_NAMES.providerDataExport);
    expect(exportQ?.upsertJobScheduler).toHaveBeenCalledWith(
      PROVIDER_DATA_EXPORT_SCHEDULER_ID,
      expect.anything(),
      expect.anything(),
    );
    await producers.close();
  });

  it("APP_ENV=staging + consumer registers scoring sync + import but not discovery/drain/export", async () => {
    const producers = createQueueProducers({} as never, containerFor("staging", "consumer"));
    expect(await producers.registerScoringSeasonDataSyncSchedule()).toEqual({ registered: true });
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: false,
    });
    expect(await producers.registerProviderDataExportSchedule()).toEqual({ registered: false });
    expect(await producers.registerProviderDataImportSchedule()).toEqual({ registered: true });

    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(relQ?.upsertJobScheduler).not.toHaveBeenCalled();
    expect(relQ?.removeJobScheduler).toHaveBeenCalled();

    const importQ = queueNamed(QUEUE_NAMES.providerDataImport);
    expect(importQ?.upsertJobScheduler).toHaveBeenCalledWith(
      PROVIDER_DATA_IMPORT_SCHEDULER_ID,
      expect.anything(),
      expect.anything(),
    );
    await producers.close();
  });

  it("APP_ENV=production + collector mirrors staging collector expensive schedules", async () => {
    const producers = createQueueProducers({} as never, containerFor("production", "collector"));
    expect(await producers.registerScoringSeasonDataSyncSchedule()).toEqual({ registered: true });
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: true,
    });
    expect(await producers.registerProviderDataExportSchedule()).toEqual({ registered: true });
    await producers.close();
  });

  it("APP_ENV=staging + collector clears then registers discovery when regions exist", async () => {
    const producers = createQueueProducers({} as never, containerFor("staging", "collector"));
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: true,
    });
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    // removeRegionSchedulers runs before upsert (legacy + 4 regions × 2).
    expect(relQ?.removeJobScheduler.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(relQ?.upsertJobScheduler).toHaveBeenCalled();
    await producers.close();
  });

  it("APP_ENV=staging + collector with no enabled regions removes stale discovery schedulers", async () => {
    const container = containerFor("staging", "collector");
    (container.prisma.region.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const producers = createQueueProducers({} as never, container);
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: false,
    });
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(relQ?.removeJobScheduler).toHaveBeenCalled();
    expect(relQ?.upsertJobScheduler).not.toHaveBeenCalled();
    await producers.close();
  });

  it("manual enqueue paths remain callable in development", async () => {
    const producers = createQueueProducers({} as never, containerFor("development", "consumer"));
    const sync = await producers.enqueueScoringSeasonDataSync({ trigger: "admin" });
    expect(sync.enqueued).toBe(true);
    const discovery = await producers.enqueueRelevantCharacterDiscovery({
      mode: "daily_discovery",
      regionCode: "EU",
      trigger: "admin",
      requestedAt: "2026-08-31T12:00:00.000Z",
    });
    expect(discovery.enqueued).toBe(true);
    const drain = await producers.enqueueRelevantCharacterDiscovery({
      mode: "drain_feed",
      regionCode: "EU",
      trigger: "admin",
      requestedAt: "2026-08-31T12:05:00.000Z",
    });
    expect(drain.enqueued).toBe(true);

    const syncQ = queueNamed(QUEUE_NAMES.scoringSeasonDataSync);
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(syncQ?.add).toHaveBeenCalled();
    expect(relQ?.add).toHaveBeenCalledTimes(2);
    await producers.close();
  });

  it("manual relevant discovery enqueue does not pass colon-containing BullMQ jobId", async () => {
    const producers = createQueueProducers({} as never, containerFor("development", "consumer"));
    const requestedAt = "2026-08-31T12:00:00.000Z";
    const discovery = await producers.enqueueRelevantCharacterDiscovery({
      mode: "daily_discovery",
      regionCode: "EU",
      trigger: "admin",
      requestedAt,
    });
    const drain = await producers.enqueueRelevantCharacterDiscovery({
      mode: "drain_feed",
      regionCode: "US",
      trigger: "admin",
      requestedAt: "2026-08-31T12:05:00.000Z",
    });

    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(relQ?.add).toHaveBeenCalledTimes(2);

    const discoveryCall = relQ?.add.mock.calls[0];
    const drainCall = relQ?.add.mock.calls[1];
    expect(discoveryCall?.[2]).toBeUndefined();
    expect(drainCall?.[2]).toBeUndefined();

    const discoveryPayload = discoveryCall?.[1] as {
      mode: string;
      regionCode: string;
      trigger: string;
      requestedAt: string;
    };
    const drainPayload = drainCall?.[1] as {
      mode: string;
      regionCode: string;
      trigger: string;
      requestedAt: string;
    };
    expect(discoveryPayload).toEqual({
      mode: "daily_discovery",
      regionCode: "EU",
      trigger: "admin",
      requestedAt,
    });
    expect(drainPayload).toEqual({
      mode: "drain_feed",
      regionCode: "US",
      trigger: "admin",
      requestedAt: "2026-08-31T12:05:00.000Z",
    });

    const expectedDiscoveryDedupeKey = relevantCharacterDiscoveryDedupeKey(discoveryPayload);
    const expectedDrainDedupeKey = relevantCharacterDiscoveryDedupeKey(drainPayload);
    expect(expectedDiscoveryDedupeKey.length).toBeGreaterThan(0);
    expect(expectedDrainDedupeKey.length).toBeGreaterThan(0);

    expect(discovery).toEqual({
      jobId: `job-${QUEUE_NAMES.relevantCharacterDiscovery}`,
      dedupeKey: expectedDiscoveryDedupeKey,
      reused: false,
      enqueued: true,
    });
    expect(drain).toEqual({
      jobId: `job-${QUEUE_NAMES.relevantCharacterDiscovery}`,
      dedupeKey: expectedDrainDedupeKey,
      reused: false,
      enqueued: true,
    });
    expect(discovery.jobId).not.toContain(":");
    expect(drain.jobId).not.toContain(":");

    await producers.close();
  });
});
