/**
 * PostgreSQL integration for minimal scoring repositories.
 *
 * Skips when DATABASE_URL is unset / DB unreachable.
 * Run locally:
 *   pnpm test:integration:shared -- packages/database/src/scoring-minimal-cache.integration.test.ts
 * or:
 *   pnpm --filter @mplus/database exec vitest run --config ../../vitest.integration.config.ts src/scoring-minimal-cache.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { PrismaClient } from "@prisma/client";
import {
  WclRunRawRepository,
  CharacterRunDigestRepository,
  RunRankingFactRepository,
  CharacterScoreRepository,
  checkDatabaseHealth,
} from "./index.js";
import { backfillScoringMinimalCache } from "./backfill-scoring-minimal-cache.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma = new PrismaClient();
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping scoring minimal-cache tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. Run "pnpm dev:infra" then "pnpm test:integration:shared -- packages/database/src/scoring-minimal-cache.integration.test.ts".`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("scoring minimal cache repositories (postgres)", () => {
  const rawRuns = new WclRunRawRepository(prisma);
  const digests = new CharacterRunDigestRepository(prisma);
  const rankings = new RunRankingFactRepository(prisma);
  const scores = new CharacterScoreRepository(prisma);

  let characterId: string;
  let seasonId: string;

  beforeAll(async () => {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: "EU" } });
    const realm =
      (await prisma.realm.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `scoring-cache-${randomUUID().slice(0, 6)}`,
          name: "Scoring Cache Realm",
          timezone: "Europe/Paris",
        },
      }));
    const season =
      (await prisma.season.findFirst({ where: { regionId: region.id } })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: `scoring-cache-season-${randomUUID().slice(0, 6)}`,
          name: "Scoring Cache Season",
          blizzardSeasonId: 999301,
          startsAt: new Date("2026-01-01"),
        },
      }));
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `scoringcache${randomUUID().slice(0, 8)}`,
        displayName: "ScoringCache",
        role: "DPS",
      },
    });
    characterId = character.id;
    seasonId = season.id;
  });

  it("enforces unique raw/digest/ranking identity, UUID FKs, and JSON round-trip", async () => {
    const identity = {
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 7,
      reportRevision: 3,
      acquisitionVersion: "capability-acquisition-plan-v1",
    };
    const payload = { ok: true, events: [{ t: 1 }], nested: { a: "b" } };

    const first = await rawRuns.save({
      ...identity,
      payload,
    });
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    // Content hash must not be used as the entity UUID.
    expect(first.id).not.toBe(first.contentHash);

    const loadedFirst = await rawRuns.find(identity);
    expect(loadedFirst?.payload).toEqual(payload);

    const updatedPayload = { ok: true, events: [1] };
    const second = await rawRuns.save({
      ...identity,
      payload: updatedPayload,
    });
    expect(second.id).toBe(first.id);

    const loaded = await rawRuns.find(identity);
    expect(loaded?.payload).toEqual(updatedPayload);

    const digest = await digests.save({
      rawRunId: first.id,
      characterId,
      extractorVersion: "extractor-v1",
      offensive: { score: 1 },
      utility: { score: 2 },
      survival: { score: 3 },
      sourceMetadata: { participantActorId: 1 },
    });
    expect(digest.rawRunId).toBe(first.id);
    expect(digest.characterId).toBe(characterId);
    expect(digest.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const ranking = await rankings.save({
      rawRunId: first.id,
      characterId,
      rankingVersion: "ranking-parse-v1",
      payload: { bracketPercent: 90, participantActorId: 1 },
    });
    expect(ranking.rawRunId).toBe(first.id);

    const score = await scores.save({
      characterId,
      seasonId,
      scoringVersion: `scoring-itest-${randomUUID().slice(0, 8)}`,
      performance: 80,
      utility: 70,
      survival: 75,
      composite: 75,
      confidence: 0.7,
      selectedRuns: [
        { reportCode: identity.reportCode, fightId: identity.fightId },
      ],
    });
    expect(score.characterId).toBe(characterId);

    await expect(
      digests.save({
        rawRunId: "a".repeat(64),
        characterId,
        extractorVersion: "extractor-v1",
        offensive: {},
        utility: {},
        survival: {},
        sourceMetadata: {},
      }),
    ).rejects.toThrow();
  });

  it("backfill is idempotent (provider-free)", async () => {
    const first = await backfillScoringMinimalCache({ prisma, dryRun: false });
    const second = await backfillScoringMinimalCache({ prisma, dryRun: false });
    expect(second.rawMigrated).toBe(0);
    expect(second.rawReused + second.rawSkipped + second.rawInvalid).toBe(
      second.packagesScanned,
    );
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });
});
