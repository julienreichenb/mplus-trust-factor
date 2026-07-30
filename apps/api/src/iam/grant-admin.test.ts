import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@mplus/database";
import { createTestPrismaClient } from "../test-helpers.js";
import { grantAdminRole } from "./grant-admin.js";
import { ensureIamSeed } from "./seed.js";
import { BATTLENET_PROVIDER, ROLE_KEYS } from "./permissions.js";
import { resolveOwnershipSyncRegion } from "./auth-service.js";
import { buildTestEnv } from "../test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("grantAdminRole bootstrap", () => {
  it("promotes by user-id and is idempotent + audited", async () => {
    await ensureIamSeed(prisma as PrismaClient);
    const subject = `bnet-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: BATTLENET_PROVIDER,
        externalSubject: subject,
        displayName: "Bootstrap Admin",
        role: "USER",
        externalIdentities: {
          create: {
            id: randomUUID(),
            provider: BATTLENET_PROVIDER,
            subject,
            displayName: "Bootstrap#0001",
          },
        },
        battleNetAccounts: {
          create: {
            id: randomUUID(),
            providerAccountId: subject,
            battletagHash: "hash",
            battletagDisplay: "Bootstrap#0001",
          },
        },
      },
    });

    const first = await grantAdminRole(
      prisma as PrismaClient,
      { kind: "userId", userId: user.id },
      { sessionSecret: "test-session-secret-at-least-32-chars", actorLabel: "test" },
    );
    expect(first.alreadyAdmin).toBe(false);
    expect(first.userId).toBe(user.id);
    expect(first.battlenetSubject).toBe(subject);

    const second = await grantAdminRole(
      prisma as PrismaClient,
      { kind: "battlenetSubject", subject },
      { sessionSecret: "test-session-secret-at-least-32-chars", actorLabel: "test" },
    );
    expect(second.alreadyAdmin).toBe(true);

    const adminRole = await prisma.role.findUnique({ where: { key: ROLE_KEYS.ADMIN } });
    const assignment = await prisma.userRoleAssignment.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: adminRole!.id } },
    });
    expect(assignment).toBeTruthy();

    const audits = await prisma.auditEvent.findMany({
      where: { userId: user.id, action: { in: ["iam.grant_admin", "iam.grant_admin.idempotent"] } },
    });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("fails when identity does not exist", async () => {
    await expect(
      grantAdminRole(
        prisma as PrismaClient,
        { kind: "userId", userId: randomUUID() },
        { sessionSecret: "test-session-secret-at-least-32-chars" },
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });

    await expect(
      grantAdminRole(
        prisma as PrismaClient,
        { kind: "battlenetSubject", subject: `missing-${randomUUID()}` },
        { sessionSecret: "test-session-secret-at-least-32-chars" },
      ),
    ).rejects.toMatchObject({ code: "BNET_SUBJECT_NOT_FOUND" });
  });

  it("startup bootstrap fails visibly for missing target", async () => {
    const { runAdminBootstrap } = await import("./bootstrap-admin.js");
    const env = buildTestEnv({
      ADMIN_BOOTSTRAP_BATTLENET_SUBJECT: `missing-bootstrap-${randomUUID()}`,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "false",
      APP_ENV: "development",
    });
    await expect(runAdminBootstrap(prisma as PrismaClient, env)).rejects.toMatchObject({
      code: "BNET_SUBJECT_NOT_FOUND",
    });
  });
});

describe("ownership sync region MVP", () => {
  it("accepts EU only and rejects other regions", () => {
    expect(resolveOwnershipSyncRegion(buildTestEnv({ BATTLENET_OWNERSHIP_SYNC_REGION: "eu" }))).toBe(
      "eu",
    );
    expect(() =>
      resolveOwnershipSyncRegion(buildTestEnv({ BATTLENET_OWNERSHIP_SYNC_REGION: "us" })),
    ).toThrow(/EU only/i);
  });
});
