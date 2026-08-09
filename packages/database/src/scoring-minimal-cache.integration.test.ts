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
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
} from "@mplus/contracts";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { PrismaClient } from "@prisma/client";
import {
  WclRunRawRepository,
  CharacterRunDigestRepository,
  CharacterRunDigestCharacterLinkConflictError,
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
  let otherCharacterId: string;
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
    const other = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `scoringcacheb${randomUUID().slice(0, 8)}`,
        displayName: "ScoringCacheB",
        role: "HEALER",
      },
    });
    characterId = character.id;
    otherCharacterId = other.id;
    seasonId = season.id;
  });

  it("enforces unique raw/digest/ranking identity, UUID FKs, and JSON round-trip", async () => {
    const identity = {
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 7,
      reportRevision: 3,
      acquisitionVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
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
      participantActorId: 1,
      characterId,
      characterName: "ScoringCache",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "mage",
      specSlug: "fire",
      role: "DPS",
      extractorVersion: "extractor-v1",
      offensive: { score: 1 },
      utility: { score: 2 },
      survival: { score: 3 },
      sourceMetadata: {
        digest: {
          participantActorId: 1,
          characterName: "ScoringCache",
          realmSlug: "archimonde",
          regionCode: "EU",
        },
        participantActorId: 1,
      },
    });
    expect(digest.rawRunId).toBe(first.id);
    expect(digest.characterId).toBe(characterId);
    expect(digest.participantActorId).toBe(1);
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
        participantActorId: 99,
        characterName: "Bad",
        extractorVersion: "extractor-v1",
        offensive: {},
        utility: {},
        survival: {},
        sourceMetadata: {},
      }),
    ).rejects.toThrow();
  });

  it("persists five participant digests with only one character link (A/B/E)", async () => {
    const raw = await rawRuns.save({
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 11,
      reportRevision: 1,
      acquisitionVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      payload: { five: true },
    });
    const extractorVersion = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;
    const players = [
      { actor: 10, name: "Target", characterId },
      { actor: 11, name: "MateA", characterId: null },
      { actor: 12, name: "MateB", characterId: null },
      { actor: 13, name: "MateC", characterId: null },
      { actor: 14, name: "MateD", characterId: null },
    ] as const;

    const firstPassIds: string[] = [];
    for (const p of players) {
      const saved = await digests.save({
        rawRunId: raw.id,
        participantActorId: p.actor,
        characterId: p.characterId,
        characterName: p.name,
        realmSlug: "archimonde",
        regionCode: "EU",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        extractorVersion,
        offensive: { actor: p.actor },
        utility: { actor: p.actor },
        survival: { actor: p.actor },
        sourceMetadata: {
          digest: {
            participantActorId: p.actor,
            characterId: p.characterId,
            characterName: p.name,
            realmSlug: "archimonde",
            regionCode: "EU",
            contentHash: `hash-${p.actor}`,
          },
        },
      });
      firstPassIds.push(saved.id);
      expect(saved.id).not.toMatch(/^ephemeral:/);
    }

    const rows = await prisma.characterRunDigest.findMany({
      where: { rawRunId: raw.id, extractorVersion },
      orderBy: { participantActorId: "asc" },
    });
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.participantActorId)).size).toBe(5);
    expect(rows.filter((r) => r.characterId != null)).toHaveLength(1);
    expect(rows.filter((r) => r.characterId == null)).toHaveLength(4);

    // Test B — idempotent reuse
    const secondPassIds: string[] = [];
    for (const p of players) {
      const saved = await digests.save({
        rawRunId: raw.id,
        participantActorId: p.actor,
        characterId: p.characterId,
        characterName: p.name,
        realmSlug: "archimonde",
        regionCode: "EU",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        extractorVersion,
        offensive: { actor: p.actor, pass: 2 },
        utility: { actor: p.actor, pass: 2 },
        survival: { actor: p.actor, pass: 2 },
        sourceMetadata: {
          digest: {
            participantActorId: p.actor,
            characterId: p.characterId,
            characterName: p.name,
            realmSlug: "archimonde",
            regionCode: "EU",
            contentHash: `hash-${p.actor}`,
          },
        },
      });
      secondPassIds.push(saved.id);
    }
    expect(secondPassIds).toEqual(firstPassIds);
    const afterReuse = await prisma.characterRunDigest.count({
      where: { rawRunId: raw.id, extractorVersion },
    });
    expect(afterReuse).toBe(5);

    // Test E — actor-specific lookup
    const actor12 = await digests.find({
      rawRunId: raw.id,
      participantActorId: 12,
      extractorVersion,
    });
    expect(actor12?.characterName).toBe("MateB");
    expect(actor12?.participantActorId).toBe(12);
    const actor10 = await digests.find({
      rawRunId: raw.id,
      participantActorId: 10,
      extractorVersion,
    });
    expect(actor10?.characterId).toBe(characterId);
    expect(actor10?.id).not.toBe(actor12?.id);
  });

  it("links a null-character digest later and rejects conflicting links (C/D)", async () => {
    const raw = await rawRuns.save({
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 22,
      reportRevision: 1,
      acquisitionVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      payload: { link: true },
    });
    const extractorVersion = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;
    const saved = await digests.save({
      rawRunId: raw.id,
      participantActorId: 42,
      characterId: null,
      characterName: "Unlinked",
      realmSlug: "archimonde",
      regionCode: "EU",
      extractorVersion,
      offensive: {},
      utility: {},
      survival: {},
      sourceMetadata: {
        digest: {
          participantActorId: 42,
          characterId: null,
          characterName: "Unlinked",
        },
      },
    });
    expect(saved.characterId).toBeNull();

    const linked = await digests.attachCharacter({
      digestId: saved.id,
      characterId,
    });
    expect(linked.id).toBe(saved.id);
    expect(linked.characterId).toBe(characterId);

    const again = await digests.attachCharacter({
      digestId: saved.id,
      characterId,
    });
    expect(again.id).toBe(saved.id);
    expect(again.characterId).toBe(characterId);

    await expect(
      digests.attachCharacter({
        digestId: saved.id,
        characterId: otherCharacterId,
      }),
    ).rejects.toBeInstanceOf(CharacterRunDigestCharacterLinkConflictError);

    const unchanged = await digests.find({
      rawRunId: raw.id,
      participantActorId: 42,
      extractorVersion,
    });
    expect(unchanged?.characterId).toBe(characterId);

    // save must not wipe an existing character link with null
    const preserved = await digests.save({
      rawRunId: raw.id,
      participantActorId: 42,
      characterId: null,
      characterName: "Unlinked",
      realmSlug: "archimonde",
      regionCode: "EU",
      extractorVersion,
      offensive: { updated: true },
      utility: {},
      survival: {},
      sourceMetadata: { digest: { participantActorId: 42 } },
    });
    expect(preserved.characterId).toBe(characterId);
  });

  it("rejects save that would replace Character A with Character B", async () => {
    const raw = await rawRuns.save({
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 33,
      reportRevision: 1,
      acquisitionVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      payload: { conflict: true },
    });
    const extractorVersion = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;
    const saved = await digests.save({
      rawRunId: raw.id,
      participantActorId: 77,
      characterId,
      characterName: "Linked",
      realmSlug: "archimonde",
      regionCode: "EU",
      extractorVersion,
      offensive: {},
      utility: {},
      survival: {},
      sourceMetadata: { digest: { participantActorId: 77 } },
    });
    expect(saved.characterId).toBe(characterId);

    await expect(
      digests.save({
        rawRunId: raw.id,
        participantActorId: 77,
        characterId: otherCharacterId,
        characterName: "Linked",
        realmSlug: "archimonde",
        regionCode: "EU",
        extractorVersion,
        offensive: { changed: true },
        utility: {},
        survival: {},
        sourceMetadata: { digest: { participantActorId: 77 } },
      }),
    ).rejects.toBeInstanceOf(CharacterRunDigestCharacterLinkConflictError);

    const unchanged = await digests.find({
      rawRunId: raw.id,
      participantActorId: 77,
      extractorVersion,
    });
    expect(unchanged?.characterId).toBe(characterId);
    expect(unchanged?.offensive).toEqual({});
  });

  it("serializes concurrent attach attempts so conflicting links cannot win", async () => {
    const raw = await rawRuns.save({
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 44,
      reportRevision: 1,
      acquisitionVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      payload: { race: true },
    });
    const extractorVersion = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;
    const saved = await digests.save({
      rawRunId: raw.id,
      participantActorId: 88,
      characterId: null,
      characterName: "RaceMe",
      realmSlug: "archimonde",
      regionCode: "EU",
      extractorVersion,
      offensive: {},
      utility: {},
      survival: {},
      sourceMetadata: { digest: { participantActorId: 88 } },
    });

    const results = await Promise.allSettled([
      digests.attachCharacter({ digestId: saved.id, characterId }),
      digests.attachCharacter({
        digestId: saved.id,
        characterId: otherCharacterId,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.status).toBe("rejected");
    if (rejected[0]!.status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(
        CharacterRunDigestCharacterLinkConflictError,
      );
    }

    const final = await digests.find({
      rawRunId: raw.id,
      participantActorId: 88,
      extractorVersion,
    });
    expect(final?.characterId).toBe(
      (fulfilled[0] as PromiseFulfilledResult<{ characterId: string | null }>)
        .value.characterId,
    );
    expect([characterId, otherCharacterId]).toContain(final?.characterId);
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
