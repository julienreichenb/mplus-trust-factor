/**
 * CP3 — Experience history loader unit tests (fixture evidence only; no network).
 */
import { describe, expect, it, vi } from "vitest";
import {
  computeExperienceV3,
  computeExperienceV3InputFingerprint,
} from "@mplus/scoring";
import {
  buildEvidenceRevision,
  buildExperienceHistoryFromPersistedEvidence,
  type PersistedExperienceEvidenceSnapshot,
} from "./experience-history-loader.js";

const CUTOFF = "2026-08-01T12:00:00.000Z";

function baseSnapshot(
  overrides: Partial<PersistedExperienceEvidenceSnapshot> = {},
): PersistedExperienceEvidenceSnapshot {
  return {
    characterId: "char-1",
    seasonId: "season-current",
    seasonSlug: "season-tww-3",
    regionCode: "EU",
    realmSlug: "silvermoon",
    displayName: "Tester",
    normalizedName: "tester",
    expectedDungeonCount: 8,
    evidenceCutoffAt: CUTOFF,
    previousSeasonId: "season-prev",
    previousSeasonSlug: "season-tww-2",
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
        lastSuccessAt: "2026-08-01T10:05:00.000Z",
        fetchedAt: "2026-08-01T10:05:00.000Z",
        expiresAt: "2026-08-02T10:05:00.000Z",
        detail: null,
      },
    ],
    currentSeasonRuns: [
      {
        seasonId: "season-current",
        dungeonSlug: "ara-kara",
        keyLevel: 12,
        completedAt: "2026-07-20T10:00:00.000Z",
        durationMs: 1_800_000,
        scoreValue: 200,
        canonicalFingerprint: "fp-ara",
        timed: true,
      },
      {
        seasonId: "season-current",
        dungeonSlug: "dawnbreaker",
        keyLevel: 10,
        completedAt: "2026-07-21T10:00:00.000Z",
        durationMs: 1_700_000,
        scoreValue: 180,
        canonicalFingerprint: "fp-dawn",
        timed: true,
      },
    ],
    localPriorSeasonIds: ["season-prev"],
    rioProfile: {
      contentHash: "rio-hash-1",
      fetchedAt: "2026-08-01T10:05:00.000Z",
      stale: false,
      profile: {
        region: "EU",
        realmSlug: "silvermoon",
        normalizedName: "tester",
        displayName: "Tester",
        classSlug: "mage",
        specSlug: "frost",
        role: "DPS",
        profileUrl: "https://raider.io/characters/eu/silvermoon/tester",
        lastCrawledAt: "2026-08-01T09:00:00.000Z",
        crawlStale: false,
        gear: null,
        talents: null,
        currentSeason: {
          seasonSlug: "season-tww-3",
          scores: { all: 3000, dps: 3000, healer: null, tank: null },
          isCurrentSeason: true,
          isPreviousSeason: false,
        },
        previousSeason: {
          seasonSlug: "season-tww-2",
          scores: { all: 2600, dps: 2600, healer: null, tank: null },
          isCurrentSeason: false,
          isPreviousSeason: true,
        },
        ranks: {
          overall: 1200,
          class: 80,
          server: 5,
          world: 1200,
          region: 400,
          role: "DPS",
        },
        recentRuns: [],
        bestRuns: [],
        highestLevelRuns: [],
        raidProgression: [],
        runHistoryIncomplete: false,
        representedRunCount: 20,
        attribution: {
          provider: "raiderio",
          displayText: "Data from Raider.IO",
          homepageUrl: "https://raider.io",
          profileUrl: "https://raider.io/characters/eu/silvermoon/tester",
          sourceUrl: "https://raider.io/characters/eu/silvermoon/tester",
        },
      },
    },
    allowedDungeonSlugs: ["ara-kara", "dawnbreaker"],
    ...overrides,
  };
}

function assertNoProviderCalls(spy: { mock: { calls: unknown[] } }): void {
  expect(spy.mock.calls).toHaveLength(0);
}

