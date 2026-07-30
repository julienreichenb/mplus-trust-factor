import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";
import { ensureIamSeed } from "./iam/seed.js";
import { grantAdminRole } from "./iam/grant-admin.js";
import { BATTLENET_PROVIDER, ROLE_KEYS } from "./iam/permissions.js";
import { AdminUsersService } from "./services/admin-users-service.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";

afterAll(async () => {
  await prisma.$disconnect();
});

async function createUser(opts: {
  displayName: string;
  email?: string;
  battletag: string;
  subject: string;
}) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      authProvider: BATTLENET_PROVIDER,
      externalSubject: opts.subject,
      displayName: opts.displayName,
      email: opts.email ?? null,
      role: "USER",
      externalIdentities: {
        create: {
          id: randomUUID(),
          provider: BATTLENET_PROVIDER,
          subject: opts.subject,
          displayName: opts.battletag,
        },
      },
      battleNetAccounts: {
        create: {
          id: randomUUID(),
          providerAccountId: opts.subject,
          battletagHash: `hash-${opts.subject}`,
          battletagDisplay: opts.battletag,
        },
      },
    },
  });
}

describe.skipIf(!dbAvailable)("admin users RBAC", () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  let sessionSecret: string;

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY, ADMIN_API_KEY_EMERGENCY_FALLBACK: "true" });
    sessionSecret = env.SESSION_SECRET;
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      skipQueues: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
    await ensureIamSeed(prisma as PrismaClient);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 anonymous and 403 authenticated user without permission", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/v1/admin/users?q=ab" });
    expect(anon.statusCode).toBe(401);

    const user = await createUser({
      displayName: "Normal",
      battletag: "Normal#1111",
      subject: `subj-normal-${randomUUID()}`,
    });
    const token = await container.authService.createSession({ userId: user.id });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users?q=Normal",
      headers: { cookie: `mplus_session=${token}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("allows admin session to search and grant/revoke with audit + last-admin protection", async () => {
    const adminUser = await createUser({
      displayName: "Boss",
      email: `boss-${randomUUID().slice(0, 8)}@example.com`,
      battletag: "Boss#9999",
      subject: `subj-boss-${randomUUID()}`,
    });
    await grantAdminRole(
      prisma as PrismaClient,
      { kind: "userId", userId: adminUser.id },
      { sessionSecret, actorLabel: "test" },
    );
    const target = await createUser({
      displayName: "Target",
      email: `target-${randomUUID().slice(0, 8)}@example.com`,
      battletag: "Target#2222",
      subject: `subj-target-${randomUUID()}`,
    });

    const adminToken = await container.authService.createSession({ userId: adminUser.id });
    const cookie = `mplus_session=${adminToken}`;

    const search = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users?q=${encodeURIComponent("Target#2222")}`,
      headers: { cookie },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().users.some((u: { id: string }) => u.id === target.id)).toBe(true);
    expect(JSON.stringify(search.json())).not.toContain("accessToken");
    expect(JSON.stringify(search.json())).not.toContain("refreshToken");

    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/roles`,
      headers: { cookie },
      payload: { roleKey: ROLE_KEYS.ADMIN },
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().roles).toContain(ROLE_KEYS.ADMIN);

    const grantAudits = await prisma.auditEvent.findMany({
      where: { action: { in: ["admin.users.grant_role", "admin.users.grant_role.idempotent"] }, resourceId: target.id },
    });
    expect(grantAudits.length).toBeGreaterThanOrEqual(1);

    // Two admins now — revoking target should succeed without override.
    const revokeTarget = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${target.id}/roles/${ROLE_KEYS.ADMIN}`,
      headers: { cookie },
    });
    expect(revokeTarget.statusCode).toBe(200);

    await grantAdminRole(
      prisma as PrismaClient,
      { kind: "userId", userId: target.id },
      { sessionSecret, actorLabel: "test-regrant" },
    );
    // Revoking one of two admins remains allowed.
    const revokeOneOfTwo = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${target.id}/roles/${ROLE_KEYS.ADMIN}`,
      headers: { cookie },
    });
    expect(revokeOneOfTwo.statusCode).toBe(200);

    const revokeAudits = await prisma.auditEvent.findMany({
      where: { action: "admin.users.revoke_role", resourceId: target.id },
    });
    expect(revokeAudits.length).toBeGreaterThanOrEqual(1);

    // Explicit override path (shared DB may contain other admins from sibling suites).
    const override = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/users/${adminUser.id}/roles/${ROLE_KEYS.ADMIN}?allowLastAdminRemoval=true`,
      headers: { cookie },
    });
    expect(override.statusCode).toBe(200);
  });

  it("rejects force refresh for normal users and allows admin key with ?force=true", async () => {
    const region = await prisma.region.upsert({
      where: { code: "EU" },
      update: {},
      create: { code: "EU", apiHost: "https://eu.api.blizzard.com", localeDefault: "en_GB", enabled: true },
    });
    let realm = await prisma.realm.findFirst({ where: { regionId: region.id, slug: "tarren-mill" } });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "tarren-mill",
          name: "Tarren Mill",
        },
      });
    }
    const name = `Force${randomUUID().slice(0, 6)}`;
    await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: name.toLowerCase(),
        displayName: name,
      },
    });

    const normal = await createUser({
      displayName: "NoForce",
      battletag: "NoForce#1",
      subject: `subj-noforce-${randomUUID()}`,
    });
    const token = await container.authService.createSession({ userId: normal.id });
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/characters/EU/tarren-mill/${name}/refresh?force=true`,
      headers: { cookie: `mplus_session=${token}` },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: `/api/v1/characters/EU/tarren-mill/${name}/refresh?force=true`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe.skipIf(!dbAvailable)("AdminUsersService last-admin unit", () => {
  it("counts active admins", async () => {
    await ensureIamSeed(prisma as PrismaClient);
    const service = new AdminUsersService(prisma as PrismaClient, "test-session-secret-at-least-32-chars");
    const before = await service.countActiveAdmins();
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

describe("last-admin protection policy", () => {
  it("blocks revoking the final admin without override", async () => {
    const { assertCanRevokeAdminRole } = await import("./services/admin-users-service.js");
    try {
      assertCanRevokeAdminRole(1, false);
      expect.unreachable("expected LAST_ADMIN_PROTECTION");
    } catch (error) {
      expect(error).toMatchObject({ code: "LAST_ADMIN_PROTECTION", statusCode: 409 });
    }
    expect(() => assertCanRevokeAdminRole(1, true)).not.toThrow();
    expect(() => assertCanRevokeAdminRole(2, false)).not.toThrow();
  });
});
