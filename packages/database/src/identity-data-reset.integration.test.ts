/**
 * Disposable-DB integration tests for identity-data reset.
 * Never targets mplus_trust, deployed-test, or production.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "./index.js";
import type { IdentityResetGuardOk } from "./reset/identity-data-reset-guard.js";
import {
  buildIdentityDataResetPlan,
  executeIdentityDataReset,
  type ExtendedRedisScanner,
} from "./reset/identity-data-reset.js";
import { IDENTITY_RESET_ADMIN_ROLE_KEY } from "./reset/identity-data-reset-table-plan.js";
import { IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN } from "./reset/identity-data-reset-guard.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping identity-data reset integration tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function idleRedis(): ExtendedRedisScanner {
  const store = new Map<string, string>();
  return {
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, "");
      return [...store.keys()].filter((k) => k.startsWith(prefix) || pattern === "bull:*");
    }),
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n += 1;
      }
      return n;
    }),
    llen: vi.fn(async () => 0),
    exists: vi.fn(async () => 0),
    set: vi.fn(async (key, value, _mode, _ttl, nx) => {
      if (nx === "NX" && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key) => store.get(key) ?? null),
    eval: vi.fn(async (_script, _n, key, token) => {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
    quit: vi.fn(async () => undefined),
  };
}

function oauthFingerprint(row: {
  providerAccountId: string;
  regionId: string | null;
  battletagHash: string;
  battletagDisplay: string | null;
  claimed: boolean;
  linkedAt: Date;
  unlinkedAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  grantedScopes: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        providerAccountId: row.providerAccountId,
        regionId: row.regionId,
        battletagHash: row.battletagHash,
        battletagDisplay: row.battletagDisplay,
        claimed: row.claimed,
        linkedAt: row.linkedAt.toISOString(),
        unlinkedAt: row.unlinkedAt?.toISOString() ?? null,
        accessTokenEncrypted: row.accessTokenEncrypted,
        refreshTokenEncrypted: row.refreshTokenEncrypted,
        tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
        grantedScopes: row.grantedScopes,
      }),
    )
    .digest("hex");
}

describe.runIf(dbAvailable)("identity-data reset integration", { timeout: 60_000 }, () => {
  let keepUserId: string;
  let keepBnetId: string;
  let otherUserId: string;
  let artifactsDir: string;
  let regionId: string;
  let realmId: string;
  let realmsBefore: number;
  let regionsBefore: number;
  let oauthBefore: string;

  beforeAll(async () => {
    artifactsDir = await mkdtemp(path.join(tmpdir(), "mplus-id-reset-"));
    await mkdir(path.join(artifactsDir, "cas"), { recursive: true });
    await writeFile(path.join(artifactsDir, "cas", "dummy.bin"), "artifact");

    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: {
        code: "EU",
        apiHost: "https://eu.api.blizzard.com",
        localeDefault: "en_GB",
        enabled: true,
      },
    });
    regionId = region.id;

    let realm = await prisma.realm.findFirst({
      where: { regionId: region.id, slug: "id-reset-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "id-reset-realm",
          name: "Id Reset Realm",
          timezone: "Europe/Paris",
          locale: "en_GB",
          connectedRealmId: BigInt(999001),
          category: "NORMAL",
        },
      });
    }
    realmId = realm.id;

    const adminRole = await prisma.role.upsert({
      where: { key: IDENTITY_RESET_ADMIN_ROLE_KEY },
      update: {},
      create: {
        id: randomUUID(),
        key: IDENTITY_RESET_ADMIN_ROLE_KEY,
        name: "Administrator",
        description: "test admin",
      },
    });

    keepUserId = randomUUID();
    keepBnetId = randomUUID();
    otherUserId = randomUUID();

    await prisma.user.create({
      data: {
        id: keepUserId,
        authProvider: "battlenet",
        externalSubject: `keep-${keepUserId}`,
        displayName: "Keep Admin",
        role: "ADMIN",
        externalIdentities: {
          create: {
            id: randomUUID(),
            provider: "battlenet",
            subject: `keep-${keepUserId}`,
            displayName: "Keep#1234",
          },
        },
        sessions: {
          create: {
            id: randomUUID(),
            tokenHash: `hash-keep-${keepUserId}`,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        },
        roleAssignments: {
          create: {
            id: randomUUID(),
            roleId: adminRole.id,
          },
        },
        battleNetAccounts: {
          create: {
            id: keepBnetId,
            providerAccountId: `bnet-keep-${keepBnetId}`,
            regionId,
            battletagHash: `hash-keep-${keepBnetId}`,
            battletagDisplay: "Keep#1234",
            claimed: true,
            accessTokenEncrypted: "enc-access-KEEP",
            refreshTokenEncrypted: "enc-refresh-KEEP",
            tokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
            grantedScopes: "openid wow.profile",
            lastOwnershipSyncAt: new Date(),
            lastOwnershipSyncError: "stale-error",
            lastDiscoveryStatus: "DONE",
            lastDiscoveryCounters: { found: 2 },
          },
        },
      },
    });

    await prisma.user.create({
      data: {
        id: otherUserId,
        authProvider: "battlenet",
        externalSubject: `other-${otherUserId}`,
        displayName: "Other User",
        role: "USER",
        externalIdentities: {
          create: {
            id: randomUUID(),
            provider: "battlenet",
            subject: `other-${otherUserId}`,
          },
        },
        sessions: {
          create: {
            id: randomUUID(),
            tokenHash: `hash-other-${otherUserId}`,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        },
        battleNetAccounts: {
          create: {
            id: randomUUID(),
            providerAccountId: `bnet-other-${otherUserId}`,
            battletagHash: `hash-other-${otherUserId}`,
            claimed: true,
          },
        },
      },
    });

    // Second admin must not affect exact-ID preservation.
    const secondAdminId = randomUUID();
    await prisma.user.create({
      data: {
        id: secondAdminId,
        authProvider: "battlenet",
        externalSubject: `admin2-${secondAdminId}`,
        role: "ADMIN",
        battleNetAccounts: {
          create: {
            id: randomUUID(),
            providerAccountId: `bnet-admin2-${secondAdminId}`,
            battletagHash: `hash-admin2-${secondAdminId}`,
          },
        },
      },
    });

    const characterIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of characterIds.entries()) {
      await prisma.character.create({
        data: {
          id,
          regionId,
          realmId,
          displayName: `Char${i}`,
          normalizedName: `char${i}`,
        },
      });
      await prisma.characterAlias.create({
        data: {
          id: randomUUID(),
          characterId: id,
          regionId,
          realmSlug: "id-reset-realm",
          normalizedName: `char${i}`,
          sourceProvider: "BLIZZARD",
        },
      });
    }

    await prisma.verifiedCharacterOwnership.create({
      data: {
        id: randomUUID(),
        battleNetAccountId: keepBnetId,
        userId: keepUserId,
        characterId: characterIds[0],
        blizzardCharacterId: BigInt(1001),
        regionId,
        realmSlug: "id-reset-realm",
        characterName: "Char0",
        normalizedName: "char0",
        source: "test",
        verifiedAt: new Date(),
      },
    });

    const keepAccount = await prisma.battleNetAccount.findUniqueOrThrow({
      where: { id: keepBnetId },
    });
    oauthBefore = oauthFingerprint(keepAccount);

    realmsBefore = await prisma.realm.count();
    regionsBefore = await prisma.region.count();
  });

  function syntheticGate(): IdentityResetGuardOk {
    return {
      ok: true,
      target: "local-development",
      sanitizedDatabase: sanitizeDatabaseUrl(databaseUrl),
      sanitizedRedis: "redis://127.0.0.1:6379",
      artifactsDir,
      artifactsConfiguredDir: artifactsDir,
      configRoot: artifactsDir,
      artifactBackend: "local-fs",
      databaseName: "mplus_itest_fixture",
      databaseHost: "localhost",
      redisHost: "127.0.0.1",
      redisEnvSegment: "development",
      keepUserId,
      keepBnetAccountId: keepBnetId,
      confirmationToken: IDENTITY_RESET_LOCAL_CONFIRMATION_TOKEN,
      expectedDatabaseName: null,
      deployedTestClassification: "not-applicable (local-development)",
      writersStoppedAsserted: false,
    };
  }

  it("deletes all characters/users except retained identity; idempotent on repeat", async () => {
    const redis = idleRedis();
    const gate = syntheticGate();

    const plan = await buildIdentityDataResetPlan({
      prisma,
      gate,
      execute: true,
      redis,
    });
    expect(plan.blockedConditions).toEqual([]);
    expect(plan.retainedUser.id).toBe(keepUserId);
    expect(plan.mode).toBe("EXECUTE");

    const result = await executeIdentityDataReset({
      prisma,
      plan,
      redis,
      artifactsDir,
    });
    expect(result.postconditionFailures).toEqual([]);
    expect(result.externalCleanup.partial).toBe(false);
    expect(result.oauthFingerprintUnchanged).toBe(true);

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.battleNetAccount.count()).toBe(1);
    expect(await prisma.character.count()).toBe(0);
    expect(await prisma.characterAlias.count()).toBe(0);
    expect(await prisma.verifiedCharacterOwnership.count()).toBe(0);

    const soleUser = await prisma.user.findFirstOrThrow();
    expect(soleUser.id).toBe(keepUserId);
    expect(soleUser.role).toBe("ADMIN");
    expect(soleUser.disabledAt).toBeNull();

    const soleBnet = await prisma.battleNetAccount.findFirstOrThrow();
    expect(soleBnet.id).toBe(keepBnetId);
    expect(soleBnet.userId).toBe(keepUserId);
    expect(oauthFingerprint(soleBnet)).toBe(oauthBefore);
    expect(soleBnet.accessTokenEncrypted).toBe("enc-access-KEEP");
    expect(soleBnet.refreshTokenEncrypted).toBe("enc-refresh-KEEP");
    expect(soleBnet.lastOwnershipSyncAt).toBeNull();
    expect(soleBnet.lastOwnershipSyncError).toBeNull();
    expect(soleBnet.lastDiscoveryStatus).toBeNull();
    expect(soleBnet.lastDiscoveryCounters).toBeNull();

    expect(await prisma.externalIdentity.count({ where: { userId: keepUserId } })).toBe(1);
    expect(await prisma.userSession.count({ where: { userId: keepUserId } })).toBe(1);
    expect(await prisma.externalIdentity.count({ where: { userId: otherUserId } })).toBe(0);
    expect(await prisma.userSession.count({ where: { userId: otherUserId } })).toBe(0);

    expect(await prisma.realm.count()).toBe(realmsBefore);
    expect(await prisma.region.count()).toBe(regionsBefore);

    // Idempotent second execution — zero additional deletions.
    const plan2 = await buildIdentityDataResetPlan({
      prisma,
      gate,
      execute: true,
      redis,
    });
    expect(plan2.plannedSelectiveDeletes.find((t) => t.table === "users")?.deleteCount).toBe(0);
    expect(plan2.plannedTruncations.every((t) => t.rowCount === 0 || !["characters", "character_aliases", "verified_character_ownerships"].includes(t.table) || t.rowCount === 0)).toBe(true);
    expect(
      plan2.plannedTruncations
        .filter((t) =>
          ["characters", "character_aliases", "verified_character_ownerships"].includes(t.table),
        )
        .every((t) => t.rowCount === 0),
    ).toBe(true);

    const result2 = await executeIdentityDataReset({
      prisma,
      plan: plan2,
      redis,
      artifactsDir,
    });
    expect(result2.postconditionFailures).toEqual([]);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.battleNetAccount.count()).toBe(1);
    expect(oauthFingerprint(await prisma.battleNetAccount.findFirstOrThrow())).toBe(oauthBefore);
  });

  it("47. partial external cleanup returns non-zero-style partial flag", async () => {
    const redis = idleRedis();
    const gate = syntheticGate();
    const plan = await buildIdentityDataResetPlan({
      prisma,
      gate,
      execute: true,
      redis,
    });

    let cleanupPhase = false;
    const badRedis: ExtendedRedisScanner = {
      ...redis,
      llen: vi.fn(async () => 0),
      set: redis.set!,
      get: redis.get,
      eval: redis.eval,
      del: vi.fn(async (...keys: string[]) => {
        if (cleanupPhase) throw new Error("redis del failed");
        return redis.del(...keys);
      }),
      keys: vi.fn(async (pattern: string) => {
        if (cleanupPhase) throw new Error("redis scan failed");
        return redis.keys(pattern);
      }),
      quit: redis.quit,
    };

    // Force cleanup phase after lock acquisition by wrapping execute's redis cleanup path:
    // acquire lock + writer probe use keys/llen; then mark cleanup.
    const originalSet = badRedis.set!;
    badRedis.set = vi.fn(async (...args: Parameters<NonNullable<ExtendedRedisScanner["set"]>>) => {
      const result = await originalSet(...args);
      cleanupPhase = true;
      return result;
    });

    const result = await executeIdentityDataReset({
      prisma,
      plan,
      redis: badRedis,
      artifactsDir,
    });
    expect(result.externalCleanup.partial).toBe(true);
    expect(result.externalCleanup.redis.ok).toBe(false);
  });
});
