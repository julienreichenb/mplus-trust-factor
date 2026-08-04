/**
 * Cross-manifest EvidenceDataset binding at the repository/schema layer.
 * Same compatibilityKey may bind to multiple frozen slots when content matches.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalFsArtifactStore } from "@mplus/artifact-store";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";
import {
  ArtifactRepository,
  checkDatabaseHealth,
  createPrismaClient,
  EvidenceRepository,
  WclSourceRepository,
  type PrismaClient,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping cross-manifest dataset tests: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.runIf(dbAvailable)("cross-manifest EvidenceDataset reuse", () => {
  let characterId: string;
  let seasonId: string;
  let dungeonId: string;
  let artifacts: ArtifactRepository;
  let evidence: EvidenceRepository;
  let wclSource: WclSourceRepository;

  beforeAll(async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), "mplus-xmanifest-"));
    artifacts = new ArtifactRepository(prisma, createLocalFsArtifactStore(storeRoot));
    evidence = new EvidenceRepository(prisma);
    wclSource = new WclSourceRepository(prisma);

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
      where: { regionId: region.id, slug: "xmanifest-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "xmanifest-realm",
          name: "XManifest Realm",
        },
      });
    }
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `xmanifest${randomUUID().slice(0, 8)}`,
        displayName: "XManifest",
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "xmanifest-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "xmanifest-season",
          name: "XManifest Season",
          blizzardSeasonId: 999202,
          startsAt: new Date("2026-01-01"),
        },
      }));
    seasonId = season.id;

    const dungeon =
      (await prisma.dungeon.findUnique({ where: { slug: "xmanifest-dungeon" } })) ??
      (await prisma.dungeon.create({
        data: { id: randomUUID(), slug: "xmanifest-dungeon", name: "XManifest Dungeon" },
      }));
    dungeonId = dungeon.id;
  });

  it("allows two manifests to bind the same compatibilityKey to distinct slot rows", async () => {
    const reportCode = `Xm${randomUUID().slice(0, 14)}`;
    const fightId = 7;
    const reportRevision = 1;
    const compatibilityKey = `${reportCode}:${fightId}:${reportRevision}:CASTS:wcl-graphql-v2-events`;
    const payloadFingerprint = createHash("sha256").update("casts-page-1").digest("hex");

    const pageArtifact = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ events: [{ id: 1 }] })),
      compression: "GZIP",
      owner: { ownerType: "EvidenceDatasetPage", ownerId: randomUUID() },
    });
    const summaryArtifact = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ schemaVersion: "2.0.0", eventCount: 12 })),
      compression: "GZIP",
      owner: { ownerType: "EvidenceDataset", ownerId: randomUUID() },
    });

    await wclSource.createEvidenceDatasetPage({
      reportCode,
      fightId,
      reportRevision,
      datasetKey: "Casts",
      pageIndex: 0,
      artifactId: pageArtifact.artifactId,
      contentHash: payloadFingerprint,
      providerContractVersion: "wcl-graphql-v2-events",
      schemaVersion: "2.0.0",
      eventCount: 12,
    });

    async function freezeManifest(label: string) {
      const contentHash = createHash("sha256")
        .update(`xmanifest-${label}-${randomUUID()}`)
        .digest("hex");
      return evidence.createFrozenManifest({
        characterId,
        seasonId,
        role: "DPS",
        refreshContractHash: `rf-${label}`,
        selectorVersion: "evidence-selector-v2.0.0",
        highKeyPolicyId: "high-key-v1",
        evidenceCutoffAt: new Date("2026-08-01T00:00:00.000Z"),
        expectedSlotCount: 1,
        selectedSlotCount: 1,
        coverageState: "PARTIAL",
        schemaVersion: "2.0.0",
        contentHash,
        document: { schemaVersion: "2.0.0", label },
        frozenAt: new Date(),
        slots: [
          {
            dungeonId,
            slotIndex: 0,
            reportCode,
            fightId,
            reportRevision,
            state: "SELECTED",
            keyLevel: 12,
            selectionReason: "SELECTED",
          },
        ],
      });
    }

    const sharedCreate = {
      datasetKey: "casts",
      compatibilityKey,
      artifactId: summaryArtifact.artifactId,
      schemaVersion: "2.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
      state: "READY",
      eventCount: 12,
      pageCount: 1,
      truncated: false,
      payloadFingerprint,
      fetchedAt: new Date("2026-08-04T12:00:00.000Z"),
      costSource: "wcl",
    };

    const manifestA = await freezeManifest("A");
    const slotA = manifestA.slots[0]!;
    const dsA = await evidence.createDataset({
      ...sharedCreate,
      manifestSlotId: slotA.id,
    });
    await wclSource.attachDatasetIdToPages({
      pageIds: (
        await wclSource.findEvidenceDatasetPages({
          reportCode,
          fightId,
          reportRevision,
          datasetKey: "Casts",
        })
      )
        .filter((p) => p.datasetId == null)
        .map((p) => p.id),
      datasetId: dsA.id,
    });

    const manifestB = await freezeManifest("B");
    const slotB = manifestB.slots[0]!;
    // Same compatibilityKey on a new slot must succeed (no global unique).
    const dsB = await evidence.createDataset({
      ...sharedCreate,
      manifestSlotId: slotB.id,
    });
    expect(dsB.id).not.toBe(dsA.id);
    expect(dsB.compatibilityKey).toBe(dsA.compatibilityKey);
    expect(dsB.artifactId).toBe(dsA.artifactId);

    const peers = await evidence.findDatasetsByCompatibilityKey(compatibilityKey);
    expect(peers).toHaveLength(2);

    // Slot uniqueness still enforced.
    await expect(
      evidence.createDataset({
        ...sharedCreate,
        manifestSlotId: slotB.id,
        compatibilityKey: `${compatibilityKey}:other`,
      }),
    ).rejects.toThrow();

    // Pages not fabricated — still one page, discoverable by report identity.
    const pages = await wclSource.findEvidenceDatasetPages({
      reportCode,
      fightId,
      reportRevision,
      datasetKey: "Casts",
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.artifactId).toBe(pageArtifact.artifactId);

    const exportA = await prisma.evidenceManifest.findUnique({
      where: { id: manifestA.manifest.id },
      include: { slots: { include: { datasets: true } } },
    });
    const exportB = await prisma.evidenceManifest.findUnique({
      where: { id: manifestB.manifest.id },
      include: { slots: { include: { datasets: true } } },
    });
    expect(exportA!.slots[0]!.datasets).toHaveLength(1);
    expect(exportB!.slots[0]!.datasets).toHaveLength(1);
    expect(exportB!.slots[0]!.datasets[0]!.datasetKey).toBe("casts");
  });
});
