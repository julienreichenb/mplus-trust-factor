/**
 * Redis integration: capability package source-fight singleflight.
 * Fail hard when Redis is unavailable — do NOT skip.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import {
  capabilityPackageSingleflightKey,
  createRedisSourceFightLock,
} from "../run-orchestration/source-fight-lease.js";
import {
  createMemoryOrchestrationPorts,
  buildMinimalCapabilityPackage,
} from "../run-orchestration/index.js";
import { wclConcurrencyKeyPrefix } from "../wcl-concurrency/permits.js";

const CONNECT_TIMEOUT_MS = 2_000;
const REDIS_URL = process.env.REDIS_URL;

async function probeRedis(url: string): Promise<Redis> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("redis connect timeout")), CONNECT_TIMEOUT_MS);
      }),
    ]);
    const pong = await client.ping();
    if (String(pong).toUpperCase() !== "PONG") throw new Error("unexpected ping");
    return client;
  } catch (err) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function redisUnavailableError(detail: string): Error {
  return new Error(
    `TEST INFRASTRUCTURE: Redis unavailable for capability singleflight (REDIS_URL=${REDIS_URL ?? "<missing>"}): ${detail}`,
  );
}

const runId = randomUUID().slice(0, 12);
const appEnv = `test:cap-sf-${runId}`;
let redis: Redis;

async function cleanup(): Promise<void> {
  const prefix = wclConcurrencyKeyPrefix(appEnv);
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
}

beforeAll(async () => {
  if (!REDIS_URL) throw redisUnavailableError("REDIS_URL missing");
  try {
    redis = await probeRedis(REDIS_URL);
  } catch (err) {
    throw redisUnavailableError(err instanceof Error ? err.message : String(err));
  }
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await redis.quit();
});

describe("capability package Redis singleflight", () => {
  it("owner acquires once; waiter reuses persisted package without second WCL", async () => {
    const ports = createMemoryOrchestrationPorts({ providerCallsPerAcquire: 1 });
    const fight = { reportCode: "sf1", fightId: 7, reportRevision: 1 };

    const lock = createRedisSourceFightLock({
      redis,
      appEnv,
      findCompatiblePackage: (input) =>
        ports.findCompatibleCapabilityPackage(input),
      waitTimeoutMs: 10_000,
      pollIntervalMs: 50,
      leaseMs: 5_000,
    });
    ports.withSourceFightLock = lock;

    let liveCalls = 0;
    const work = async () => {
      const existing = await ports.findCompatibleCapabilityPackage({
        sourceFight: fight,
      });
      if (existing) return existing;
      liveCalls += 1;
      return ports.acquireAndPersistCapabilityPackage({
        sourceFight: fight,
        dungeonSlug: "skyreach",
        keyLevel: 16,
        participants: [
          {
            playerActorId: 1,
            characterName: "Target",
            classSlug: "mage",
            specSlug: "fire",
            ownedPetActorIds: [],
            characterId: "11111111-1111-4111-8111-111111111111",
          },
        ],
      });
    };

    const [a, b] = await Promise.all([
      ports.withSourceFightLock(fight, work),
      ports.withSourceFightLock(fight, work),
    ]);

    expect(liveCalls).toBe(1);
    expect(a.contentHash).toBe(b.contentHash);
    expect(ports.getPackageCount()).toBe(1);
    expect(
      capabilityPackageSingleflightKey(appEnv, { sourceFight: fight }),
    ).toContain("sf-cap-pkg");
  });

  it("expired lease is not proof of absence — DB hit short-circuits", async () => {
    const ports = createMemoryOrchestrationPorts();
    const fight = { reportCode: "sf2", fightId: 3, reportRevision: 2 };
    const pkg = buildMinimalCapabilityPackage({
      sourceFight: fight,
      participants: [
        {
          playerActorId: 1,
          characterName: "Target",
          classSlug: "mage",
          specSlug: "fire",
          ownedPetActorIds: [],
          characterId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    ports.seedPackage({
      package: pkg,
      packageArtifactId: "already",
      contentHash: pkg.contentHash,
      providerCalls: 0,
    });

    const lock = createRedisSourceFightLock({
      redis,
      appEnv,
      findCompatiblePackage: (input) =>
        ports.findCompatibleCapabilityPackage(input),
    });

    let entered = 0;
    await lock(fight, async () => {
      entered += 1;
      return "ok";
    });
    expect(entered).toBe(1);
    expect(ports.stats.acquireCalls).toBe(0);
  });
});
