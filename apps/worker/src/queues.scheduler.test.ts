import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerContainer } from "./container.js";
import {
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

function containerFor(appEnv: "development" | "staging" | "production"): WorkerContainer {
  return {
    env: { APP_ENV: appEnv },
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

describe("automatic scheduler registration by APP_ENV", () => {
  beforeEach(() => {
    queueInstances.length = 0;
    vi.clearAllMocks();
  });

  it("APP_ENV=development does not register nightly scoring sync, discovery, or drain", async () => {
    const producers = createQueueProducers({} as never, containerFor("development"));
    const season = await producers.registerScoringSeasonDataSyncSchedule();
    const relevant = await producers.registerRelevantCharacterDiscoverySchedule();
    expect(season).toEqual({ registered: false });
    expect(relevant).toEqual({ registered: false });

    const syncQ = queueNamed(QUEUE_NAMES.scoringSeasonDataSync);
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(syncQ?.upsertJobScheduler).not.toHaveBeenCalled();
    expect(relQ?.upsertJobScheduler).not.toHaveBeenCalled();
    expect(syncQ?.removeJobScheduler).toHaveBeenCalledWith(SCORING_SEASON_DATA_SYNC_SCHEDULER_ID);
    await producers.close();
  });

  it("APP_ENV=staging registers nightly 03:00 UTC scoring sync plus discovery/drain", async () => {
    const producers = createQueueProducers({} as never, containerFor("staging"));
    const season = await producers.registerScoringSeasonDataSyncSchedule();
    const relevant = await producers.registerRelevantCharacterDiscoverySchedule();
    expect(season).toEqual({ registered: true });
    expect(relevant).toEqual({ registered: true });

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
    await producers.close();
  });

  it("APP_ENV=production registers the same automatic schedulers as staging", async () => {
    const producers = createQueueProducers({} as never, containerFor("production"));
    expect(await producers.registerScoringSeasonDataSyncSchedule()).toEqual({ registered: true });
    expect(await producers.registerRelevantCharacterDiscoverySchedule()).toEqual({
      registered: true,
    });
    await producers.close();
  });

  it("manual enqueue paths remain callable in development", async () => {
    const producers = createQueueProducers({} as never, containerFor("development"));
    const sync = await producers.enqueueScoringSeasonDataSync({ trigger: "admin" });
    expect(sync.enqueued).toBe(true);
    const discovery = await producers.enqueueRelevantCharacterDiscovery({
      mode: "daily_discovery",
      regionCode: "EU",
    });
    expect(discovery.enqueued).toBe(true);
    const drain = await producers.enqueueRelevantCharacterDiscovery({
      mode: "drain_feed",
      regionCode: "EU",
    });
    expect(drain.enqueued).toBe(true);

    const syncQ = queueNamed(QUEUE_NAMES.scoringSeasonDataSync);
    const relQ = queueNamed(QUEUE_NAMES.relevantCharacterDiscovery);
    expect(syncQ?.add).toHaveBeenCalled();
    expect(relQ?.add).toHaveBeenCalledTimes(2);
    await producers.close();
  });
});
