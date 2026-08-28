/**
 * Phase 3B.4 — pin propagation, isolation, version-skew, ScoreSnapshot identity.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  AbilityCatalogPinError,
  abilityCatalogExecutionKey,
  createStaticAbilityCatalogPin,
  hashRefreshContract,
  refreshCharacterJobSchema,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import { resolveActiveRefreshContract } from "../build-refresh-contract.js";
import {
  clearAbilityCatalogReleaseContextCache,
  resolveAbilityCatalogExecution,
} from "./ability-catalog-pin-loader.js";
import {
  pinIdentityForExplanation,
  scoreSnapshotPinColumns,
} from "./snapshot-from-character-score.js";

const BOOTSTRAP_RELEASE_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";
const BOOTSTRAP_DIGEST =
  "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761";
const BOOTSTRAP_KEY = "wow-unknown-static/catalog-v1/fe8c9a03";

const releasePinA: AbilityCatalogExecutionPin = {
  kind: "RELEASE",
  releaseId: BOOTSTRAP_RELEASE_ID,
  releaseKey: BOOTSTRAP_KEY,
  contentDigest: BOOTSTRAP_DIGEST,
  schemaVersion: "ability-catalog-release-v1",
};

const releasePinB: AbilityCatalogExecutionPin = {
  kind: "RELEASE",
  releaseId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  releaseKey: "synthetic/catalog-v1/bbbbbbbb",
  contentDigest: "b".repeat(64),
  schemaVersion: "ability-catalog-release-v1",
};

describe("Phase 3B.4 ability catalog pin propagation", () => {
  beforeEach(() => {
    clearAbilityCatalogReleaseContextCache();
  });

  it("STATIC vs RELEASE produce distinct execution keys and refresh hashes", () => {
    const staticPin = createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID);
    const staticResolved = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: staticPin,
    });
    const releaseResolved = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releasePinA,
    });
    expect(staticResolved.hash).not.toBe(releaseResolved.hash);
    expect(staticResolved.contract.abilityCatalogExecutionKey).toMatch(/^static:/);
    expect(releaseResolved.contract.abilityCatalogExecutionKey).toMatch(/^release:/);
  });

  it("two RELEASE pins stay isolated (no global selection)", () => {
    expect(abilityCatalogExecutionKey(releasePinA)).not.toBe(
      abilityCatalogExecutionKey(releasePinB),
    );
    const a = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releasePinA,
    });
    const b = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releasePinB,
    });
    expect(a.hash).not.toBe(b.hash);
  });

  it("ScoreSnapshot pin columns never invent a release FK for STATIC", () => {
    const cols = scoreSnapshotPinColumns(
      createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID),
    );
    expect(cols).toEqual({
      abilityCatalogExecutionMode: "STATIC",
      abilityCatalogVersionId: CURRENT_CATALOG_VERSION_ID,
      abilityCatalogReleaseId: null,
      abilityCatalogContentDigest: null,
      abilityCatalogReleaseKey: null,
    });
  });

  it("ScoreSnapshot pin columns store exact RELEASE identity", () => {
    const cols = scoreSnapshotPinColumns(releasePinA);
    expect(cols.abilityCatalogExecutionMode).toBe("RELEASE");
    expect(cols.abilityCatalogReleaseId).toBe(BOOTSTRAP_RELEASE_ID);
    expect(cols.abilityCatalogContentDigest).toBe(BOOTSTRAP_DIGEST);
    expect(cols.abilityCatalogReleaseKey).toBe(BOOTSTRAP_KEY);
    expect(cols.abilityCatalogVersionId).toBeNull();
  });

  it("explanation identity distinguishes STATIC vs RELEASE", () => {
    const s = pinIdentityForExplanation(
      createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID),
    );
    const r = pinIdentityForExplanation(releasePinA);
    expect(s.mode).toBe("STATIC");
    expect(r.mode).toBe("RELEASE");
    expect(s.executionKey).not.toBe(r.executionKey);
    expect(r.releaseId).toBe(BOOTSTRAP_RELEASE_ID);
    expect(r.contentDigest).toBe(BOOTSTRAP_DIGEST);
  });

  it("old job payload without pin parses and maps to STATIC (legacy)", () => {
    const job = refreshCharacterJobSchema.parse({
      region: "EU",
      realmSlug: "kazzak",
      name: "Test",
      priority: "normal",
      forceRefresh: false,
      requestedAt: new Date().toISOString(),
      refreshContractHash: "a".repeat(64),
    });
    expect(job.abilityCatalogExecutionPin).toBeUndefined();
  });

  it("version skew: RELEASE contract hash does not equal STATIC recompute (old worker strip)", () => {
    const releaseResolved = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releasePinA,
    });
    const staticOnly = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "season-test",
      providerMode: "fixture",
      abilityCatalogExecutionPin: createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID),
    });
    expect(staticOnly.hash).not.toBe(releaseResolved.hash);
    expect(hashRefreshContract(staticOnly.contract)).not.toBe(releaseResolved.hash);
  });

  it("mid-job: wrong status after cache clear fails closed (no STATIC fallback)", async () => {
    let status = "VALIDATED";
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: BOOTSTRAP_RELEASE_ID,
          status,
          releaseKey: BOOTSTRAP_KEY,
          contentDigest: BOOTSTRAP_DIGEST,
          schemaVersion: "ability-catalog-release-v1",
          casContentHash: "deadbeef".repeat(8),
          generatedAt: new Date("2026-08-01T00:00:00.000Z"),
        }),
      },
      rawArtifactPayload: {
        findUnique: async () => null,
      },
    } as never;

    await expect(
      resolveAbilityCatalogExecution({ prisma, pin: releasePinA }),
    ).rejects.toBeInstanceOf(AbilityCatalogPinError);

    status = "DRAFT_BUILD";
    clearAbilityCatalogReleaseContextCache();
    await expect(
      resolveAbilityCatalogExecution({ prisma, pin: releasePinA }),
    ).rejects.toMatchObject({ code: "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE" });
  });

  it("RELEASE digest mismatch fails closed (no STATIC fallback)", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: BOOTSTRAP_RELEASE_ID,
          status: "VALIDATED",
          releaseKey: BOOTSTRAP_KEY,
          contentDigest: "c".repeat(64),
          schemaVersion: "ability-catalog-release-v1",
          casContentHash: "x",
          generatedAt: new Date(),
        }),
      },
    } as never;
    await expect(
      resolveAbilityCatalogExecution({ prisma, pin: releasePinA }),
    ).rejects.toMatchObject({ code: "ABILITY_CATALOG_RELEASE_DIGEST_MISMATCH" });
  });
});
