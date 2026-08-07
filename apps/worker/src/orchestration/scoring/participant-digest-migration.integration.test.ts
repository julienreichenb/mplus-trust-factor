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
          'participant_scoring_digests',
          'character_run_digests'
        )
      ORDER BY tablename
    `;
    expect(tables.map((t) => t.tablename)).toEqual([
      "capability_evidence_package_records",
      "character_run_digests",
      "participant_scoring_digests",
    ]);

    const uniques = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'capability_evidence_package_records_compatibility_key_key',
          'participant_scoring_digests_compatibility_key_key',
          'character_run_digests_raw_run_actor_extractor_key'
        )
      ORDER BY indexname
    `;
    expect(uniques).toHaveLength(3);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND (
          indexname LIKE 'capability_evidence_package_records_%'
          OR indexname LIKE 'participant_scoring_digests_%'
          OR indexname LIKE 'character_run_digests_%'
        )
      ORDER BY indexname
    `;
    expect(indexes.length).toBeGreaterThanOrEqual(8);
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

  it("migration backfill SQL reads representative source_metadata shapes", async () => {
    // Simulate the migration UPDATE expressions against representative JSON.
    const rows = await prisma.$queryRaw<
      Array<{
        actor_from_digest: number | null;
        actor_from_top: number | null;
        name_from_digest: string | null;
        realm_normalized: string | null;
      }>
    >`
      WITH samples AS (
        SELECT '{"digest":{"participantActorId":12,"characterName":"Mate","realmSlug":"unknown","regionCode":"EU"},"participantActorId":12}'::jsonb AS source_metadata
        UNION ALL
        SELECT '{"participantActorId":7,"characterName":"TopOnly"}'::jsonb
        UNION ALL
        SELECT '{"digest":{"participantActorId":0,"characterName":"Bad"}}'::jsonb
      )
      SELECT
        CASE
          WHEN (source_metadata->'digest'->>'participantActorId') ~ '^[1-9][0-9]*$'
            THEN (source_metadata->'digest'->>'participantActorId')::integer
          ELSE NULL
        END AS actor_from_digest,
        CASE
          WHEN (source_metadata->>'participantActorId') ~ '^[1-9][0-9]*$'
            THEN (source_metadata->>'participantActorId')::integer
          ELSE NULL
        END AS actor_from_top,
        NULLIF(trim(source_metadata->'digest'->>'characterName'), '') AS name_from_digest,
        CASE
          WHEN lower(COALESCE(source_metadata->'digest'->>'realmSlug', '')) IN ('', 'unknown')
            THEN NULL
          ELSE NULLIF(trim(source_metadata->'digest'->>'realmSlug'), '')
        END AS realm_normalized
      FROM samples
      ORDER BY actor_from_top NULLS LAST, actor_from_digest NULLS LAST
    `;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_from_digest: 12,
          actor_from_top: 12,
          name_from_digest: "Mate",
          realm_normalized: null,
        }),
        expect.objectContaining({
          actor_from_digest: null,
          actor_from_top: 7,
          name_from_digest: null,
        }),
        expect.objectContaining({
          actor_from_digest: null,
          name_from_digest: "Bad",
        }),
      ]),
    );
  });
});
