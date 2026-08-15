import { PrismaClient } from "@prisma/client";

export type { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
export * from "./repositories/index.js";
export {
  backfillScoringMinimalCache,
  type ScoringCacheBackfillReport,
  type ScoringCacheBackfillOptions,
} from "./backfill-scoring-minimal-cache.js";
export {
  assertScoringTestResetAllowed,
  formatScoringResetGuardFailure,
  SCORING_RESET_CONFIRMATION_TOKEN,
  SCORING_RESET_TRUNCATE_TABLES,
  SCORING_RESET_RETAINED_TABLES,
  type ScoringResetGuardInput,
  type ScoringResetGuardResult,
} from "./reset/v2-test-reset-guard.js";
export {
  EXPERIENCE_SEASON_CUTOFFS_CATALOG_SCHEMA_VERSION,
  EXPERIENCE_POPULATION_CATALOG_PROVENANCE_KEY,
  EXPERIENCE_SEASON_CUTOFF_QUANTILES,
  SUPPORTED_EXPERIENCE_CUTOFF_REGIONS,
  compareCatalogEntryKeys,
  emptyExperienceSeasonCutoffsCatalog,
  experienceSeasonCutoffsCatalogPath,
  isCanonicalRaiderIoMainSeasonSlug,
  loadExperienceSeasonCutoffsCatalog,
  readExperiencePopulationCatalogProvenance,
  serializeExperienceSeasonCutoffsCatalog,
  sortCatalogEntries,
  validateExperienceSeasonCutoffsCatalog,
  type CatalogValidationIssue,
  type ExperienceCutoffRegionCode,
  type ExperiencePopulationCatalogProvenance,
  type ExperienceSeasonCutoffQuantile,
  type ExperienceSeasonCutoffsCatalog,
  type ExperienceSeasonCutoffsCatalogEntry,
  type ExperienceSeasonCutoffsCatalogSource,
} from "./experience-season-cutoffs-catalog.js";
export {
  catalogEntryToRaiderIoSeasonCutoffs,
  seedExperienceSeasonCutoffsFromCatalog,
  type SeedExperienceCutoffsEntryResult,
  type SeedExperienceCutoffsPrisma,
  type SeedExperienceCutoffsReport,
} from "./seed-experience-season-cutoffs.js";
export {
  PRODUCTION_FAQ_ENTRIES,
  PRODUCTION_FAQ_IDS,
  productionFaqId,
  type ProductionFaqSeedEntry,
} from "./faq-production-content.js";
export { seedProductionFaq, type SeedProductionFaqPrisma, type SeedProductionFaqReport } from "./seed-faq.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl
      ? {
          db: { url: databaseUrl },
        }
      : undefined,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function checkDatabaseHealth(client: PrismaClient = prisma): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    await client.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
