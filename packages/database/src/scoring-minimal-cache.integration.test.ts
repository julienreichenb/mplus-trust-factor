/**
 * PostgreSQL integration for minimal scoring repositories.
 * Skips when DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  WclRunRawRepository,
  CharacterRunDigestRepository,
  RunRankingFactRepository,
  CharacterScoreRepository,
} from "./repositories/index.js";

const databaseUrl = process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("scoring minimal cache repositories (postgres)", () => {
  const prisma = new PrismaClient();
  const rawRuns = new WclRunRawRepository(prisma);
  const digests = new CharacterRunDigestRepository(prisma);
  const rankings = new RunRankingFactRepository(prisma);
  const scores = new CharacterScoreRepository(prisma);

  let characterId: string;
  let seasonId: string;

  beforeAll(async () => {
    await prisma.$connect();
    const character = await prisma.character.findFirst();
    const season = await prisma.season.findFirst();
    if (!character || !season) {
      throw new Error(
        "scoring_minimal_cache_itest_requires_seeded_character_and_season",
      );
    }
    characterId = character.id;
    seasonId = season.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enforces unique raw source identity and UUID digests", async () => {
    const identity = {
      reportCode: `R${randomUUID().slice(0, 8)}`,
      fightId: 7,
      reportRevision: 3,
      acquisitionVersion: "capability-acquisition-plan-v1",
    };

    const first = await rawRuns.save({
      ...identity,
      payload: { ok: true, events: [] },
    });
    const second = await rawRuns.save({
      ...identity,
      payload: { ok: true, events: [1] },
    });
    expect(second.id).toBe(first.id);

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
});
