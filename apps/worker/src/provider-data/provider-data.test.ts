import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_DATA_DENYLIST_TABLES,
  PROVIDER_DATA_EXPORT_TABLES,
  PROVIDER_DATA_SCHEMA_VERSION,
} from "./allowlist.js";
import { buildManifest, buildProviderDataCorpus, type ProviderDataCorpus } from "./build-corpus.js";
import { canonicalJsonStringify, hashCanonicalPayload } from "./canonical.js";
import { exportProviderDataBundle } from "./export-bundle.js";
import { importProviderDataBundle, ProviderDataImportError, readProviderDataBundle } from "./import-bundle.js";

function emptyTables(): Record<string, Array<Record<string, unknown>>> {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of PROVIDER_DATA_EXPORT_TABLES) tables[t] = [];
  return tables;
}

function makePrismaStore(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const store: Record<string, Array<Record<string, unknown>>> = { ...emptyTables(), ...seed };
  const imports: Array<Record<string, unknown>> = [];

  const findMany = (table: string) => async () => [...(store[table] ?? [])];
  const findUnique =
    (table: string) =>
    async ({ where }: { where: Record<string, unknown> }) => {
      const rows = store[table] ?? [];
      if ("id" in where) return rows.find((r) => r.id === where.id) ?? null;
      if ("seasonId_dungeonId" in where) {
        const key = where.seasonId_dungeonId as { seasonId: string; dungeonId: string };
        return (
          rows.find((r) => r.seasonId === key.seasonId && r.dungeonId === key.dungeonId) ?? null
        );
      }
      return null;
    };
  const findFirst =
    (table: string) =>
    async ({ where }: { where: Record<string, unknown> }) => {
      const rows = store[table] ?? [];
      return (
        rows.find((r) =>
          Object.entries(where).every(([k, v]) => (r[k] ?? null) === (v ?? null)),
        ) ?? null
      );
    };
  const create =
    (table: string) =>
    async ({ data }: { data: Record<string, unknown> }) => {
      store[table] = store[table] ?? [];
      store[table]!.push({ ...data });
      return data;
    };
  const update =
    (table: string) =>
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const rows = store[table] ?? [];
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx < 0) throw new Error(`missing ${table} ${where.id}`);
      rows[idx] = { ...rows[idx], ...data };
      return rows[idx];
    };

  const model = (table: string) => ({
    findMany: findMany(table),
    findUnique: findUnique(table),
    findFirst: findFirst(table),
    create: create(table),
    update: update(table),
  });

  const prisma = {
    region: model("regions"),
    realm: model("realms"),
    gameClass: model("game_classes"),
    gameSpecialization: model("game_specializations"),
    season: model("seasons"),
    dungeon: model("dungeons"),
    seasonDungeon: model("season_dungeons"),
    scoreModel: model("score_models"),
    redFlagDefinition: model("red_flag_definitions"),
    character: model("characters"),
    characterAlias: model("character_aliases"),
    characterProviderState: model("character_provider_states"),
    seasonMedianKeyDistributionSnapshot: model("season_median_key_distribution_snapshots"),
    seasonScoreContextRevision: model("season_score_context_revisions"),
    scoreContextRevisionRegionSnapshot: model("score_context_revision_region_snapshots"),
    wclRunRaw: model("wcl_run_raw"),
    characterRunDigest: model("character_run_digests"),
    runRankingFact: model("run_ranking_facts"),
    wclFightRankingSnapshot: model("wcl_fight_ranking_snapshots"),
    wclFightRankingEntry: model("wcl_fight_ranking_entries"),
    characterPerformanceAggregate: model("character_performance_aggregates"),
    characterExperienceEvidence: model("character_experience_evidence"),
    characterScore: model("character_scores"),
    scoreSnapshot: model("score_snapshots"),
    dimensionScore: model("dimension_scores"),
    characterPublishedScore: model("character_published_scores"),
    characterRedFlag: model("character_red_flags"),
    providerDataImport: {
      findUnique: async ({ where }: { where: { contentHash: string } }) =>
        imports.find((r) => r.contentHash === where.contentHash) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        imports.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    _store: store,
    _imports: imports,
  };

  return prisma;
}

