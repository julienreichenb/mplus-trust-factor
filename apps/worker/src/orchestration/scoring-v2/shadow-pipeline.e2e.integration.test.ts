/**
 * CP4 — disposable-DB end-to-end Scoring V2 typed shadow proof.
 *
 * Fixture transport only. Requires `pnpm test:integration` (isolated DB + seed).
 * Does not call live providers, mutate shared DBs, or enable publication permanently.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv, resetEnvCache } from "@mplus/config";
import {
  EVIDENCE_SELECTOR_VERSION,
  type EvidenceAcquisitionPlanV2,
  type RaiderIoCharacterProfile,
} from "@mplus/contracts";
import { buildRequestFingerprint } from "@mplus/domain";
import { createPrismaClient, checkDatabaseHealth, type PrismaClient } from "@mplus/database";
import {
  attachDatasetToBundle,
  buildEmptyBundle,
  HOSTILE_CAST_FILTER_EXPRESSION,
  PERFORMANCE_V2_EXTRACTOR_FAMILY,
  UTILITY_EVIDENCE_CONSUMERS,
  type RankingParseEvidenceV2,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import {
  RAIDERIO_SCHEMA_VERSION,
  buildMinimalCharacterFields,
} from "@mplus/provider-raiderio";
import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  UTILITY_V2_EXTRACTOR_FAMILY,
  buildEvidenceAcquisitionPlanV2,
} from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import { createWorkerContainer } from "../../container.js";
import { createEvidenceV2BatchRepository } from "../../persistence/evidence-v2-batch-repository.js";
import {
  acquireCandidateWithFallback,
  resolveBatchDatasetRequirements,
} from "./acquisition.js";
import { FixtureScoringV2EvidenceTransport } from "./evidence-transport.js";
import { runFinalizeEvidenceBatchV2 } from "./finalize.js";
import { persistTypedFactSet } from "./typed-fact-persist.js";
import { buildExperienceHistoryFromPersistedEvidence } from "./experience-history-loader.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping CP4 shadow E2E: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

const REPORT_CODE = "Cp4FxRep01Ab";
const FIGHT_ID = 7;
const REPORT_CODE_2 = "Cp4FxRep02Cd";
const FIGHT_ID_2 = 8;
const REPORT_REVISION = 1;
const DUNGEON_SLUG = "ara-kara";
const CUTOFF = "2026-08-01T12:00:00.000Z";

function okDataset(
  key: WclRunEvidenceDataset["key"],
  events: Array<Record<string, unknown>> = [],
): WclRunEvidenceDataset {
  return {
    key,
    state: "OK",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: key === "HostileCasts" ? null : 10,
    filterExpression: key === "HostileCasts" ? HOSTILE_CAST_FILTER_EXPRESSION : null,
    pages: [
      {
        pageIndex: 0,
        startTime: 0,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: `${key}-fp`,
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: null,
    costSource: "unknown",
    requestCostUnits: [],
    wclRequests: 0,
    fetchedAt: "2026-08-01T00:00:00.000Z",
    source: "persisted",
  };
}

function buildSharedEvidenceBundle(input: {
  reportCode: string;
  fightId: number;
}): WclRunEvidenceBundle {
  let bundle = buildEmptyBundle({
    reportCode: input.reportCode,
    reportRevision: REPORT_REVISION,
    fightId: input.fightId,
    playerActorId: 10,
    ownedPetActorIds: [],
    dungeonSlug: DUNGEON_SLUG,
    startTime: 0,
    endTime: 600_000,
    consumers: ["survival", "utility"],
  });
  bundle = {
    ...bundle,
    masterData: {
      actors: [
        { id: 10, name: "Cp4Tester", type: "Player", subType: "Mage", petOwner: null },
        { id: 50, name: "Enemy", type: "NPC", subType: null, petOwner: null },
      ],
    },
  };

  for (const key of UTILITY_EVIDENCE_CONSUMERS.filter((k) => k !== "masterData")) {
    const events =
      key === "HostileCasts"
        ? [
            { timestamp: 10_000, type: "begincast", sourceID: 50, abilityGameID: 400001 },
            { timestamp: 12_000, type: "cast", sourceID: 50, abilityGameID: 400001 },
          ]
        : key === "Interrupts"
          ? [
              {
                timestamp: 11_000,
                type: "interrupt",
                sourceID: 10,
                targetID: 50,
                abilityGameID: 2139,
                extraAbilityGameID: 400001,
              },
            ]
          : key === "Casts"
            ? [
                {
                  timestamp: 10_800,
                  type: "cast",
                  sourceID: 10,
                  abilityGameID: 2139,
                  targetID: 50,
                },
                {
                  timestamp: 20_000,
                  type: "cast",
                  sourceID: 10,
                  abilityGameID: 45438,
                  targetID: 10,
                },
              ]
            : key === "CombatantInfo"
              ? [{ sourceID: 10, specID: 64, type: "combatantinfo" }]
              : [];
    bundle = attachDatasetToBundle(bundle, okDataset(key, events), { fromPersisted: true });
  }

  for (const key of ["DamageTaken", "Healing", "Buffs", "Debuffs", "Deaths"] as const) {
    if (bundle.eventDatasets[key]) continue;
    const events =
      key === "DamageTaken"
        ? [
            {
              timestamp: 5_000,
              type: "damage",
              sourceID: 50,
              targetID: 10,
              abilityGameID: 1,
              amount: 80_000,
              unmitigatedAmount: 80_000,
              hitType: 1,
              absorbed: 0,
              overkill: 0,
              resourceActor: 0,
              resourceType: 0,
              resourceAmount: 1_000_000,
              resourceMax: 1_000_000,
            },
          ]
        : key === "Deaths"
          ? []
          : key === "Buffs"
            ? [
                {
                  timestamp: 20_000,
                  type: "applybuff",
                  sourceID: 10,
                  targetID: 10,
                  abilityGameID: 45438,
                },
              ]
            : [];
    bundle = attachDatasetToBundle(bundle, okDataset(key, events), { fromPersisted: true });
  }
  return bundle;
}

function rankingEvidence(reportCode: string, fightId: number): RankingParseEvidenceV2 {
  return {
    reportCode,
    fightId,
    reportRevision: REPORT_REVISION,
    dungeonSlug: DUNGEON_SLUG,
    keyLevel: 12,
    bracketPercent: 72,
    rankPercent: null,
    amountPercent: null,
    amount: 420_000,
    partition: 1,
  };
}

function rioProfile(name: string, realmSlug: string): RaiderIoCharacterProfile {
  return {
    region: "EU",
    realmSlug,
    normalizedName: name.toLowerCase(),
    displayName: name,
    classSlug: "mage",
    specSlug: "frost",
    role: "DPS",
    profileUrl: `https://raider.io/characters/eu/${realmSlug}/${name}`,
    lastCrawledAt: "2026-08-01T09:00:00.000Z",
    crawlStale: false,
    gear: null,
    talents: null,
    currentSeason: {
      seasonSlug: "cp4-shadow-season",
      scores: { all: 3100, dps: 3100, healer: null, tank: null },
      isCurrentSeason: true,
      isPreviousSeason: false,
    },
    previousSeason: {
      seasonSlug: "cp4-prev-season",
      scores: { all: 2700, dps: 2700, healer: null, tank: null },
      isCurrentSeason: false,
      isPreviousSeason: true,
    },
    ranks: {
      overall: 900,
      class: 40,
      server: 3,
      world: 900,
      region: 300,
      role: "DPS",
    },
    recentRuns: [],
    bestRuns: [],
    highestLevelRuns: [],
    raidProgression: [],
    runHistoryIncomplete: false,
    representedRunCount: 12,
    attribution: {
      provider: "raiderio",
      displayText: "Data from Raider.IO",
      homepageUrl: "https://raider.io",
      profileUrl: `https://raider.io/characters/eu/${realmSlug}/${name}`,
      sourceUrl: `https://raider.io/characters/eu/${realmSlug}/${name}`,
    },
  };
}

describe.runIf(dbAvailable)("CP4 typed shadow pipeline E2E (disposable DB)", () => {
  let characterId: string;
  let seasonId: string;
  let prevSeasonId: string;
  let scoreModelId: string;
  let dungeonId: string;
  let plan: EvidenceAcquisitionPlanV2;
  let storeRoot: string;
  let displayName: string;
  let realmSlug: string;
  let normalizedName: string;

  beforeAll(async () => {
    storeRoot = await mkdtemp(path.join(tmpdir(), "mplus-cp4-shadow-"));
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
    realmSlug = `cp4-shadow-${randomUUID().slice(0, 6)}`;
    const realm = await prisma.realm.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        slug: realmSlug,
        name: "CP4 Shadow Realm",
      },
    });
    normalizedName = `cp4shadow${randomUUID().slice(0, 8)}`;
    displayName = "Cp4Shadow";
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName,
        displayName,
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "cp4-shadow-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "cp4-shadow-season",
          name: "CP4 Shadow Season",
          blizzardSeasonId: 999401,
          dungeonCount: 1,
          startsAt: new Date("2026-01-01"),
          isCurrent: true,
        },
      }));
    seasonId = season.id;

    const prev =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "cp4-prev-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "cp4-prev-season",
          name: "CP4 Prev Season",
          blizzardSeasonId: 999400,
          startsAt: new Date("2025-01-01"),
          endsAt: new Date("2025-12-01"),
          isCurrent: false,
        },
      }));
    prevSeasonId = prev.id;

    const dungeon =
      (await prisma.dungeon.findUnique({ where: { slug: DUNGEON_SLUG } })) ??
      (await prisma.dungeon.create({
        data: { id: randomUUID(), slug: DUNGEON_SLUG, name: "Ara-Kara, City of Echoes" },
      }));
    dungeonId = dungeon.id;
    await prisma.seasonDungeon.upsert({
      where: { seasonId_dungeonId: { seasonId, dungeonId } },
      update: {},
      create: { seasonId, dungeonId, sortOrder: 0, baselineKeyLevel: 10 },
    });

    const model = await prisma.scoreModel.create({
      data: {
        id: randomUUID(),
        key: `cp4-shadow-${randomUUID().slice(0, 8)}`,
        version: 1,
        name: "cp4-shadow",
        status: "DRAFT",
        config: {},
      },
    });
    scoreModelId = model.id;

    // Experience history: provider states + current-season mythic run + RIO payload.
    const now = new Date("2026-08-01T10:00:00.000Z");
    await prisma.characterProviderState.upsert({
      where: {
        characterId_provider: { characterId, provider: "BLIZZARD" },
      },
      create: {
        characterId,
        provider: "BLIZZARD",
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: new Date("2026-08-02T10:00:00.000Z"),
      },
      update: {
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: new Date("2026-08-02T10:00:00.000Z"),
      },
    });
    await prisma.characterProviderState.upsert({
      where: {
        characterId_provider: { characterId, provider: "RAIDER_IO" },
      },
      create: {
        characterId,
        provider: "RAIDER_IO",
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: new Date("2026-08-02T10:00:00.000Z"),
        metadata: { raiderIoScore: 3100 },
      },
      update: {
        state: "OK",
        lastAttemptAt: now,
        lastSuccessAt: now,
        fetchedAt: now,
        expiresAt: new Date("2026-08-02T10:00:00.000Z"),
      },
    });

    const run = await prisma.mythicRun.create({
      data: {
        id: randomUUID(),
        seasonId,
        dungeonId,
        regionId: region.id,
        keyLevel: 12,
        completedAt: new Date("2026-07-20T10:00:00.000Z"),
        durationMs: 1_800_000,
        timed: true,
        scoreValue: 220,
        canonicalFingerprint: `cp4-${characterId}-run`,
      },
    });
    await prisma.runParticipant.create({
      data: {
        id: randomUUID(),
        runId: run.id,
        characterId,
        providerCharacterKey: `eu/${realmSlug}/${normalizedName}`,
        displayName,
        realmSlug,
        regionCode: "EU",
        role: "DPS",
        isTargetCharacter: true,
      },
    });
    // Prior-season local run for Experience priorSeasonCount.
    const priorRun = await prisma.mythicRun.create({
      data: {
        id: randomUUID(),
        seasonId: prevSeasonId,
        dungeonId,
        regionId: region.id,
        keyLevel: 10,
        completedAt: new Date("2025-06-01T10:00:00.000Z"),
        durationMs: 1_900_000,
        timed: true,
        scoreValue: 180,
        canonicalFingerprint: `cp4-${characterId}-prior`,
      },
    });
    await prisma.runParticipant.create({
      data: {
        id: randomUUID(),
        runId: priorRun.id,
        characterId,
        providerCharacterKey: `eu/${realmSlug}/${normalizedName}`,
        displayName,
        realmSlug,
        regionCode: "EU",
        role: "DPS",
        isTargetCharacter: true,
      },
    });

    const fields = buildMinimalCharacterFields();
    for (const name of [displayName, normalizedName]) {
      const fingerprint = buildRequestFingerprint({
        provider: "raiderio",
        region: "EU",
        endpointKey: "characters.profile",
        pathParams: {},
        queryParams: {
          region: "eu",
          realm: realmSlug,
          name,
          fields,
          schemaVersion: RAIDERIO_SCHEMA_VERSION,
        },
      });
      const profile = rioProfile(displayName, realmSlug);
      const contentHash = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
      const request = await prisma.externalRequest.upsert({
        where: { requestFingerprint: fingerprint },
        create: {
          provider: "RAIDER_IO",
          requestFingerprint: fingerprint,
          endpointKey: "characters.profile",
          method: "GET",
          requestedAt: now,
          completedAt: now,
          statusCode: 200,
          expiresAt: new Date("2026-08-02T10:00:00.000Z"),
        },
        update: {
          completedAt: now,
          statusCode: 200,
          expiresAt: new Date("2026-08-02T10:00:00.000Z"),
        },
      });
      await prisma.externalPayload.upsert({
        where: { provider_contentHash: { provider: "RAIDER_IO", contentHash } },
        create: {
          externalRequestId: request.id,
          provider: "RAIDER_IO",
          contentHash,
          payload: profile as object,
          fetchedAt: now,
          schemaVersion: RAIDERIO_SCHEMA_VERSION,
        },
        update: {
          externalRequestId: request.id,
          payload: profile as object,
          fetchedAt: now,
        },
      });
    }

    const { plan: built } = buildEvidenceAcquisitionPlanV2({
      scope: {
        characterId,
        seasonId,
        seasonSlug: "cp4-shadow-season",
        specializationId: null,
        classSlug: "mage",
        specSlug: "frost",
        role: "DPS",
        refreshContractHash: "rf-cp4-1",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: CUTOFF,
        highKeyPolicyId: "high-key-v1",
        activeDungeonSlugs: [DUNGEON_SLUG],
      },
      candidates: [
        {
          discoveryIdentity: { reportCode: REPORT_CODE, fightId: FIGHT_ID },
          reportRevision: null,
          dungeonSlug: DUNGEON_SLUG,
          keyLevel: 12,
          timed: true,
          runScore: 220,
          evidenceCompleteness: 1,
          completedAt: "2026-07-20T10:00:00.000Z",
          fightDurationMs: 600_000,
          actorId: 10,
          accessState: "PUBLIC",
          identityResolution: "RESOLVED",
          fightAccessible: true,
          hardError: false,
          discoverySource: "cp4-fixture",
        },
        {
          discoveryIdentity: { reportCode: REPORT_CODE_2, fightId: FIGHT_ID_2 },
          reportRevision: null,
          dungeonSlug: DUNGEON_SLUG,
          keyLevel: 11,
          timed: true,
          runScore: 200,
          evidenceCompleteness: 1,
          completedAt: "2026-07-21T10:00:00.000Z",
          fightDurationMs: 580_000,
          actorId: 10,
          accessState: "PUBLIC",
          identityResolution: "RESOLVED",
          fightAccessible: true,
          hardError: false,
          discoverySource: "cp4-fixture",
        },
      ],
      plannedAt: "2026-08-01T11:00:00.000Z",
    });
    plan = built;
    expect(plan.expectedSlotCount).toBe(2);
    expect(plan.slots).toHaveLength(2);
  });

  it("acquires typed facts, freezes manifest, finalizes four SHADOW dimensions", async () => {
    resetEnvCache();
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      RAW_ARTIFACTS_DIR: storeRoot,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_SELECTION_ENABLED: "true",
      SCORING_V2_EVIDENCE_FETCH_ENABLED: "true",
      SCORING_V2_DIMENSIONS_ENABLED: "true",
      SCORING_V2_PERFORMANCE_ENABLED: "true",
      SCORING_V2_SURVIVAL_ENABLED: "true",
      SCORING_V2_UTILITY_ENABLED: "true",
      SCORING_V2_EXPERIENCE_ENABLED: "true",
      SCORING_V2_PUBLICATION_ENABLED: "false",
      CALIBRATION_V2_ENABLED: "false",
    });

    // Defaults remain false in production schemas; this test enables only in-process.
    expect(env.SCORING_V2_PUBLICATION_ENABLED).toBe(false);
    expect(env.CALIBRATION_V2_ENABLED).toBe(false);

    const container = createWorkerContainer(env, { prisma });
    const repo = createEvidenceV2BatchRepository(prisma);
    container.repositories.evidenceV2Batch = repo;

    const publishedBefore = await prisma.characterPublishedScore.count({
      where: { characterId },
    });
    const jobsBefore = await prisma.ingestionJob.count({
      where: { characterId },
    });

    const refreshId = randomUUID();
    const { batch } = await repo.createBatch({
      characterId,
      seasonId,
      refreshId,
      scoreModelId,
      acquisitionPlan: plan,
      refreshGeneration: 1,
      parentIngestionJobId: null,
      correlationId: "cp4-shadow-e2e",
      enabledConsumers: ["PERFORMANCE", "SURVIVAL", "UTILITY"],
    });
    expect(batch.id).toBeTruthy();
    expect(plan.slots).toHaveLength(2);

    const firstSlotFingerprints: string[] = [];
    let primaryReportCode = REPORT_CODE;
    let primaryFightId = FIGHT_ID;
    let primaryBundle = buildSharedEvidenceBundle({
      reportCode: REPORT_CODE,
      fightId: FIGHT_ID,
    });

    for (const slot of plan.slots) {
      const claim = await repo.claimSlot({
        batchId: batch.id,
        slotId: slot.slotId,
        refreshGeneration: 1,
      });
      expect(claim.outcome).toBe("claimed");

      const candidate = slot.orderedCandidates[0]!;
      const reportCode = candidate.discoveryIdentity.reportCode;
      const fightId = candidate.discoveryIdentity.fightId;
      const bundle = buildSharedEvidenceBundle({ reportCode, fightId });
      if (slot.slotIndex === 0) {
        primaryReportCode = reportCode;
        primaryFightId = fightId;
        primaryBundle = bundle;
      }

      const transport = new FixtureScoringV2EvidenceTransport({
        fightDetails: {
          data: {
            reportRevision: REPORT_REVISION,
            fight: { startTime: 0, endTime: 600_000 },
          },
          reportRevision: REPORT_REVISION,
          playerActorId: 10,
          ownedPetActorIds: [],
          startTime: 0,
          endTime: 600_000,
          dungeonSlug: DUNGEON_SLUG,
          providerCalls: 1,
        },
        sharedEvidence: {
          bundle,
          providerCalls: 1,
          cacheHits: 0,
          unavailableReason: null,
        },
        rankingParse: {
          evidence: rankingEvidence(reportCode, fightId),
          providerCalls: 1,
          unavailableReason: null,
        },
      });

      const acquired = await acquireCandidateWithFallback({
        container,
        candidates: slot.orderedCandidates,
        region: "EU",
        targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
        correlationId: "cp4-shadow-e2e",
        shouldCancel: async () => false,
        evidence: container.repositories.evidence,
        artifacts: container.repositories.artifacts,
        manifestSlotIdForPersistence: null,
        characterId,
        datasetRequirements: resolveBatchDatasetRequirements([
          "PERFORMANCE",
          "SURVIVAL",
          "UTILITY",
        ]),
        slotContext: {
          slotId: slot.slotId,
          dungeonSlug: slot.dungeonSlug,
          slotIndex: slot.slotIndex,
        },
        transport,
        classSlug: "mage",
        specSlug: "frost",
      });

      transport.assertNoNetworkReachable();
      expect(acquired.result.acquisitionStatus).toBe("ACQUIRED");
      expect(acquired.result.reportRevision).toBe(REPORT_REVISION);
      // Per-slot shared datasets are acquired once (not thrice for three dimensions).
      expect(transport.getProviderCallCounts().sharedEvidence).toBe(1);

      const byDim = Object.fromEntries(
        acquired.typedFactPayloads.map((p) => [p.dimension, p]),
      );
      expect(byDim.PERFORMANCE?.status).toBe("WRITTEN");
      expect(byDim.SURVIVAL?.status).toBe("WRITTEN");
      expect(byDim.UTILITY?.status).toBe("WRITTEN");
      expect(
        acquired.typedFactPayloads.every((p) => {
          if (p.facts == null) return true;
          return (p.facts as { kind?: string }).kind !== "shadow_placeholder";
        }),
      ).toBe(true);

      firstSlotFingerprints.push(acquired.factSetFingerprint);
      const status =
        byDim.PERFORMANCE?.status === "WRITTEN" &&
        byDim.SURVIVAL?.status === "WRITTEN" &&
        byDim.UTILITY?.status === "WRITTEN"
          ? ("SUCCEEDED" as const)
          : ("PARTIAL" as const);

      await repo.completeSlot({
        batchId: batch.id,
        slotId: slot.slotId,
        status,
        acquisitionResult: acquired.result,
        acquiredDiscoveryKey: `${reportCode}:${fightId}`,
        datasetCompatibilityKeys: acquired.datasetCompatibilityKeys,
        factSetFingerprint: acquired.factSetFingerprint,
        typedFactPayloads: acquired.typedFactPayloads,
      });
    }

    const ready = await repo.getById(batch.id);
    expect(ready?.batch.finalizationStatus).toBe("READY_TO_FINALIZE");
    expect(ready?.meta.publicationBlocked).toBe(true);
    expect(ready?.batch.terminalRunCount).toBe(2);

    const finalized = await runFinalizeEvidenceBatchV2(container, {
      schemaVersion: "2.0.0",
      analysisBatchId: batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      expectedTerminalSlotCount: 2,
      refreshGeneration: 1,
      requestedAt: new Date().toISOString(),
      correlationId: "cp4-shadow-e2e",
    });
    expect(finalized.outcome).toBe("finalized");
    expect(finalized.manifestId).toBeTruthy();

    const manifest = await prisma.evidenceManifest.findUnique({
      where: { id: finalized.manifestId! },
      include: { slots: true },
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.contentHash).toBe(finalized.manifestContentHash);
    expect(manifest!.slots.length).toBe(2);
    for (const mSlot of manifest!.slots) {
      expect(mSlot.reportRevision).toBe(REPORT_REVISION);
      expect([REPORT_CODE, REPORT_CODE_2]).toContain(mSlot.reportCode);
      expect([FIGHT_ID, FIGHT_ID_2]).toContain(mSlot.fightId);
    }
    const primaryManifestSlot = manifest!.slots.find(
      (s) => s.reportCode === primaryReportCode && s.fightId === primaryFightId,
    )!;
    expect(primaryManifestSlot).toBeTruthy();

    const factSets = await prisma.runFactSet.findMany({
      where: { manifestSlotId: { in: manifest!.slots.map((s) => s.id) } },
    });
    expect(factSets.some((f) => f.extractorFamily === PERFORMANCE_V2_EXTRACTOR_FAMILY)).toBe(
      true,
    );
    expect(factSets.some((f) => f.extractorFamily === SURVIVAL_V2_EXTRACTOR_FAMILY)).toBe(true);
    expect(factSets.some((f) => f.extractorFamily === UTILITY_V2_EXTRACTOR_FAMILY)).toBe(true);
    for (const fs of factSets) {
      const facts = fs.facts as Record<string, unknown>;
      expect(facts.kind).not.toBe("shadow_placeholder");
    }

    const dims = await prisma.dimensionComputation.findMany({
      where: { characterId, seasonId, manifestId: finalized.manifestId! },
    });
    expect(dims).toHaveLength(4);
    const dimByKey = Object.fromEntries(dims.map((d) => [d.dimension, d]));
    for (const key of ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const) {
      const row = dimByKey[key];
      expect(row, key).toBeTruthy();
      expect(row!.state).toBe("SHADOW");
      expect(row!.score).not.toBeNull();
      const metrics = row!.metrics as Record<string, unknown>;
      expect(["AVAILABLE", "PARTIAL"]).toContain(metrics.availabilityState);
      expect(metrics.publicationBlocked).toBe(true);
    }
    // Stable CP4 report surface (scores vary only if fixtures/algorithms change).
    console.info(
      "CP4_DIM_SCORES",
      JSON.stringify(
        Object.fromEntries(
          dims.map((d) => [
            d.dimension,
            {
              score: String(d.score),
              confidence: String(d.confidence),
              availability: (d.metrics as { availabilityState?: string }).availabilityState,
              state: d.state,
            },
          ]),
        ),
      ),
    );

    // Determinism: replay finalize is already_finalized; fingerprints/scores stable.
    const reFinalize = await runFinalizeEvidenceBatchV2(container, {
      schemaVersion: "2.0.0",
      analysisBatchId: batch.id,
      acquisitionPlanContentHash: plan.contentHash,
      expectedTerminalSlotCount: 2,
      refreshGeneration: 1,
      requestedAt: new Date().toISOString(),
    });
    expect(reFinalize.outcome).toBe("already_finalized");
    expect(reFinalize.manifestContentHash).toBe(finalized.manifestContentHash);

    const dimsAgain = await prisma.dimensionComputation.findMany({
      where: { characterId, seasonId, manifestId: finalized.manifestId! },
    });
    expect(dimsAgain).toHaveLength(4);
    for (const row of dims) {
      const again = dimsAgain.find((d) => d.dimension === row.dimension)!;
      expect(again.inputFingerprint).toBe(row.inputFingerprint);
      expect(String(again.score)).toBe(String(row.score));
      expect(String(again.confidence)).toBe(String(row.confidence));
      expect((again.metrics as { availabilityState?: string }).availabilityState).toBe(
        (row.metrics as { availabilityState?: string }).availabilityState,
      );
    }

    // Re-acquire primary slot with identical fixture evidence → same fact-set fingerprint.
    const replayTransport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: {
          reportRevision: REPORT_REVISION,
          fight: { startTime: 0, endTime: 600_000 },
        },
        reportRevision: REPORT_REVISION,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: DUNGEON_SLUG,
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle: primaryBundle,
        providerCalls: 0,
        cacheHits: 3,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(primaryReportCode, primaryFightId),
        providerCalls: 0,
        unavailableReason: null,
      },
    });
    const primarySlot = plan.slots[0]!;
    const replayAcquired = await acquireCandidateWithFallback({
      container,
      candidates: primarySlot.orderedCandidates,
      region: "EU",
      targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      correlationId: "cp4-shadow-replay",
      shouldCancel: async () => false,
      evidence: container.repositories.evidence,
      artifacts: container.repositories.artifacts,
      manifestSlotIdForPersistence: null,
      characterId,
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: {
        slotId: primarySlot.slotId,
        dungeonSlug: primarySlot.dungeonSlug,
        slotIndex: primarySlot.slotIndex,
      },
      transport: replayTransport,
      classSlug: "mage",
      specSlug: "frost",
    });
    replayTransport.assertNoNetworkReachable();
    expect(replayAcquired.factSetFingerprint).toBe(firstSlotFingerprints[0]);
    expect(replayAcquired.providerCallTotal).toBe(0);

    // Experience evidenceRevision deterministic from persisted snapshot.
    const histA = buildExperienceHistoryFromPersistedEvidence({
      characterId,
      seasonId,
      seasonSlug: "cp4-shadow-season",
      regionCode: "EU",
      realmSlug,
      displayName,
      normalizedName,
      expectedDungeonCount: 1,
      evidenceCutoffAt: CUTOFF,
      previousSeasonId: prevSeasonId,
      previousSeasonSlug: "cp4-prev-season",
      providerStates: [
        {
          provider: "blizzard",
          state: "OK",
          lastSuccessAt: "2026-08-01T10:00:00.000Z",
          fetchedAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
          detail: null,
        },
        {
          provider: "raiderio",
          state: "OK",
          lastSuccessAt: "2026-08-01T10:00:00.000Z",
          fetchedAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
          detail: null,
        },
      ],
      currentSeasonRuns: [
        {
          seasonId,
          dungeonSlug: DUNGEON_SLUG,
          keyLevel: 12,
          completedAt: "2026-07-20T10:00:00.000Z",
          durationMs: 1_800_000,
          scoreValue: 220,
          canonicalFingerprint: `cp4-${characterId}-run`,
          timed: true,
        },
      ],
      localPriorSeasonIds: [prevSeasonId],
      rioProfile: {
        contentHash: "x",
        fetchedAt: "2026-08-01T10:00:00.000Z",
        stale: false,
        profile: rioProfile(displayName, realmSlug),
      },
      allowedDungeonSlugs: [DUNGEON_SLUG],
    });
    const histB = buildExperienceHistoryFromPersistedEvidence({
      characterId,
      seasonId,
      seasonSlug: "cp4-shadow-season",
      regionCode: "EU",
      realmSlug,
      displayName,
      normalizedName,
      expectedDungeonCount: 1,
      evidenceCutoffAt: CUTOFF,
      previousSeasonId: prevSeasonId,
      previousSeasonSlug: "cp4-prev-season",
      providerStates: [
        {
          provider: "blizzard",
          state: "OK",
          lastSuccessAt: "2026-08-01T10:00:00.000Z",
          fetchedAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
          detail: null,
        },
        {
          provider: "raiderio",
          state: "OK",
          lastSuccessAt: "2026-08-01T10:00:00.000Z",
          fetchedAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2026-08-02T10:00:00.000Z",
          detail: null,
        },
      ],
      currentSeasonRuns: [
        {
          seasonId,
          dungeonSlug: DUNGEON_SLUG,
          keyLevel: 12,
          completedAt: "2026-07-20T10:00:00.000Z",
          durationMs: 1_800_000,
          scoreValue: 220,
          canonicalFingerprint: `cp4-${characterId}-run`,
          timed: true,
        },
      ],
      localPriorSeasonIds: [prevSeasonId],
      rioProfile: {
        contentHash: "x",
        fetchedAt: "2026-08-01T10:00:00.000Z",
        stale: false,
        profile: rioProfile(displayName, realmSlug),
      },
      allowedDungeonSlugs: [DUNGEON_SLUG],
    });
    expect(histA.ok && histB.ok).toBe(true);
    if (histA.ok && histB.ok) {
      expect(histA.evidenceRevision).toBe(histB.evidenceRevision);
    }

    const publishedAfter = await prisma.characterPublishedScore.count({
      where: { characterId },
    });
    expect(publishedAfter).toBe(publishedBefore);

    const jobsAfter = await prisma.ingestionJob.count({
      where: { characterId },
    });
    expect(jobsAfter).toBe(jobsBefore);

    // Conflict safety on typed fact persistence.
    const perfFact = factSets.find(
      (f) =>
        f.extractorFamily === PERFORMANCE_V2_EXTRACTOR_FAMILY &&
        f.manifestSlotId === primaryManifestSlot.id,
    )!;
    const conflict = await persistTypedFactSet({
      evidence: container.repositories.evidence,
      logger: container.logger,
      characterId,
      manifestSlotId: primaryManifestSlot.id,
      reportCode: primaryReportCode,
      fightId: primaryFightId,
      reportRevision: REPORT_REVISION,
      payload: {
        dimension: "PERFORMANCE",
        status: "WRITTEN",
        extractorFamily: perfFact.extractorFamily,
        extractorVersion: perfFact.extractorVersion,
        schemaVersion: perfFact.schemaVersion,
        facts: { ...(perfFact.facts as object), parsePercentile: 1 },
        limitations: [],
        category: null,
        reason: null,
        artifactIds: [],
        coverage: {},
      },
    });
    expect(conflict.outcome).toBe("conflict");
    const still = await prisma.runFactSet.findFirst({
      where: { id: perfFact.id },
    });
    expect(still).not.toBeNull();
    expect((still!.facts as { parsePercentile?: number }).parsePercentile).not.toBe(1);

    const publishedFinal = await prisma.characterPublishedScore.count({
      where: { characterId },
    });
    expect(publishedFinal).toBe(publishedBefore);

    // Cache reuse: second acquisition with cacheHits → zero providerCalls.
    const cacheTransport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision: REPORT_REVISION },
        reportRevision: REPORT_REVISION,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: DUNGEON_SLUG,
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle: primaryBundle,
        providerCalls: 0,
        cacheHits: 3,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(primaryReportCode, primaryFightId),
        providerCalls: 0,
        unavailableReason: null,
      },
    });
    const cached = await acquireCandidateWithFallback({
      container,
      candidates: primarySlot.orderedCandidates,
      region: "EU",
      targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      correlationId: "cp4-cache",
      shouldCancel: async () => false,
      evidence: container.repositories.evidence,
      artifacts: container.repositories.artifacts,
      manifestSlotIdForPersistence: null,
      characterId,
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: {
        slotId: primarySlot.slotId,
        dungeonSlug: primarySlot.dungeonSlug,
        slotIndex: primarySlot.slotIndex,
      },
      transport: cacheTransport,
      classSlug: "mage",
      specSlug: "frost",
    });
    expect(cached.providerCallTotal).toBe(0);
    cacheTransport.assertNoNetworkReachable();
  });

  it("Performance UNAVAILABLE does not block Survival/Utility typed facts", async () => {
    const bundle = buildSharedEvidenceBundle({
      reportCode: REPORT_CODE,
      fightId: FIGHT_ID,
    });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision: REPORT_REVISION },
        reportRevision: REPORT_REVISION,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: DUNGEON_SLUG,
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 0,
        cacheHits: 1,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: null,
        providerCalls: 0,
        unavailableReason: "RANKING_PARSE_ABSENT",
      },
    });
    resetEnvCache();
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      RAW_ARTIFACTS_DIR: storeRoot,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_PUBLICATION_ENABLED: "false",
    });
    const container = createWorkerContainer(env, { prisma });
    const acquired = await acquireCandidateWithFallback({
      container,
      candidates: [
        {
          discoveryIdentity: { reportCode: REPORT_CODE, fightId: FIGHT_ID },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 220,
          evidenceCompleteness: 1,
          completedAt: "2026-07-20T10:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      correlationId: null,
      shouldCancel: async () => false,
      evidence: container.repositories.evidence,
      artifacts: container.repositories.artifacts,
      manifestSlotIdForPersistence: null,
      characterId,
      datasetRequirements: resolveBatchDatasetRequirements([
        "PERFORMANCE",
        "SURVIVAL",
        "UTILITY",
      ]),
      slotContext: { slotId: `${DUNGEON_SLUG}:iso`, dungeonSlug: DUNGEON_SLUG, slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });
    const byDim = Object.fromEntries(
      acquired.typedFactPayloads.map((p) => [p.dimension, p]),
    );
    expect(byDim.PERFORMANCE?.status).toBe("UNAVAILABLE");
    expect(byDim.SURVIVAL?.status).toBe("WRITTEN");
    expect(byDim.UTILITY?.status).toBe("WRITTEN");
    transport.assertNoNetworkReachable();
  });

  it("Utility bound zero-observation remains WRITTEN (floor semantics preserved upstream)", async () => {
    let bundle = buildSharedEvidenceBundle({
      reportCode: REPORT_CODE,
      fightId: FIGHT_ID,
    });
    // Strip player casts/interrupts → bound zero observations for utility actions.
    bundle = attachDatasetToBundle(bundle, okDataset("Casts", []), { fromPersisted: true });
    bundle = attachDatasetToBundle(bundle, okDataset("Interrupts", []), {
      fromPersisted: true,
    });
    const transport = new FixtureScoringV2EvidenceTransport({
      fightDetails: {
        data: { reportRevision: REPORT_REVISION },
        reportRevision: REPORT_REVISION,
        playerActorId: 10,
        ownedPetActorIds: [],
        startTime: 0,
        endTime: 600_000,
        dungeonSlug: DUNGEON_SLUG,
        providerCalls: 0,
      },
      sharedEvidence: {
        bundle,
        providerCalls: 0,
        cacheHits: 1,
        unavailableReason: null,
      },
      rankingParse: {
        evidence: rankingEvidence(REPORT_CODE, FIGHT_ID),
        providerCalls: 0,
        unavailableReason: null,
      },
    });
    resetEnvCache();
    const env = loadEnv({
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      ADMIN_API_KEY: "test-admin-key",
      SESSION_SECRET: "test-session-secret-at-least-32-chars",
      PROVIDER_MODE: "fixture",
      WEB_ORIGIN: "http://localhost:5173",
      PUBLIC_BASE_URL: "http://localhost:3000",
      RAW_ARTIFACTS_DIR: storeRoot,
      SCORING_V2_ENABLED: "true",
      SCORING_V2_PUBLICATION_ENABLED: "false",
    });
    const container = createWorkerContainer(env, { prisma });
    const acquired = await acquireCandidateWithFallback({
      container,
      candidates: [
        {
          discoveryIdentity: { reportCode: REPORT_CODE, fightId: FIGHT_ID },
          rank: 0,
          keyLevel: 12,
          timed: true,
          runScore: 220,
          evidenceCompleteness: 1,
          completedAt: "2026-07-20T10:00:00.000Z",
          actorId: 10,
        },
      ],
      region: "EU",
      targetCharacter: { region: "EU", realmSlug: "archimonde", name: "Wallidrixe" },
      correlationId: null,
      shouldCancel: async () => false,
      evidence: container.repositories.evidence,
      artifacts: container.repositories.artifacts,
      manifestSlotIdForPersistence: null,
      characterId,
      datasetRequirements: resolveBatchDatasetRequirements(["UTILITY"]),
      slotContext: { slotId: `${DUNGEON_SLUG}:0`, dungeonSlug: DUNGEON_SLUG, slotIndex: 0 },
      transport,
      classSlug: "mage",
      specSlug: "frost",
    });
    const util = acquired.typedFactPayloads.find((p) => p.dimension === "UTILITY");
    expect(util?.status).toBe("WRITTEN");
    transport.assertNoNetworkReachable();
  });
});
