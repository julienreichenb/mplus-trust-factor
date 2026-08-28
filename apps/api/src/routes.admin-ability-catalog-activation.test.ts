/**
 * Phase 3B.5 — activate/rollback route auth (publish permission).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";
import { ensureIamSeed } from "./iam/seed.js";
import { BATTLENET_PROVIDER } from "./iam/permissions.js";
import { PERMISSIONS } from "./iam/permissions.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key";
const BOOTSTRAP_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";
const BOOTSTRAP_DIGEST =
  "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761";

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("admin ability-catalog activation RBAC", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;

  beforeAll(async () => {
    const env = buildTestEnv({
      ADMIN_API_KEY: ADMIN_KEY,
      ADMIN_API_KEY_EMERGENCY_FALLBACK: "true",
    });
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

  it("provisions publish permission key", () => {
    expect(PERMISSIONS.ADMIN_ABILITY_CATALOG_PUBLISH).toBe("admin.ability_catalog.publish");
  });

  it("rejects anonymous activate with 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/ability-catalog/releases/${BOOTSTRAP_ID}/activate`,
      payload: { confirmationDigest: BOOTSTRAP_DIGEST, confirm: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects authenticated user without publish permission with 403", async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: BATTLENET_PROVIDER,
        externalSubject: `subj-no-publish-${randomUUID()}`,
        displayName: "NoPublish",
        role: "USER",
        externalIdentities: {
          create: {
            id: randomUUID(),
            provider: BATTLENET_PROVIDER,
            subject: `subj-no-publish-${randomUUID()}`,
            displayName: "NoPublish#1",
          },
        },
      },
    });
    const token = await container.authService.createSession({ userId: user.id });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/ability-catalog/releases/${BOOTSTRAP_ID}/activate`,
      headers: { cookie: `mplus_session=${token}` },
      payload: { confirmationDigest: BOOTSTRAP_DIGEST, confirm: true },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("allows emergency admin key to hit activate route (may fail business gates)", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/ability-catalog/releases/${BOOTSTRAP_ID}/activate`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: {
        confirmationDigest: BOOTSTRAP_DIGEST,
        confirm: true,
        expectedPreviousActiveId: null,
      },
    });
    // Auth passed: either activated (200) or business conflict/validation (4xx ≠ 401/403).
    expect([200, 400, 404, 409]).toContain(response.statusCode);
    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
  });
});