describe("provider-data allowlist", () => {
  it("never overlaps denylist", () => {
    const denied = new Set(PROVIDER_DATA_DENYLIST_TABLES);
    for (const table of PROVIDER_DATA_EXPORT_TABLES) {
      expect(denied.has(table as never)).toBe(false);
    }
  });

  it("denies auth / jobs / runtime settings / import metadata", () => {
    expect(PROVIDER_DATA_DENYLIST_TABLES).toEqual(
      expect.arrayContaining([
        "users",
        "user_sessions",
        "battle_net_accounts",
        "runtime_settings",
        "ingestion_jobs",
        "provider_data_imports",
      ]),
    );
  });
});

describe("canonical hash", () => {
  it("is deterministic for the same corpus", () => {
    const corpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: { regions: [{ id: "a", code: "EU" }] },
    };
    expect(hashCanonicalPayload(corpus)).toBe(hashCanonicalPayload(corpus));
    expect(hashCanonicalPayload(corpus)).toBe(
      hashCanonicalPayload(JSON.parse(canonicalJsonStringify(corpus))),
    );
  });
});

describe("exportProviderDataBundle", () => {
  const dirs: string[] = [];
  afterEach(() => {
    // temp dirs cleaned by OS; keep list for clarity
    dirs.length = 0;
  });

  it("writes manifest + gzip payload with matching contentHash and no denylist tables", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-export-"));
    dirs.push(dir);
    const prisma = makePrismaStore({
      regions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "EU",
          name: "Europe",
          enabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      score_snapshots: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          characterId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          seasonId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          scoreModelId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          scopeType: "SEASON",
          scopeKey: null,
          overallScore: "10.0000",
          grade: "B",
          skillScore: "10.0000",
          authenticityScore: "10.0000",
          confidence: "0.9000",
          calculatedAt: new Date("2026-06-01T00:00:00.000Z"),
          inputFingerprint: "fp-a",
          explanation: {},
          publicationStatus: "PUBLIC",
          isPublic: true,
          analysisBatchId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          evidenceManifestId: null,
          abilityCatalogReleaseId: null,
        },
      ],
    });

    const result = await exportProviderDataBundle({
      prisma: prisma as never,
      outputDir: dir,
      sourceEnvironment: "staging",
    });

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.schemaVersion).toBe(PROVIDER_DATA_SCHEMA_VERSION);
    expect(manifest.contentHash).toBe(result.contentHash);
    expect(manifest.sourceEnvironment).toBe("staging");
    expect(manifest.regions).toEqual(["EU"]);
    expect(manifest.counts.regions).toBe(1);
    expect(manifest.counts.score_snapshots).toBe(1);

    const corpus = JSON.parse(gunzipSync(readFileSync(join(dir, "latest.json.gz"))).toString("utf8"));
    expect(hashCanonicalPayload(corpus)).toBe(manifest.contentHash);
    for (const denied of PROVIDER_DATA_DENYLIST_TABLES) {
      expect(corpus.tables[denied]).toBeUndefined();
    }
    expect(corpus.tables.users).toBeUndefined();
    expect(corpus.tables.score_snapshots[0].analysisBatchId).toBeNull();
    expect(corpus.tables.score_snapshots[0].abilityCatalogReleaseId).toBeNull();
  });

  it("produces the same contentHash for identical logical data", async () => {
    const prisma = makePrismaStore({
      regions: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          code: "EU",
          name: "Europe",
          enabled: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });
    const a = await buildProviderDataCorpus(prisma as never);
    const b = await buildProviderDataCorpus(prisma as never);
    expect(a.contentHash).toBe(b.contentHash);
    const m1 = buildManifest({
      contentHash: a.contentHash,
      sourceEnvironment: "staging",
      generatedAt: new Date("2026-08-31T00:00:00.000Z"),
      regions: a.regions,
      seasonIds: a.seasonIds,
      counts: a.counts,
    });
    const m2 = buildManifest({
      contentHash: b.contentHash,
      sourceEnvironment: "staging",
      generatedAt: new Date("2026-08-31T12:00:00.000Z"),
      regions: b.regions,
      seasonIds: b.seasonIds,
      counts: b.counts,
    });
    expect(m1.contentHash).toBe(m2.contentHash);
    expect(m1.generatedAt).not.toBe(m2.generatedAt);
  });
});

