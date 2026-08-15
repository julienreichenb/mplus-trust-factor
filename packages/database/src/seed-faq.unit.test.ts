import { describe, expect, it } from "vitest";
import { PRODUCTION_FAQ_ENTRIES, PRODUCTION_FAQ_IDS } from "./faq-production-content.js";
import { seedProductionFaq } from "./seed-faq.js";

function createMemoryFaqPrisma(initialIds: string[] = []) {
  const store = new Map<
    string,
    { title: string; description: string; position: number; isPublished: boolean; embedType: string | null }
  >();
  for (const id of initialIds) {
    const catalog = PRODUCTION_FAQ_ENTRIES.find((entry) => entry.id === id);
    if (catalog) {
      store.set(id, {
        title: catalog.title,
        description: catalog.description,
        position: catalog.position,
        isPublished: catalog.isPublished,
        embedType: catalog.embedType,
      });
    }
  }
  return {
    store,
    faqEntry: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.has(where.id) ? { id: where.id } : null,
      create: async ({
        data,
      }: {
        data: {
          id: string;
          title: string;
          description: string;
          position: number;
          isPublished: boolean;
          embedType: string | null;
        };
      }) => {
        store.set(data.id, {
          title: data.title,
          description: data.description,
          position: data.position,
          isPublished: data.isPublished,
          embedType: data.embedType,
        });
        return data;
      },
    },
  };
}

describe("seedProductionFaq insert-missing", () => {
  it("inserts all 15 when empty", async () => {
    const prisma = createMemoryFaqPrisma();
    const report = await seedProductionFaq(prisma);
    expect(report.inserted).toBe(15);
    expect(report.skipped).toBe(0);
    expect(prisma.store.size).toBe(15);
    expect([...prisma.store.keys()]).toEqual([...PRODUCTION_FAQ_IDS]);
    expect(prisma.store.get(PRODUCTION_FAQ_IDS[1]!)?.embedType).toBe("SCORE_FLOW");
    expect(prisma.store.get(PRODUCTION_FAQ_IDS[2]!)?.embedType).toBe("SCORING_DIMENSIONS");
    expect(prisma.store.get(PRODUCTION_FAQ_IDS[4]!)?.embedType).toBe("KEY_PERCENTILE_TABLE");
    expect(prisma.store.get(PRODUCTION_FAQ_IDS[5]!)?.embedType).toBe("META_TIER_TABLE");
  });

  it("does not overwrite existing title, description, publication, position, or embedType", async () => {
    const prisma = createMemoryFaqPrisma([PRODUCTION_FAQ_IDS[1]!]);
    prisma.store.set(PRODUCTION_FAQ_IDS[1]!, {
      title: "Admin title",
      description: "Admin body",
      position: 7,
      isPublished: false,
      embedType: null,
    });
    const report = await seedProductionFaq(prisma);
    expect(report.inserted).toBe(14);
    expect(report.skipped).toBe(1);
    expect(prisma.store.get(PRODUCTION_FAQ_IDS[1]!)).toEqual({
      title: "Admin title",
      description: "Admin body",
      position: 7,
      isPublished: false,
      embedType: null,
    });
  });
});
