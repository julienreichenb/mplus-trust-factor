import { afterAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createPrismaClient, checkDatabaseHealth } from "./index.js";
import { PRODUCTION_FAQ_ENTRIES, PRODUCTION_FAQ_IDS } from "./faq-production-content.js";
import { seedProductionFaq } from "./seed-faq.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

describe("seedProductionFaq", () => {
  const prisma = createPrismaClient(databaseUrl);

  afterAll(async () => {
    await prisma.faqEntry.deleteMany({ where: { id: { in: [...PRODUCTION_FAQ_IDS] } } });
    await prisma.$disconnect();
  });

  it("inserts 15 published entries once and never overwrites admin edits", async () => {
    const health = await checkDatabaseHealth(prisma);
    if (!health.ok) {
      throw new Error(
        `PostgreSQL is not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
      );
    }

    await prisma.faqEntry.deleteMany({ where: { id: { in: [...PRODUCTION_FAQ_IDS] } } });

    const first = await seedProductionFaq(prisma);
    expect(first.inserted).toBe(15);
    expect(first.skipped).toBe(0);

    const rows = await prisma.faqEntry.findMany({
      where: { id: { in: [...PRODUCTION_FAQ_IDS] } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    expect(rows).toHaveLength(15);
    expect(rows.every((row) => row.isPublished)).toBe(true);
    expect(rows.map((row) => row.title)).toEqual(PRODUCTION_FAQ_ENTRIES.map((e) => e.title));
    expect(rows.map((row) => row.embedType)).toEqual(PRODUCTION_FAQ_ENTRIES.map((e) => e.embedType));

    const edited = rows[1]!;
    await prisma.faqEntry.update({
      where: { id: edited.id },
      data: {
        title: "Admin edited title",
        description: "Admin edited description",
        isPublished: false,
        position: 999,
        embedType: null,
      },
    });

    const second = await seedProductionFaq(prisma);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(15);

    const after = await prisma.faqEntry.findUnique({ where: { id: edited.id } });
    expect(after?.title).toBe("Admin edited title");
    expect(after?.description).toBe("Admin edited description");
    expect(after?.isPublished).toBe(false);
    expect(after?.position).toBe(999);
    expect(after?.embedType).toBeNull();

    const count = await prisma.faqEntry.count({ where: { id: { in: [...PRODUCTION_FAQ_IDS] } } });
    expect(count).toBe(15);
  });
});