describe("buildExperienceHistoryFromPersistedEvidence", () => {
  it("sufficient current + historical evidence yields non-UNAVAILABLE Experience", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(baseSnapshot());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(loaded.history.currentExposure.provenance).toBe("HAS_HISTORY");
    expect(loaded.history.previousSeason.evidenceState).toBe("HAS_VALUE");
    expect(loaded.history.previousSeason.score).toBe(2600);
    expect(loaded.sourceStatuses.noWarcraftLogs).toBe("true");

    const result = computeExperienceV3({
      manifest: {
        contentHash: "m1",
        schemaVersion: "2.0.0",
        selectorVersion: "sel",
        characterId: "char-1",
        seasonId: "season-current",
        seasonSlug: "season-tww-3",
        highKeyPolicyId: "hk",
        evidenceCutoffAt: CUTOFF,
      },
      ...loaded.history,
      computedAt: CUTOFF,
    });
    expect(result.state).not.toBe("UNAVAILABLE");
    expect(result.score).not.toBeNull();
  });

  it("partial history yields PARTIAL when calculator permits", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        rioProfile: null,
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
            state: "UNAVAILABLE",
            lastSuccessAt: null,
            fetchedAt: null,
            expiresAt: null,
            detail: "soft-skip",
          },
        ],
        localPriorSeasonIds: [],
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.previousSeason.evidenceState).toBe("PROVIDER_FAILURE");
    expect(["HAS_HISTORY", "PARTIAL_SOURCES"]).toContain(
      loaded.history.currentExposure.provenance,
    );

    const result = computeExperienceV3({
      manifest: {
        contentHash: "m1",
        schemaVersion: "2.0.0",
        selectorVersion: "sel",
        characterId: "char-1",
        seasonId: "season-current",
        seasonSlug: "season-tww-3",
        highKeyPolicyId: "hk",
        evidenceCutoffAt: CUTOFF,
      },
      ...loaded.history,
      computedAt: CUTOFF,
    });
    expect(["AVAILABLE", "PARTIAL"]).toContain(result.state);
  });

  it("successful provider sync with no activity → confirmed inactivity", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        currentSeasonRuns: [],
        localPriorSeasonIds: [],
        rioProfile: {
          contentHash: "rio-empty",
          fetchedAt: "2026-08-01T10:05:00.000Z",
          stale: false,
          profile: {
            ...baseSnapshot().rioProfile!.profile,
            previousSeason: null,
            currentSeason: null,
            ranks: null,
            representedRunCount: 0,
          },
        },
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.currentExposure.provenance).toBe("CONFIRMED_ABSENCE");
    expect(loaded.history.previousSeason.evidenceState).toBe("CONFIRMED_NO_ACTIVITY");
  });

  it("no persisted provider result → UNAVAILABLE semantics, not inactivity", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        providerStates: [],
        currentSeasonRuns: [],
        localPriorSeasonIds: [],
        rioProfile: null,
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.currentExposure.provenance).toBe("PROVIDER_FAILURE");
    expect(loaded.history.previousSeason.evidenceState).toBe("UNKNOWN");
    expect(loaded.limitations).toContain("provider_states_absent_no_history");

    const result = computeExperienceV3({
      manifest: {
        contentHash: "m1",
        schemaVersion: "2.0.0",
        selectorVersion: "sel",
        characterId: "char-1",
        seasonId: "season-current",
        seasonSlug: "season-tww-3",
        highKeyPolicyId: "hk",
        evidenceCutoffAt: CUTOFF,
      },
      ...loaded.history,
      computedAt: CUTOFF,
    });
    expect(result.state).toBe("UNAVAILABLE");
  });

  it("provider failure → bounded limitation and PROVIDER_FAILURE previous season", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        rioProfile: null,
        providerStates: [
          {
            provider: "blizzard",
            state: "UNAVAILABLE",
            lastSuccessAt: null,
            fetchedAt: null,
            expiresAt: null,
            detail: "timeout",
          },
          {
            provider: "raiderio",
            state: "RATE_LIMITED",
            lastSuccessAt: null,
            fetchedAt: null,
            expiresAt: null,
            detail: "429",
          },
        ],
        currentSeasonRuns: [],
        localPriorSeasonIds: [],
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.currentExposure.provenance).toBe("PROVIDER_FAILURE");
    expect(loaded.history.previousSeason.evidenceState).toBe("PROVIDER_FAILURE");
    expect(loaded.limitations.some((l) => l.includes("provider_failure"))).toBe(true);
  });

  it("stale evidence is represented explicitly", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        providerStates: [
          {
            provider: "blizzard",
            state: "STALE",
            lastSuccessAt: "2026-07-01T10:00:00.000Z",
            fetchedAt: "2026-07-01T10:00:00.000Z",
            expiresAt: "2026-07-02T10:00:00.000Z",
            detail: null,
          },
          {
            provider: "raiderio",
            state: "STALE",
            lastSuccessAt: "2026-07-01T10:05:00.000Z",
            fetchedAt: "2026-07-01T10:05:00.000Z",
            expiresAt: "2026-07-02T10:05:00.000Z",
            detail: null,
          },
        ],
        rioProfile: {
          ...baseSnapshot().rioProfile!,
          stale: true,
        },
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.limitations).toContain("blizzard_evidence_stale");
    expect(loaded.limitations).toContain("raiderio_evidence_stale");
    expect(loaded.sourceStatuses.blizzardFreshness).toBe("STALE");
    expect(loaded.history.currentExposure.provenance).toBe("PARTIAL_SOURCES");
  });

  it("wrong season evidence is ignored", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        currentSeasonRuns: [
          {
            seasonId: "season-other",
            dungeonSlug: "ara-kara",
            keyLevel: 20,
            completedAt: "2026-07-20T10:00:00.000Z",
            durationMs: 1_800_000,
            scoreValue: 300,
            canonicalFingerprint: "fp-wrong",
            timed: true,
          },
        ],
        rioProfile: {
          ...baseSnapshot().rioProfile!,
          profile: {
            ...baseSnapshot().rioProfile!.profile,
            previousSeason: {
              seasonSlug: "season-tww-3",
              scores: { all: 9999, dps: 9999, healer: null, tank: null },
              isCurrentSeason: false,
              isPreviousSeason: true,
            },
          },
        },
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.currentExposure.seasonRuns).toHaveLength(0);
    expect(loaded.limitations).toContain("wrong_season_runs_ignored");
    expect(loaded.history.previousSeason.evidenceState).not.toBe("HAS_VALUE");
  });

  it("RIO OK without recoverable payload is UNKNOWN, not confirmed inactivity", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        rioProfile: null,
        currentSeasonRuns: [],
        localPriorSeasonIds: [],
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.previousSeason.evidenceState).toBe("UNKNOWN");
    expect(loaded.limitations).toContain("previous_season_payload_absent");
  });

  it("repeated load is deterministic (fingerprint + revision)", () => {
    const a = buildExperienceHistoryFromPersistedEvidence(baseSnapshot());
    const b = buildExperienceHistoryFromPersistedEvidence(baseSnapshot());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.evidenceRevision).toBe(b.evidenceRevision);
    expect(a.history).toEqual(b.history);

    const manifest = {
      contentHash: "m1",
      schemaVersion: "2.0.0",
      selectorVersion: "sel",
      characterId: "char-1",
      seasonId: "season-current",
      seasonSlug: "season-tww-3",
      highKeyPolicyId: "hk",
      evidenceCutoffAt: CUTOFF,
    };
    const r1 = computeExperienceV3({ ...a.history, manifest, computedAt: CUTOFF });
    const r2 = computeExperienceV3({ ...b.history, manifest, computedAt: CUTOFF });
    expect(r1.inputFingerprint).toBe(r2.inputFingerprint);
    expect(computeExperienceV3InputFingerprint({ ...a.history, manifest, computedAt: CUTOFF })).toBe(
      r1.inputFingerprint,
    );
    expect(r1.score).toBe(r2.score);
    expect(r1.confidence).toBe(r2.confidence);
    expect(r1.state).toBe(r2.state);
  });

  it("evidence revision changes when persisted content changes", () => {
    const a = buildExperienceHistoryFromPersistedEvidence(baseSnapshot());
    const b = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        currentSeasonRuns: [
          ...baseSnapshot().currentSeasonRuns,
          {
            seasonId: "season-current",
            dungeonSlug: "stonevault",
            keyLevel: 14,
            completedAt: "2026-07-22T10:00:00.000Z",
            durationMs: 1_600_000,
            scoreValue: 220,
            canonicalFingerprint: "fp-stone",
            timed: true,
          },
        ],
      }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.evidenceRevision).not.toBe(b.evidenceRevision);
  });

  it("does not reach provider, refresh, or queue APIs", () => {
    const providerSpy = vi.fn();
    const refreshSpy = vi.fn();
    const queueSpy = vi.fn();
    buildExperienceHistoryFromPersistedEvidence(baseSnapshot());
    assertNoProviderCalls(providerSpy);
    assertNoProviderCalls(refreshSpy);
    assertNoProviderCalls(queueSpy);
    expect(buildEvidenceRevision({
      characterId: "c",
      seasonId: "s",
      evidenceCutoffAt: CUTOFF,
      blizzardFetchedAt: null,
      raiderIoFetchedAt: null,
      rioContentHash: null,
      runFingerprints: [],
      provenance: "HAS_HISTORY",
      previousSeasonState: "UNKNOWN",
      previousSeasonScore: null,
    })).toHaveLength(64);
  });

  it("Experience remains independent from Warcraft Logs provider state", () => {
    const loaded = buildExperienceHistoryFromPersistedEvidence(
      baseSnapshot({
        providerStates: [
          ...baseSnapshot().providerStates,
          {
            provider: "warcraftlogs",
            state: "UNAVAILABLE",
            lastSuccessAt: null,
            fetchedAt: null,
            expiresAt: null,
            detail: "ignored",
          },
        ],
      }),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.history.currentExposure.provenance).toBe("HAS_HISTORY");
    expect(loaded.sourceStatuses.noWarcraftLogs).toBe("true");
  });
});

