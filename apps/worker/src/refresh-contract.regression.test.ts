import { describe, expect, it } from "vitest";
import {
  OBSERVATION_SCHEMA_VERSION,
  RUN_SELECTION_VERSION,
  hashRefreshContract,
  type RefreshContractVersions,
} from "@mplus/contracts";
import { buildRefreshContract } from "./orchestration/build-refresh-contract.js";
import { fingerprintObservations } from "./orchestration/fingerprint.js";
import { refreshCharacterDedupeKey } from "./dedupe.js";

const baseContract: RefreshContractVersions = buildRefreshContract({
  scoringModelKey: "default",
  scoringModelVersion: 3,
  activeSeasonId: "midnight-season-1",
  zoneId: 47,
  partition: null,
  observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  wclAdapterVersion: "points-and-damage-v1",
  blizzardAdapterVersion: "blizzard-wow-profile-2026-07",
  raiderIoAdapterVersion: "0.62.5",
  runSelectionVersion: RUN_SELECTION_VERSION,
  abilityCatalogVersion: "12.0.0/midnight-season-1",
  mechanicCatalogVersion: "0.1.0-seed",
});

const observations = [
  {
    id: "obs-1",
    characterId: "char-1",
    seasonId: "season-1",
    metricKey: "performance.current_season_peak",
    sourceProvider: "warcraftlogs" as const,
    observedAt: "2026-07-28T20:00:00.000Z",
    rawValue: 80.875,
    normalizedValue: 80.875,
    confidence: 1,
    context: {},
  },
];

describe("model-versioned refresh contract regressions", () => {
  it("existing character + new modelVersion invalidates score fingerprint and job dedupe", () => {
    const oldFp = fingerprintObservations("char-1", "default", 3, observations, {
      refreshContract: baseContract,
    });
    const bumped = { ...baseContract, scoringModelVersion: 4 };
    const newFp = fingerprintObservations("char-1", "default", 4, observations, {
      refreshContract: bumped,
    });
    expect(newFp).not.toBe(oldFp);

    const jobBase = {
      region: "EU" as const,
      realmSlug: "archimonde",
      name: "Wallidrixe",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt: "2026-07-28T20:00:00.000Z",
    };
    expect(
      refreshCharacterDedupeKey({
        ...jobBase,
        refreshContractHash: hashRefreshContract(baseContract),
      }),
    ).not.toBe(
      refreshCharacterDedupeKey({
        ...jobBase,
        refreshContractHash: hashRefreshContract(bumped),
      }),
    );
  });

  it("existing character + new observationSchemaVersion invalidates fingerprints", () => {
    const bumped = { ...baseContract, observationSchemaVersion: "observations-v3" };
    expect(
      fingerprintObservations("char-1", "default", 3, observations, { refreshContract: bumped }),
    ).not.toBe(
      fingerprintObservations("char-1", "default", 3, observations, {
        refreshContract: baseContract,
      }),
    );
  });

  it("existing character + new WCL adapter version invalidates fingerprints", () => {
    const bumped = { ...baseContract, wclAdapterVersion: "points-and-damage-v2" };
    expect(hashRefreshContract(bumped)).not.toBe(hashRefreshContract(baseContract));
    expect(
      fingerprintObservations("char-1", "default", 3, observations, { refreshContract: bumped }),
    ).not.toBe(
      fingerprintObservations("char-1", "default", 3, observations, {
        refreshContract: baseContract,
      }),
    );
  });

  it("existing character + new runSelectionVersion invalidates fingerprints", () => {
    const bumped = { ...baseContract, runSelectionVersion: "active-season-eight-v2" };
    expect(
      fingerprintObservations("char-1", "default", 3, observations, { refreshContract: bumped }),
    ).not.toBe(
      fingerprintObservations("char-1", "default", 3, observations, {
        refreshContract: baseContract,
      }),
    );
  });

  it("force refresh with an existing completed job uses a distinct dedupe key", () => {
    const hash = hashRefreshContract(baseContract);
    const completed = refreshCharacterDedupeKey({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      priority: "normal",
      forceRefresh: false,
      requestedAt: "2026-07-28T16:00:00.000Z",
      refreshContractHash: hash,
    });
    const forced = refreshCharacterDedupeKey({
      region: "EU",
      realmSlug: "archimonde",
      name: "Wallidrixe",
      priority: "high",
      forceRefresh: true,
      requestedAt: "2026-07-28T20:02:00.000Z",
      refreshContractHash: hash,
    });
    expect(forced).not.toBe(completed);
  });

  it("unchanged inputs with normal refresh may reuse compatible contract hash", () => {
    const a = hashRefreshContract(baseContract);
    const b = hashRefreshContract({ ...baseContract });
    expect(a).toBe(b);
    const job = {
      region: "EU" as const,
      realmSlug: "archimonde",
      name: "Wallidrixe",
      priority: "normal" as const,
      forceRefresh: false,
      requestedAt: "2026-07-28T20:00:00.000Z",
      refreshContractHash: a,
    };
    expect(refreshCharacterDedupeKey(job)).toBe(refreshCharacterDedupeKey({ ...job }));
  });

  it("successful refresh fingerprint includes active contract modelVersion", () => {
    const fp = fingerprintObservations("char-1", "default", 3, observations, {
      refreshContract: baseContract,
      forceRefreshToken: "2026-07-28T20:10:00.000Z",
    });
    expect(fp).toHaveLength(64);
    expect(
      fingerprintObservations("char-1", "default", 3, observations, {
        refreshContract: baseContract,
      }),
    ).not.toBe(fp);
  });
});
