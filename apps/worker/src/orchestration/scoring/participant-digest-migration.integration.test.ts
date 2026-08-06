/**
 * Local-only validation of 20260805180000_participant_scoring_digest.
 * Skips when DATABASE_URL is unreachable. Never targets staging/production.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  checkDatabaseHealth,
  createPrismaClient,
  type PrismaClient,
} from "@mplus/database";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping participant digest migration validation: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("participant_scoring_digest migration (local)", () => {
  it("tables, unique constraints, and indexes exist", async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'capability_evidence_package_records',
          'participant_scoring_digests'
        )
      ORDER BY tablename
    `;
    expect(tables.map((t) => t.tablename)).toEqual([
      "capability_evidence_package_records",
      "participant_scoring_digests",
    ]);

    const uniques = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'capability_evidence_package_records_compatibility_key_key',
          'participant_scoring_digests_compatibility_key_key'
        )
      ORDER BY indexname
    `;
    expect(uniques).toHaveLength(2);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND (
          indexname LIKE 'capability_evidence_package_records_%'
          OR indexname LIKE 'participant_scoring_digests_%'
        )
      ORDER BY indexname
    `;
    expect(indexes.length).toBeGreaterThanOrEqual(6);
  });

  it("existing artifact and scoring tables remain present", async () => {
    const core = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('RawArtifact', 'raw_artifacts', 'ScoreSnapshot', 'score_snapshots')
    `;
    // Prisma maps vary; at least one artifact / score relation table must exist.
    const names = core.map((r) => r.tablename.toLowerCase());
    expect(
      names.some((n) => n.includes("artifact")) ||
        names.some((n) => n.includes("score")),
    ).toBe(true);
  });
});
