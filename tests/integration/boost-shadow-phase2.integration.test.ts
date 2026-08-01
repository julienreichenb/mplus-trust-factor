/**
 * Phase 2 integration: read-only harness against isolated disposable test DB.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseHealth, createPrismaClient, type PrismaClient } from "@mplus/database";
import {
  HIGH_KEY_POLICY_VERSION,
  buildBacktestArtifacts,
  createMutationGuard,
  createReadOnlyPrismaProxy,
  runBoostShadowBacktestFromBundle,
  validateBoostShadowCohortManifest,
} from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { loadPersistedBoostShadowEvidenceBundle } from "../../tools/boost-shadow-backtest/load-persisted-evidence.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping boost-shadow Phase 2 integration: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}. ${health.error ?? ""}`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedBoostShadowRuns(label: string) {
  const region = await prisma.region.upsert({
    where: { code: "EU" },
    update: {},
    create: {
      code: "EU",
      apiHost: "https://eu.api.blizzard.com",
      localeDefault: "en_GB",
      enabled: true,
    },
  });

  let realm = await prisma.realm.findFirst({
    where: { regionId: region.id, slug: "boost-shadow-itest-realm" },
  });
  if (!realm) {
    realm = await prisma.realm.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: "boost-shadow-itest-realm",
        name: "Boost Shadow Itest",
      },
    });
  }

  const season =
    (await prisma.season.findFirst({
      where: { regionId: region.id, slug: "boost-shadow-itest-season" },
    })) ??
    (await prisma.season.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: "boost-shadow-itest-season",
        name: "Boost Shadow Itest Season",
        blizzardSeasonId: 991001,
        startsAt: new Date("2026-01-01"),
      },
    }));

  let dungeon = await prisma.dungeon.findFirst({
    where: { slug: "boost-shadow-itest-dungeon" },
  });
  if (!dungeon) {
    dungeon = await prisma.dungeon.create({
      data: {
        id: randomUUID(),
        slug: "boost-shadow-itest-dungeon",
        name: "Boost Shadow Itest Dungeon",
      },
    });
  }

  const subject = await prisma.character.create({
    data: {
      id: randomUUID(),
      regionId: region.id,
      realmId: realm.id,
      normalizedName: `boostshadow${randomUUID().slice(0, 8)}`,
      displayName: `BoostShadow${label}`,
      level: 90,
    },
  });

  const teammateIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const tm = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `boostshadowtm${i}${randomUUID().slice(0, 6)}`,
        displayName: `BoostShadowTm${i}${label}`,
        level: 90,
      },
    });
    teammateIds.push(tm.id);
  }

  for (let i = 0; i < 4; i++) {
    const runId = randomUUID();
    const keyLevel = 12 + i;
    await prisma.mythicRun.create({
      data: {
        id: runId,
        seasonId: season.id,
        dungeonId: dungeon.id,
        regionId: region.id,
        keyLevel,
        completedAt: new Date(`2026-07-0${i + 1}T10:00:00.000Z`),
        durationMs: 1_200_000,
        timerMs: 1_800_000,
        timed: true,
        scoreValue: keyLevel * 100,
        canonicalFingerprint: `boost-shadow-itest-${label}-${i}-${randomUUID()}`,
        participants: {
          create: [
            {
              id: randomUUID(),
              characterId: subject.id,
              providerCharacterKey: `subj:${subject.id}`,
              displayName: subject.displayName,
              realmSlug: realm.slug,
              regionCode: "eu",
              mythicRatingAtRun: 2100,
              isTargetCharacter: true,
            },
            ...teammateIds.map((tid, ti) => ({
              id: randomUUID(),
              characterId: tid,
              providerCharacterKey: `tm:${tid}`,
              displayName: `Tm${ti}`,
              realmSlug: realm.slug,
              regionCode: "eu",
              mythicRatingAtRun: 3200 - ti * 20,
              isTargetCharacter: false,
            })),
          ],
        },
      },
    });
  }

  return { subject, season, region, teammateIds };
}

describe.skipIf(!dbAvailable)("boost-shadow Phase 2 isolated DB harness", () => {
  it("loads persisted evidence read-only and runs backtest without writes", async () => {
    const seeded = await seedBoostShadowRuns("A");
    const generatedAt = "2026-07-15T12:00:00.000Z";

    const manifestRaw = {
      schemaVersion: "boost-shadow-cohort-v1",
      cohortId: "itest-boost-shadow-phase2",
      description: "Isolated DB Phase 2 harness cohort",
      createdAt: generatedAt,
      highKeyPolicyVersion: HIGH_KEY_POLICY_VERSION,
      seasonId: seeded.season.id,
      members: [
        {
          memberId: "m-itest-1",
          characterId: seeded.subject.id,
          role: "DPS",
          keyBand: "high",
          label: {
            class: "synthetic_fixture",
            source: "synthetic_suspicious_cohort",
            confidence: 1,
            labeledAt: generatedAt,
            policyVersion: "label-policy-itest-v1",
            reviewerCount: null,
          },
          evaluationCutoff: generatedAt,
        },
      ],
    };

    const validated = validateBoostShadowCohortManifest(manifestRaw);
    expect(validated.ok).toBe(true);

    const snapshotCountBefore = await prisma.scoreSnapshot.count();
    const redFlagCountBefore = await prisma.characterRedFlag.count();

    const guard = createMutationGuard();
    const bundle = await loadPersistedBoostShadowEvidenceBundle({
      prisma,
      manifest: validated.manifest!,
      generatedAt,
      guard,
    });

    expect(guard.counters.databaseWrites).toBe(0);
    expect(bundle.evidenceByMemberId["m-itest-1"]!.runs.length).toBeGreaterThanOrEqual(3);

    // Harness must also refuse writes via proxy if something tries.
    const readOnly = createReadOnlyPrismaProxy(prisma, guard);
    expect(() => readOnly.scoreSnapshot.create({ data: {} as never })).toThrow(/Read-only/);

    const { report, mutationGuard } = runBoostShadowBacktestFromBundle(bundle);
    mutationGuard.assertNoProviderCalls();
    mutationGuard.assertNoWrites();

    expect(report.providerCallsMade).toBe(false);
    expect(report.scoreSnapshotsWritten).toBe(false);
    expect(report.characterRedFlagsWritten).toBe(false);
    expect(report.isolation.productionScoreEffect).toBe(false);
    expect(report.rows[0]!.features.teammateScoreGap).not.toBeNull();

    const artifactsA = buildBacktestArtifacts(report);
    const artifactsB = buildBacktestArtifacts(
      runBoostShadowBacktestFromBundle(bundle).report,
    );
    expect(artifactsA.json).toBe(artifactsB.json);

    const snapshotCountAfter = await prisma.scoreSnapshot.count();
    const redFlagCountAfter = await prisma.characterRedFlag.count();
    expect(snapshotCountAfter).toBe(snapshotCountBefore);
    expect(redFlagCountAfter).toBe(redFlagCountBefore);
  });
});
