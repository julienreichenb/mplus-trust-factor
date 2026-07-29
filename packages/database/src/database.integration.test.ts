import { describe, expect, it, beforeAll } from "vitest";
import { createPrismaClient, checkDatabaseHealth } from "./index.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://mplus:mplus@localhost:5433/mplus_trust?schema=public";

describe("database integration", () => {
  const prisma = createPrismaClient(databaseUrl);

  beforeAll(async () => {
    const health = await checkDatabaseHealth(prisma);
    if (!health.ok) {
      throw new Error(
        `PostgreSQL is not reachable at ${databaseUrl}. Run pnpm dev:infra first. ${health.error ?? ""}`,
      );
    }
  });

  it("responds to health query", async () => {
    const health = await checkDatabaseHealth(prisma);
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("has EU region after seed", async () => {
    const region = await prisma.region.findUnique({ where: { code: "EU" } });
    expect(region).not.toBeNull();
    expect(region?.enabled).toBe(true);
  });

  it("has active default score model v5 after seed (older versions archived)", async () => {
    const v5 = await prisma.scoreModel.findUnique({
      where: { key_version: { key: "default", version: 5 } },
    });
    expect(v5).not.toBeNull();
    expect(v5?.status).toBe("ACTIVE");

    for (const version of [1, 2, 3, 4] as const) {
      const older = await prisma.scoreModel.findUnique({
        where: { key_version: { key: "default", version } },
      });
      expect(older).not.toBeNull();
      expect(older?.status).toBe("ARCHIVED");
    }
  });
});
