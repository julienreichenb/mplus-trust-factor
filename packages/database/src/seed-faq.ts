/**
 * Insert-missing production FAQ catalog.
 * Does not overwrite title, description, publication, position, or embedType after insert.
 * Not invoked from API/worker startup or the general database seed.
 */

import type { PrismaClient } from "@prisma/client";
import { PRODUCTION_FAQ_ENTRIES } from "./faq-production-content.js";

export type SeedProductionFaqPrisma = Pick<PrismaClient, "faqEntry">;

export interface SeedProductionFaqReport {
  inserted: number;
  skipped: number;
  ids: string[];
}

export async function seedProductionFaq(
  prisma: SeedProductionFaqPrisma,
): Promise<SeedProductionFaqReport> {
  let inserted = 0;
  let skipped = 0;
  const ids: string[] = [];

  for (const entry of PRODUCTION_FAQ_ENTRIES) {
    const existing = await prisma.faqEntry.findUnique({
      where: { id: entry.id },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      ids.push(entry.id);
      continue;
    }
    await prisma.faqEntry.create({
      data: {
        id: entry.id,
        title: entry.title,
        description: entry.description,
        position: entry.position,
        isPublished: entry.isPublished,
        embedType: entry.embedType,
      },
    });
    inserted += 1;
    ids.push(entry.id);
  }

  return { inserted, skipped, ids };
}
