/**
 * Unit coverage for persistent shared evidence store + neutral digest.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  WCL_RAW_PAGE_RETENTION_DAYS,
  WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
  assertNeutralWclRunDigest,
} from "@mplus/contracts";
import {
  WCL_RUN_EVIDENCE_ANALYSIS_VERSION,
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  type WclRunEvidenceBundle,
  type WclRunEvidenceDataset,
} from "@mplus/provider-warcraftlogs";
import {
  createPersistentSharedEvidenceStore,
  retentionUntilFromFetchedAt,
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