describe("importProviderDataBundle", () => {
  it("imports score history and published pointer; second import is no-op", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-import-"));
    const characterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const seasonId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const modelId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const snapA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const snapB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const regionId = "11111111-1111-4111-8111-111111111111";
    const realmId = "22222222-2222-4222-8222-222222222222";

    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: {
        ...emptyTables(),
        regions: [
          {
            id: regionId,
            code: "EU",
            name: "Europe",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        realms: [
          {
            id: realmId,
            regionId,
            slug: "outland",
            name: "Outland",
            nameNormalized: "outland",
            locale: "en_GB",
            timezone: "Europe/Paris",
            connectedRealmId: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        seasons: [
          {
            id: seasonId,
            regionId,
            blizzardSeasonId: 99,
            slug: "test-season",
            name: "Test",
            startsAt: "2026-01-01T00:00:00.000Z",
            endsAt: null,
            isCurrent: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        score_models: [
          {
            id: modelId,
            key: "trust",
            version: 1,
            name: "Trust",
            description: "",
            status: "ACTIVE",
            config: {},
            createdByUserId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            activatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        characters: [
          {
            id: characterId,
            regionId,
            realmId,
            normalizedName: "tester",
            displayName: "Tester",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        score_snapshots: [
          {
            id: snapA,
            characterId,
            seasonId,
            scoreModelId: modelId,
            scopeType: "SEASON",
            scopeKey: null,
            overallScore: "10.0000",
            grade: "B",
            skillScore: "10.0000",
            authenticityScore: "10.0000",
            confidence: "0.9000",
            calculatedAt: "2026-06-01T00:00:00.000Z",
            inputFingerprint: "fp-a",
            explanation: {},
            publicationStatus: "PUBLIC",
            isPublic: true,
            analysisBatchId: null,
            evidenceManifestId: null,
            abilityCatalogReleaseId: null,
          },
          {
            id: snapB,
            characterId,
            seasonId,
            scoreModelId: modelId,
            scopeType: "SEASON",
            scopeKey: null,
            overallScore: "20.0000",
            grade: "A",
            skillScore: "20.0000",
            authenticityScore: "20.0000",
            confidence: "0.9500",
            calculatedAt: "2026-07-01T00:00:00.000Z",
            inputFingerprint: "fp-b",
            explanation: {},
            publicationStatus: "PUBLIC",
            isPublic: true,
            analysisBatchId: null,
            evidenceManifestId: null,
            abilityCatalogReleaseId: null,
          },
        ],
        character_published_scores: [
          {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            characterId,
            seasonId,
            scoreModelId: modelId,
            scopeType: "SEASON",
            scopeKey: null,
            publishedSnapshotId: snapB,
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    };
    const contentHash = hashCanonicalPayload(corpus);
    const manifest = buildManifest({
      contentHash,
      sourceEnvironment: "staging",
      generatedAt: new Date("2026-08-31T00:00:00.000Z"),
      regions: ["EU"],
      seasonIds: [seasonId],
      counts: Object.fromEntries(
        Object.entries(corpus.tables).map(([k, v]) => [k, v.length]),
      ),
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));

    const prisma = makePrismaStore();
    const first = await importProviderDataBundle({ prisma: prisma as never, dir });
    expect(first.skippedDuplicate).toBe(false);
    expect(prisma._store.score_snapshots.map((s) => s.id).sort()).toEqual([snapA, snapB].sort());
    expect(prisma._store.character_published_scores[0]?.publishedSnapshotId).toBe(snapB);

    const second = await importProviderDataBundle({ prisma: prisma as never, dir });
    expect(second.skippedDuplicate).toBe(true);
    expect(prisma._imports).toHaveLength(1);
  });

  it("rejects unsupported schemaVersion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-bad-schema-"));
    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: emptyTables(),
    };
    const contentHash = hashCanonicalPayload(corpus);
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 999,
        generatedAt: new Date().toISOString(),
        sourceEnvironment: "staging",
        contentHash,
        regions: [],
        seasonIds: [],
        counts: {},
      }),
    );
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));
    await expect(
      importProviderDataBundle({ prisma: makePrismaStore() as never, dir }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_SCHEMA" } satisfies Partial<ProviderDataImportError>);
  });

  it("rejects corrupted content hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-bad-hash-"));
    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: emptyTables(),
    };
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        sourceEnvironment: "staging",
        contentHash: "0".repeat(64),
        regions: [],
        seasonIds: [],
        counts: {},
      }),
    );
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));
    await expect(
      importProviderDataBundle({ prisma: makePrismaStore() as never, dir }),
    ).rejects.toMatchObject({ code: "CONTENT_HASH_MISMATCH" });
  });

  it("rejects immutable ScoreSnapshot fingerprint conflict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-conflict-"));
    const snapId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const existing = makePrismaStore({
      score_snapshots: [
        {
          id: snapId,
          inputFingerprint: "fp-local",
          calculatedAt: new Date("2026-06-01T00:00:00.000Z"),
        },
      ],
    });
    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: {
        ...emptyTables(),
        score_snapshots: [
          {
            id: snapId,
            characterId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            seasonId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            scoreModelId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            scopeType: "SEASON",
            scopeKey: null,
            overallScore: "1",
            grade: "C",
            skillScore: "1",
            authenticityScore: "1",
            confidence: "0.5",
            calculatedAt: "2026-06-01T00:00:00.000Z",
            inputFingerprint: "fp-imported",
            explanation: {},
            publicationStatus: "PUBLIC",
            isPublic: true,
          },
        ],
      },
    };
    const contentHash = hashCanonicalPayload(corpus);
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        sourceEnvironment: "staging",
        contentHash,
        regions: [],
        seasonIds: [],
        counts: { score_snapshots: 1 },
      }),
    );
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));
    await expect(
      importProviderDataBundle({ prisma: existing as never, dir }),
    ).rejects.toMatchObject({ code: "IMMUTABLE_CONFLICT" });
  });

  it("does not move published pointer backwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-ptr-"));
    const characterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const seasonId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const modelId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const older = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const newer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const publishedId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const prisma = makePrismaStore({
      score_snapshots: [
        {
          id: older,
          calculatedAt: new Date("2026-06-01T00:00:00.000Z"),
          inputFingerprint: "fp-a",
        },
        {
          id: newer,
          calculatedAt: new Date("2026-07-01T00:00:00.000Z"),
          inputFingerprint: "fp-b",
        },
      ],
      character_published_scores: [
        {
          id: publishedId,
          characterId,
          seasonId,
          scoreModelId: modelId,
          scopeType: "SEASON",
          scopeKey: null,
          publishedSnapshotId: newer,
        },
      ],
    });

    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: {
        ...emptyTables(),
        score_snapshots: [
          {
            id: older,
            characterId,
            seasonId,
            scoreModelId: modelId,
            scopeType: "SEASON",
            scopeKey: null,
            overallScore: "1",
            grade: "C",
            skillScore: "1",
            authenticityScore: "1",
            confidence: "0.5",
            calculatedAt: "2026-06-01T00:00:00.000Z",
            inputFingerprint: "fp-a",
            explanation: {},
            publicationStatus: "PUBLIC",
            isPublic: true,
          },
        ],
        character_published_scores: [
          {
            id: publishedId,
            characterId,
            seasonId,
            scoreModelId: modelId,
            scopeType: "SEASON",
            scopeKey: null,
            publishedSnapshotId: older,
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
    };
    const contentHash = hashCanonicalPayload(corpus);
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        sourceEnvironment: "staging",
        contentHash,
        regions: [],
        seasonIds: [],
        counts: {},
      }),
    );
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));

    const result = await importProviderDataBundle({ prisma: prisma as never, dir });
    expect(result.skippedDuplicate).toBe(false);
    expect(prisma._store.character_published_scores[0]?.publishedSnapshotId).toBe(newer);
  });
});

describe("readProviderDataBundle", () => {
  it("round-trips filesystem bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mplus-pd-read-"));
    mkdirSync(dir, { recursive: true });
    const corpus: ProviderDataCorpus = {
      schemaVersion: PROVIDER_DATA_SCHEMA_VERSION,
      tables: emptyTables(),
    };
    const contentHash = hashCanonicalPayload(corpus);
    const manifest = buildManifest({
      contentHash,
      sourceEnvironment: "test",
      regions: [],
      seasonIds: [],
      counts: {},
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "latest.json.gz"), gzipSync(Buffer.from(canonicalJsonStringify(corpus))));
    const read = await readProviderDataBundle(dir);
    expect(read.manifest.contentHash).toBe(contentHash);
    expect(read.corpus.schemaVersion).toBe(PROVIDER_DATA_SCHEMA_VERSION);
  });
});
