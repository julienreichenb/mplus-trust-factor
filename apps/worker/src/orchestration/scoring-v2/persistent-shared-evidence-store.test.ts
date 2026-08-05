/**
 * Unit coverage for persistent shared evidence store + neutral digest.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  WCL_RAW_PAGE_RETENTION_DAYS,
  WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
  assertNeutralWclRunDigest,
  buildEvidenceDatasetScopeFingerprint,
} from "@mplus/contracts";
import {
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import { ArtifactLegacyExternalPayloadMissingError } from "@mplus/database";
import {
  createPersistentSharedEvidenceStore,
  retentionUntilFromFetchedAt,
  selectPreferredEvidencePages,
} from "./persistent-shared-evidence-store.js";
import {
  buildNeutralDigestFromBundle,
  participantsFromMasterData,
} from "./wcl-run-digest-persist.js";

function dataset(events: Array<Record<string, unknown>>): WclRunEvidenceDataset {
  return {
    key: "Deaths",
    state: "PERSISTED",
    truncated: false,
    pageCount: 1,
    eventCount: events.length,
    filterSourceId: null,
    filterExpression: null,
    pages: [
      {
        pageIndex: 0,
        startTime: null,
        nextPageTimestamp: null,
        eventCount: events.length,
        payloadFingerprint: createHash("sha256")
          .update(JSON.stringify(events))
          .digest("hex"),
      },
    ],
    events,
    consumers: ["survival", "utility"],
    pointsConsumed: 1,
    costSource: "measured",
    requestCostUnits: [],
    wclRequests: 1,
    fetchedAt: new Date().toISOString(),
    source: "provider",
  };
}

describe("persistent shared evidence store", () => {
  it("retentionUntil is exactly 30 days from fetchedAt", () => {
    const fetchedAt = new Date("2026-08-01T12:00:00.000Z");
    const until = retentionUntilFromFetchedAt(fetchedAt);
    expect(until.toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(WCL_RAW_PAGE_RETENTION_DAYS).toBe(30);
  });

  it("loads persisted pages before treating dataset as missing", async () => {
    const events = [{ type: "death", targetID: 1 }];
    const scopeFingerprint = [
      "scope",
      "ds:Deaths",
      "a:1",
      "fe:none",
      "ht:default",
      "res:0",
      "t:0-end",
      `pc:${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}`,
    ].join("|");
    const envelope = {
      schemaVersion: "wcl-event-page-v1",
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
      reportCode: "Abc123",
      fightId: 9,
      reportRevision: 2,
      datasetKey: "Deaths",
      pageIndex: 0,
      pageCursor: null,
      nextPageCursor: null,
      filterExpression: null,
      filterSourceId: 1,
      scopeFingerprint,
      truncated: false,
      datasetMeta: {
        state: "PERSISTED" as const,
        consumers: ["survival" as const, "utility" as const],
        costSource: "measured" as const,
        pointsConsumed: 1,
        wclRequests: 0,
        fetchedAt: "2026-08-01T00:00:00.000Z",
      },
      events,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => [
        {
          pageIndex: 0,
          artifactId: "art-1",
          contentHash,
          eventCount: 1,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          scopeFingerprint,
        },
      ]),
      createEvidenceDatasetPage: vi.fn(),
      findWclRunSourceDigest: vi.fn(async () => null),
    };
    const artifacts = {
      getStorageUris: vi.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [id, "pg://sha256/test"])),
      ),
      readVerified: vi.fn(async () => bytes),
      persist: vi.fn(),
    };

    const store = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
    });

    const key = `wcl-evidence|Abc123|r2|f9|a1|Deaths|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`;
    const loaded = await store.loadDataset(key);
    expect(loaded).not.toBeNull();
    expect(loaded!.events).toEqual(events);
    expect(loaded!.source).toBe("persisted");
    expect(artifacts.persist).not.toHaveBeenCalled();
    expect(wclSource.findEvidenceDatasetPages).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeFingerprint,
      }),
    );
  });

  it("persists pages through artifact CAS on saveDataset", async () => {
    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => []),
      createEvidenceDatasetPage: vi.fn(async () => ({})),
      findWclRunSourceDigest: vi.fn(async () => null),
    };
    const artifacts = {
      getStorageUris: vi.fn(async () => new Map()),
      readVerified: vi.fn(),
      persist: vi.fn(async () => ({ artifactId: "new-art", contentHash: "h" })),
    };
    const store = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
    });

    await store.saveDataset(
      `wcl-evidence|R1|r1|f1|a1|Deaths|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`,
      dataset([{ id: 1 }]),
      {
        reportCode: "R1",
        reportRevision: 1,
        fightId: 1,
        dataset: "Deaths",
      },
    );

    expect(artifacts.persist).toHaveBeenCalledOnce();
    expect(wclSource.createEvidenceDatasetPage).toHaveBeenCalledOnce();
    const pageArg = wclSource.createEvidenceDatasetPage.mock.calls[0]![0] as {
      scopeFingerprint: string;
    };
    expect(pageArg.scopeFingerprint).toContain("a:1");
    const persistArg = artifacts.persist.mock.calls[0]![0] as {
      retentionUntil: Date;
      artifactClass: string;
    };
    expect(persistArg.artifactClass).toBe("wcl_event_page");
    expect(persistArg.retentionUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("treats unreadable legacy cas metadata as a cache miss in live acquisition mode", async () => {
    const scopeFingerprint = "scope:test";
    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => [
        {
          pageIndex: 0,
          artifactId: "legacy-art",
          contentHash: "legacy-hash",
          eventCount: 1,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          scopeFingerprint,
        },
      ]),
      createEvidenceDatasetPage: vi.fn(),
      findWclRunSourceDigest: vi.fn(async () => null),
    };
    const artifacts = {
      getStorageUris: vi.fn(async () => new Map([["legacy-art", "cas://sha256/abc"]])),
      readVerified: vi.fn(async () => {
        throw new ArtifactLegacyExternalPayloadMissingError("legacy-art", "cas://sha256/abc");
      }),
      persist: vi.fn(),
    };

    const liveStore = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
      treatLegacyPayloadMissingAsCacheMiss: true,
    });
    const reloadStore = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
    });

    const key = `wcl-evidence|Abc123|r2|f9|a1|Casts|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`;
    await expect(liveStore.loadDataset(key)).resolves.toBeNull();
    await expect(reloadStore.loadDataset(key)).rejects.toThrow(
      ArtifactLegacyExternalPayloadMissingError,
    );
  });

  it("prefers pg:// page artifacts over legacy cas:// metadata when both exist", async () => {
    const scopeFingerprint = buildEvidenceDatasetScopeFingerprint({
      datasetKey: "Casts",
      sourceActorId: 1,
      filterExpression: null,
      hostilityType: null,
      includeResources: false,
      startTime: null,
      endTime: null,
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    });
    const events = [{ type: "cast", abilityGameID: 111898 }];
    const envelope = {
      schemaVersion: "wcl-event-page-v1",
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
      reportCode: "Abc123",
      fightId: 9,
      reportRevision: 2,
      datasetKey: "Casts",
      pageIndex: 0,
      pageCursor: null,
      nextPageCursor: null,
      filterExpression: null,
      filterSourceId: 1,
      scopeFingerprint,
      truncated: false,
      events,
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");

    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => [
        {
          pageIndex: 0,
          artifactId: "legacy-art",
          contentHash: "legacy-hash",
          eventCount: 1,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          scopeFingerprint,
        },
        {
          pageIndex: 0,
          artifactId: "pg-art",
          contentHash: "pg-hash",
          eventCount: 1,
          createdAt: new Date("2026-08-02T00:00:00.000Z"),
          scopeFingerprint,
        },
      ]),
      createEvidenceDatasetPage: vi.fn(),
      findWclRunSourceDigest: vi.fn(async () => null),
    };
    const artifacts = {
      getStorageUris: vi.fn(async () =>
        new Map([
          ["legacy-art", "cas://sha256/legacy"],
          ["pg-art", "pg://sha256/pghash"],
        ]),
      ),
      readVerified: vi.fn(async (artifactId: string) => {
        expect(artifactId).toBe("pg-art");
        return bytes;
      }),
      persist: vi.fn(),
    };

    const store = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
    });
    const key = `wcl-evidence|Abc123|r2|f9|a1|Casts|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`;
    const loaded = await store.loadDataset(key);
    expect(loaded?.events).toEqual(events);
    expect(artifacts.readVerified).toHaveBeenCalledOnce();
  });

  it("replaces legacy page artifact pointers when persisting live PostgreSQL evidence", async () => {
    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => []),
      createEvidenceDatasetPage: vi.fn(async () => ({})),
      findWclRunSourceDigest: vi.fn(async () => null),
    };
    const artifacts = {
      getStorageUris: vi.fn(),
      readVerified: vi.fn(),
      persist: vi.fn(async () => ({ artifactId: "pg-art", contentHash: "pg-hash" })),
    };
    const store = createPersistentSharedEvidenceStore({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
      replaceLegacyPageArtifactsOnSave: true,
    });

    await store.saveDataset(
      `wcl-evidence|R1|r1|f1|a1|Casts|t0-end|fe:none|${WCL_RUN_EVIDENCE_PROVIDER_CONTRACT}|nopayload`,
      dataset([{ abilityGameID: 111898 }]),
      {
        reportCode: "R1",
        reportRevision: 1,
        fightId: 1,
        dataset: "Casts",
      },
    );

    expect(wclSource.createEvidenceDatasetPage).toHaveBeenCalledWith(
      expect.objectContaining({
        replaceArtifactOnConflict: true,
        artifactId: "pg-art",
      }),
    );
  });
});

describe("selectPreferredEvidencePages", () => {
  it("chooses pg:// artifacts over cas:// for the same page index", () => {
    const pages = [
      { pageIndex: 0, artifactId: "cas-art", eventCount: 1 },
      { pageIndex: 0, artifactId: "pg-art", eventCount: 2 },
    ];
    const uris = new Map([
      ["cas-art", "cas://sha256/legacy"],
      ["pg-art", "pg://sha256/new"],
    ]);
    const selected = selectPreferredEvidencePages(pages, uris);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.artifactId).toBe("pg-art");
  });
});

describe("neutral wcl run digest", () => {
  it("builds five-player roster and rejects score fields", () => {
    const masterData = {
      actors: [
        { id: 1, name: "A", type: "Player", server: "Archimonde", subType: "Warrior" },
        { id: 2, name: "B", type: "Player", server: "Archimonde", subType: "Mage" },
        { id: 3, name: "C", type: "Player", server: "Archimonde", subType: "Priest" },
        { id: 4, name: "D", type: "Player", server: "Archimonde", subType: "Rogue" },
        { id: 5, name: "E", type: "Player", server: "Archimonde", subType: "Hunter" },
        { id: 10, name: "Pet", type: "Pet", petOwner: 5 },
      ],
    };
    const participants = participantsFromMasterData(masterData, "EU");
    expect(participants).toHaveLength(5);
    expect(participants.find((p) => p.wclActorId === 5)?.ownedPetActorIds).toContain(10);

    const bundle: WclRunEvidenceBundle = {
      schemaVersion: WCL_RUN_EVIDENCE_SCHEMA_VERSION,
      analysisVersion: WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
      providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
      reportCode: "R1",
      fightId: 1,
      reportRevision: 3,
      playerActorId: 1,
      ownedPetActorIds: [],
      dungeonSlug: "ara-kara",
      startTime: 0,
      endTime: 1,
      masterData: masterData as never,
      eventDatasets: { Deaths: dataset([{ t: 1 }]) },
      completeness: {
        required: ["Deaths"],
        present: ["Deaths"],
        missing: [],
        truncated: [],
      },
      fetchedAt: new Date().toISOString(),
      payloadFingerprints: {},
      accounting: {
        datasetsRequested: ["Deaths"],
        providerCalls: 0,
        cacheHits: 1,
        persistedHits: 1,
        pages: 1,
        pointsConsumed: 0,
        estimatedPointsConsumed: 0,
        costSource: "measured",
        consumers: ["survival", "utility"],
        duplicatedLogicalFetches: 0,
      },
    };

    const { digest } = buildNeutralDigestFromBundle({
      bundle,
      region: "EU",
      dungeonSlug: "ara-kara",
      keyLevel: 12,
      timed: true,
    });
    expect(digest.schemaVersion).toBe(WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION);
    expect(digest.participants).toHaveLength(5);
    expect(() => assertNeutralWclRunDigest(digest)).not.toThrow();

    const poisoned = JSON.parse(JSON.stringify(digest)) as Record<string, unknown>;
    (poisoned.participants as Array<Record<string, unknown>>)[0]!.score = 12;
    expect(() => assertNeutralWclRunDigest(poisoned)).toThrow(
      /wcl_run_source_digest_contains_forbidden_field:score/,
    );

    function assertNoForbiddenKeys(value: unknown, path = "$"): void {
      if (value == null || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
        return;
      }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        expect(
          [
            "score",
            "scores",
            "grade",
            "grades",
            "weight",
            "weights",
            "threshold",
            "thresholds",
            "penalty",
            "penalties",
            "opportunity",
            "opportunities",
            "dimensionScore",
            "overallScore",
            "confidence",
            "explanation",
            "calculator",
          ].includes(key),
          `forbidden key ${key} at ${path}`,
        ).toBe(false);
        assertNoForbiddenKeys(child, `${path}.${key}`);
      }
    }
    assertNoForbiddenKeys(digest);
  });
});
