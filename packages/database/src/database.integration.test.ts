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

  it("has active default score model v2 after seed (v1 archived)", async () => {
    const v2 = await prisma.scoreModel.findUnique({
      where: { key_version: { key: "default", version: 2 } },
    });
    expect(v2).not.toBeNull();
    expect(v2?.status).toBe("ACTIVE");

    const v1 = await prisma.scoreModel.findUnique({
      where: { key_version: { key: "default", version: 1 } },
    });
    expect(v1).not.toBeNull();
    expect(v1?.status).toBe("ARCHIVED");
  });
});
