/**
 * DB-backed Scoring V2 evidence audit integration (provider-free).
 * Requires `pnpm test:integration` (isolated DB + seed).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalFsArtifactStore } from "@mplus/artifact-store";
import {
  ArtifactRepository,
  checkDatabaseHealth,
  createPrismaClient,
  EvidenceRepository,
  WclSourceRepository,
  type PrismaClient,
} from "@mplus/database";
import { buildscoringEvidenceAudit } from "@mplus/scoring";
import { assertTestDatabaseAllowed, sanitizeDatabaseUrl } from "@mplus/test-utils";

const databaseUrl = process.env.DATABASE_URL ?? "";
assertTestDatabaseAllowed(databaseUrl);

const prisma: PrismaClient = createPrismaClient(databaseUrl);
const health = await checkDatabaseHealth(prisma);
const dbAvailable = health.ok;

if (!dbAvailable) {
  console.warn(
    `Skipping evidence-audit integration: PostgreSQL not reachable at ${sanitizeDatabaseUrl(databaseUrl)}.`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe.runIf(dbAvailable)("scoring v2 evidence audit persistence integration", () => {
  let characterId: string;
  let seasonId: string;
  let evidence: EvidenceRepository;
  let wclSource: WclSourceRepository;
  let artifacts: ArtifactRepository;
  const dungeonSlugs = Array.from({ length: 8 }, (_, i) => `audit-lineage-d${i + 1}`);

  beforeAll(async () => {
    const storeRoot = await mkdtemp(path.join(tmpdir(), "mplus-v2-audit-"));
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
      where: { regionId: region.id, slug: "v2-audit-lineage-realm" },
    });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-audit-lineage-realm",
          name: "V2 Audit Lineage Realm",
        },
      });
    }
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region.id,
        realmId: realm.id,
        normalizedName: `v2auditln${randomUUID().slice(0, 8)}`,
        displayName: "V2AuditLineage",
        role: "DPS",
      },
    });
    characterId = character.id;

    const season =
      (await prisma.season.findFirst({
        where: { regionId: region.id, slug: "v2-audit-lineage-season" },
      })) ??
      (await prisma.season.create({
        data: {
          id: randomUUID(),
          regionId: region.id,
          slug: "v2-audit-lineage-season",
          name: "V2 Audit Lineage Season",
          blizzardSeasonId: 999302,
          startsAt: new Date("2026-01-01"),
        },
      }));
    seasonId = season.id;

    for (const slug of dungeonSlugs) {
      await prisma.dungeon.upsert({
        where: { slug },
        update: {},
        create: { id: randomUUID(), slug, name: slug },
      });
    }
  }, 60_000);

  it("persists 16 distinct identities, zero-event pages, and audits without duplicates", async () => {
    const dungeons = await prisma.dungeon.findMany({
      where: { slug: { in: dungeonSlugs } },
    });
    const dungeonBySlug = new Map(dungeons.map((d) => [d.slug, d.id]));

    const slots = dungeonSlugs.flatMap((slug, di) => {
      const base = (di + 1) * 100;
      return [
        {
          dungeonId: dungeonBySlug.get(slug)!,
          slotIndex: 0,
          reportCode: `LN${base}A`,
          fightId: base + 1,
          reportRevision: 1,
          state: "SELECTED",
          keyLevel: 14,
          candidateRank: 0,
          selectionReason: "preferred",
        },
        {
          dungeonId: dungeonBySlug.get(slug)!,
          slotIndex: 1,
          reportCode: `LN${base}B`,
          fightId: base + 2,
          reportRevision: 1,
          state: "SELECTED",
          keyLevel: 12,
          candidateRank: 0,
          selectionReason: "preferred",
        },
      ];
    });

    const contentHash = sha(`audit-lineage-${randomUUID()}`);
    const document = {
      schemaVersion: "2.0.0",
      selectorVersion: "evidence-selector-v2.0.0",
      characterId,
      seasonId,
      seasonSlug: "v2-audit-lineage-season",
      classSlug: null,
      specSlug: null,
      role: "DPS",
      refreshContractHash: "rf-audit-lineage",
      evidenceCutoffAt: "2030-01-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: dungeonSlugs,
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      selectedAt: "2026-08-01T12:00:00.000Z",
      acquisitionPlanContentHash: "plan-audit",
      slots: slots.map((s, i) => ({
        slotId: `${dungeonSlugs[Math.floor(i / 2)]}:${s.slotIndex}`,
        dungeonSlug: dungeonSlugs[Math.floor(i / 2)]!,
        slotIndex: s.slotIndex as 0 | 1,
        state: "SELECTED" as const,
        identity: {
          reportCode: s.reportCode,
          fightId: s.fightId,
          reportRevision: s.reportRevision,
        },
        keyLevel: s.keyLevel,
        timed: true,
        runScore: 400,
        completedAt: "2026-07-01T12:00:00.000Z",
        actorId: 1,
        dimensionValidity: {
          performance: "PARTIAL" as const,
          survival: "VALID" as const,
          utility: "VALID" as const,
          reasons: [] as string[],
        },
        selectedRank: 0,
        fallbackReason: null,
        datasetHashes: [{ dataset: "CASTS" as const, contentHash: sha(`casts-${s.reportCode}`) }],
        factSetHash: sha(`facts-${s.reportCode}:${s.fightId}`),
      })),
      rejectedCandidates: [],
      coverage: {
        state: "FULL" as const,
        expectedSlotCount: 16,
        selectedSlotCount: 16,
        dungeonCount: 8,
        dungeonsRepresented: 8,
        slotFillRatio: 1,
        dungeonFillRatio: 1,
      },
      contentHash,
      diagnostics: {
        candidatesConsidered: 16,
        candidatesEligible: 16,
        candidatesRejected: 0,
        rejectionReasonCounts: {},
        perDungeon: [],
      },
    };

    const { manifest, slots: persistedSlots } = await evidence.createFrozenManifest({
      characterId,
      seasonId,
      role: "DPS",
      refreshContractHash: "rf-audit-lineage",
      selectorVersion: "evidence-selector-v2.0.0",
      highKeyPolicyId: "high-key-v1",
      evidenceCutoffAt: new Date("2030-01-01T00:00:00.000Z"),
      expectedSlotCount: 16,
      selectedSlotCount: 16,
      coverageState: "FULL",
      schemaVersion: "2.0.0",
      contentHash,
      document,
      frozenAt: new Date("2026-08-01T12:00:00.000Z"),
      slots,
    });

    expect(persistedSlots).toHaveLength(16);

    const first = persistedSlots[0]!;
    const pageArtifact = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ events: [] })),
      compression: "GZIP",
      owner: { ownerType: "EvidenceDatasetPage", ownerId: randomUUID() },
    });
    const summaryArtifact = await artifacts.persist({
      provider: "WARCRAFT_LOGS",
      bytes: Buffer.from(JSON.stringify({ eventCount: 0 })),
      compression: "GZIP",
      owner: { ownerType: "EvidenceDataset", ownerId: randomUUID() },
    });

    const dataset = await evidence.createDataset({
      manifestSlotId: first.id,
      datasetKey: "Casts",
      compatibilityKey: `${first.reportCode}:${first.fightId}:${first.reportRevision}:CASTS:wcl-graphql-v2-events`,
      artifactId: summaryArtifact.artifactId,
      schemaVersion: "1.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
      state: "PERSISTED",
      eventCount: 0,
      pageCount: 1,
      truncated: false,
      payloadFingerprint: sha("casts-zero-events"),
    });

    await wclSource.createEvidenceDatasetPage({
      datasetId: dataset.id,
      reportCode: first.reportCode!,
      fightId: first.fightId!,
      reportRevision: first.reportRevision!,
      datasetKey: "Casts",
      pageIndex: 0,
      artifactId: pageArtifact.artifactId,
      contentHash: sha("casts-zero-events"),
      providerContractVersion: "wcl-graphql-v2-events",
      schemaVersion: "1.0.0",
      scopeFingerprint: "scope:unscoped",
      eventCount: 0,
    });
    await wclSource.createEvidenceDatasetPage({
      datasetId: dataset.id,
      reportCode: first.reportCode!,
      fightId: first.fightId!,
      reportRevision: first.reportRevision!,
      datasetKey: "Casts",
      pageIndex: 0,
      artifactId: pageArtifact.artifactId,
      contentHash: sha("casts-zero-events"),
      providerContractVersion: "wcl-graphql-v2-events",
      schemaVersion: "1.0.0",
      scopeFingerprint: "scope:unscoped",
      eventCount: 0,
    });

    const pageCount = await prisma.evidenceDatasetPage.count({
      where: {
        reportCode: first.reportCode!,
        fightId: first.fightId!,
        reportRevision: first.reportRevision!,
        datasetKey: "Casts",
        pageIndex: 0,
        scopeFingerprint: "scope:unscoped",
      },
    });
    expect(pageCount).toBe(1);

    const loaded = await prisma.evidenceManifest.findUniqueOrThrow({
      where: { id: manifest.id },
      include: {
        slots: {
          include: {
            dungeon: true,
            datasets: { include: { pages: true } },
            factSets: true,
          },
        },
      },
    });

    const audit = buildscoringEvidenceAudit({
      manifestId: loaded.id,
      characterId: loaded.characterId,
      seasonId: loaded.seasonId,
      manifestDocument: loaded.document,
      coverageState: loaded.coverageState,
      expectedSlotCount: loaded.expectedSlotCount,
      selectedSlotCount: loaded.selectedSlotCount,
      auditedAt: "2026-08-04T12:00:00.000Z",
      slotRows: loaded.slots.map((s) => ({
        id: s.id,
        dungeonSlug: s.dungeon.slug,
        slotIndex: s.slotIndex,
        state: s.state,
        reportCode: s.reportCode,
        fightId: s.fightId,
        reportRevision: s.reportRevision,
        keyLevel: s.keyLevel,
        selectionReason: s.selectionReason,
        candidateRank: s.candidateRank,
      })),
      datasets: loaded.slots.flatMap((s) =>
        s.datasets.map((d) => ({
          id: d.id,
          manifestSlotId: d.manifestSlotId,
          datasetKey: d.datasetKey,
          compatibilityKey: d.compatibilityKey,
          artifactId: d.artifactId,
          schemaVersion: d.schemaVersion,
          providerContractVersion: d.providerContractVersion,
          state: d.state,
          eventCount: d.eventCount,
          pageCount: d.pageCount,
          truncated: d.truncated,
          payloadFingerprint: d.payloadFingerprint,
          pages: d.pages.map((p) => ({
            pageIndex: p.pageIndex,
            artifactId: p.artifactId,
            contentHash: p.contentHash,
            eventCount: p.eventCount,
            scopeFingerprint: p.scopeFingerprint,
            reportCode: p.reportCode,
            fightId: p.fightId,
            reportRevision: p.reportRevision,
            datasetKey: p.datasetKey,
          })),
        })),
      ),
      factSets: loaded.slots.flatMap((s) =>
        s.factSets.map((fs) => ({
          id: fs.id,
          manifestSlotId: fs.manifestSlotId,
          extractorFamily: fs.extractorFamily,
          extractorVersion: fs.extractorVersion,
          schemaVersion: fs.schemaVersion,
          inputFingerprint: fs.inputFingerprint,
          facts: fs.facts,
          coverage: fs.coverage,
          limitations: fs.limitations,
          relationReportCode: s.reportCode,
          relationFightId: s.fightId,
          relationReportRevision: s.reportRevision,
          dungeonSlug: s.dungeon.slug,
          slotIndex: s.slotIndex,
        })),
      ),
      dimensions: [],
      masterDataByIdentity: [],
      pagesByIdentity: [],
    });

    expect(audit.slots).toHaveLength(16);
    expect(audit.providerCallCount).toBe(0);
    const identities = new Set(
      audit.slots
        .filter((s) => s.reportCode && s.fightId != null)
        .map((s) => `${s.reportCode}:${s.fightId}`),
    );
    expect(identities.size).toBe(16);

    const zeroEvent = audit.slots
      .flatMap((s) => s.eventDatasets)
      .find((d) => d.datasetKind === "CASTS" && d.rowPresent);
    expect(zeroEvent?.persistenceState).toBe("ZERO_EVENT");
  });
});