describe("persistShadowDimensionComputations experience isolation", () => {
  it("loader failure does not block sibling dimensions", async () => {
    const { persistShadowDimensionComputations } = await import("./dimension-finalizer.js");
    const create = vi.fn(async (input: { dimension: string }) => ({
      row: { id: `id-${input.dimension}` },
      created: true,
    }));
    const loadThrowPrisma = {
      character: {
        findUnique: vi.fn().mockRejectedValue(new Error("db_down")),
      },
    };
    const container = {
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      prisma: loadThrowPrisma,
      repositories: {
        evidence: {
          listFactSetsForManifest: vi.fn().mockResolvedValue([]),
          createDimensionComputationIdempotent: create,
        },
        externalRequest: {
          findFreshPayloadByFingerprint: vi.fn(),
        },
      },
    };

    const result = await persistShadowDimensionComputations(container as never, {
      characterId: "00000000-0000-4000-8000-000000000001",
      seasonId: "00000000-0000-4000-8000-000000000002",
      scoreModelId: "00000000-0000-4000-8000-000000000003",
      manifestId: "00000000-0000-4000-8000-000000000004",
      expectedManifestContentHash: "manifest-hash-empty",
      enabledDimensions: ["PERFORMANCE", "SURVIVAL", "EXPERIENCE"],
      // Force DB load path (undefined) so loader exception is exercised.
      manifestDocument: {
        schemaVersion: "2.0.0",
        selectorVersion: "sel",
        characterId: "00000000-0000-4000-8000-000000000001",
        seasonId: "00000000-0000-4000-8000-000000000002",
        seasonSlug: "season",
        specSlug: "affliction",
        role: "DPS",
        refreshContractHash: "r",
        evidenceCutoffAt: CUTOFF,
        highKeyPolicyId: "hk",
        activeDungeonSlugs: [],
        expectedSlotCount: 0,
        selectedSlotCount: 0,
        selectedAt: CUTOFF,
        acquisitionPlanContentHash: "p",
        slots: [],
        rejectedCandidates: [],
        coverage: {
          state: "INSUFFICIENT",
          expectedSlotCount: 0,
          selectedSlotCount: 0,
          dungeonCount: 0,
          dungeonsRepresented: 0,
          slotFillRatio: 0,
          dungeonFillRatio: 0,
        },
        contentHash: "manifest-hash-empty",
        diagnostics: {
          candidatesConsidered: 0,
          candidatesEligible: 0,
          candidatesRejected: 0,
          rejectionReasonCounts: {},
          perDungeon: [],
        },
      },
      computedAt: new Date(CUTOFF),
    });

    expect(create).toHaveBeenCalled();
    expect(result.persisted.map((p) => p.dimension).sort()).toEqual(
      ["EXPERIENCE", "PERFORMANCE", "SURVIVAL"].sort(),
    );
    const experience = result.finalization.outcomes.find((o) => o.dimension === "EXPERIENCE");
    expect(experience?.record.metrics.availabilityState).toBeDefined();
    expect(container.repositories.externalRequest.findFreshPayloadByFingerprint).not.toHaveBeenCalled();
  });
});
