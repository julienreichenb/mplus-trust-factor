import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  PRODUCTION_FAQ_ENTRIES,
  PRODUCTION_FAQ_IDS,
  seedProductionFaq,
  type PrismaClient,
} from "@mplus/database";
import { buildApp } from "./app.js";
import { createApiContainer, type ApiContainer } from "./container.js";
import { buildTestEnv, createTestPrismaClient } from "./test-helpers.js";

const { prisma, dbAvailable } = await createTestPrismaClient();
const ADMIN_KEY = "test-admin-key-faq";

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("FAQ routes", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const env = buildTestEnv({ ADMIN_API_KEY: ADMIN_KEY });
    container = createApiContainer(env, {
      workerOverrides: { prisma: prisma as PrismaClient },
      skipQueues: true,
    });
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    const ids = [...createdIds, ...PRODUCTION_FAQ_IDS];
    await prisma.faqEntry.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function adminCreate(payload: Record<string, unknown>) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/faq",
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload,
    });
    if (response.statusCode === 201) {
      createdIds.push(response.json().id);
    }
    return response;
  }

  it("returns only published entries on the public endpoint, ordered by position", async () => {
    const draft = await adminCreate({
      title: `Draft ${randomUUID().slice(0, 8)}`,
      description: "Hidden draft body",
      position: 1,
      isPublished: false,
    });
    const first = await adminCreate({
      title: `Published later ${randomUUID().slice(0, 8)}`,
      description: "Second publicly",
      position: 20,
      isPublished: true,
    });
    const second = await adminCreate({
      title: `Published first ${randomUUID().slice(0, 8)}`,
      description: "First publicly",
      position: 10,
      isPublished: true,
    });
    expect(draft.statusCode).toBe(201);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const publicResponse = await app.inject({ method: "GET", url: "/api/v1/faq" });
    expect(publicResponse.statusCode).toBe(200);
    const publicEntries = publicResponse.json().entries as Array<{
      id: string;
      isPublished?: unknown;
      createdAt?: unknown;
    }>;
    const publicIds = publicEntries.map((entry) => entry.id);
    expect(publicIds).toContain(second.json().id);
    expect(publicIds).toContain(first.json().id);
    expect(publicIds).not.toContain(draft.json().id);
    expect(publicIds.indexOf(second.json().id)).toBeLessThan(publicIds.indexOf(first.json().id));
    expect(publicEntries[0]).not.toHaveProperty("isPublished");
    expect(publicEntries[0]).not.toHaveProperty("createdAt");

    const adminResponse = await app.inject({
      method: "GET",
      url: "/api/v1/admin/faq",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(adminResponse.statusCode).toBe(200);
    const adminIds = (adminResponse.json().entries as Array<{ id: string }>).map((entry) => entry.id);
    expect(adminIds).toContain(draft.json().id);
  });

  it("persists create, update, publish, move, and delete", async () => {
    const created = await adminCreate({
      title: "Original title",
      description: "Original description",
      isPublished: false,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().title).toBe("Original title");
    expect(created.json().isPublished).toBe(false);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/faq/${id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { title: "  Updated title  ", isPublished: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().title).toBe("Updated title");
    expect(updated.json().isPublished).toBe(true);

    const unpublished = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/faq/${id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { isPublished: false },
    });
    expect(unpublished.json().isPublished).toBe(false);

    const neighbor = await adminCreate({
      title: "Neighbor",
      description: "Neighbor body",
      position: created.json().position + 10,
    });
    const moved = await app.inject({
      method: "POST",
      url: `/api/v1/admin/faq/${id}/move`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { direction: "down" },
    });
    expect(moved.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/faq",
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    const ids = (listed.json().entries as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids.indexOf(neighbor.json().id)).toBeLessThan(ids.indexOf(id));

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/faq/${id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
    });
    expect(deleted.statusCode).toBe(200);
    const gone = await prisma.faqEntry.findUnique({ where: { id } });
    expect(gone).toBeNull();
  });

  it("returns seeded production FAQs published and ordered by position", async () => {
    await prisma.faqEntry.deleteMany({ where: { id: { in: [...PRODUCTION_FAQ_IDS] } } });
    const report = await seedProductionFaq(prisma);
    expect(report.inserted).toBe(15);

    const publicResponse = await app.inject({ method: "GET", url: "/api/v1/faq" });
    expect(publicResponse.statusCode).toBe(200);
    const publicEntries = publicResponse.json().entries as Array<{
      id: string;
      title: string;
      embedType: string | null;
    }>;
    const seeded = publicEntries.filter((entry) => PRODUCTION_FAQ_IDS.includes(entry.id));
    expect(seeded).toHaveLength(15);
    expect(seeded.map((entry) => entry.id)).toEqual([...PRODUCTION_FAQ_IDS]);
    expect(seeded.map((entry) => entry.title)).toEqual(PRODUCTION_FAQ_ENTRIES.map((entry) => entry.title));
    expect(seeded.map((entry) => entry.embedType)).toEqual(PRODUCTION_FAQ_ENTRIES.map((entry) => entry.embedType));

    await prisma.faqEntry.deleteMany({ where: { id: { in: [...PRODUCTION_FAQ_IDS] } } });
  });

  it("persists embedType on create, public GET, and update", async () => {
    const created = await adminCreate({
      title: `Embed ${randomUUID().slice(0, 8)}`,
      description: "Has a score flow artifact",
      isPublished: true,
      embedType: "SCORE_FLOW",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().embedType).toBe("SCORE_FLOW");

    const publicResponse = await app.inject({ method: "GET", url: "/api/v1/faq" });
    const hit = (publicResponse.json().entries as Array<{ id: string; embedType: string | null }>).find(
      (entry) => entry.id === created.json().id,
    );
    expect(hit?.embedType).toBe("SCORE_FLOW");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/faq/${created.json().id}`,
      headers: { "x-admin-api-key": ADMIN_KEY },
      payload: { embedType: "META_TIER_TABLE" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().embedType).toBe("META_TIER_TABLE");

    const invalid = await adminCreate({
      title: "Bad embed",
      description: "Nope",
      embedType: "HTML_WIDGET",
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("rejects empty title and description", async () => {
    const response = await adminCreate({ title: "   ", description: "   " });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unauthorized mutations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/faq",
      payload: { title: "Nope", description: "Nope" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("allows admin.settings.manage via admin API key", async () => {
    const response = await adminCreate({
      title: "Authorized create",
      description: "Created with settings.manage",
    });
    expect(response.statusCode).toBe(201);
  });
});
