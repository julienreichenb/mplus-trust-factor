/**
 * Replaces STATIC vs ACTIVE_RELEASE mode tests — pin stability + RELEASE identity.
 */

import { describe, expect, it } from "vitest";
import {
  abilityCatalogExecutionKey,
  refreshCharacterJobSchema,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import { resolveActiveRefreshContract } from "./build-refresh-contract.js";

describe("Queued job pin stability", () => {
  it("persisted RELEASE pin survives later activation of a different release", () => {
    const pinnedA: AbilityCatalogExecutionPin = {
      kind: "RELEASE",
      releaseId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      releaseKey: "release-a/feaaaaaa",
      contentDigest: "a".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
    };
    const job = refreshCharacterJobSchema.parse({
      region: "EU",
      realmSlug: "kazzak",
      name: "Queued",
      priority: "normal",
      forceRefresh: false,
      requestedAt: new Date().toISOString(),
      refreshContractHash: "f".repeat(64),
      abilityCatalogExecutionPin: pinnedA,
    });
    expect(job.abilityCatalogExecutionPin).toEqual(pinnedA);

    const activeB: AbilityCatalogExecutionPin = {
      kind: "RELEASE",
      releaseId: "bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff",
      releaseKey: "release-b/febbbbbb",
      contentDigest: "b".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
    };
    expect(abilityCatalogExecutionKey(job.abilityCatalogExecutionPin!)).not.toBe(
      abilityCatalogExecutionKey(activeB),
    );
  });

  it("different ACTIVE releases produce different contract hashes", () => {
    const releaseA: AbilityCatalogExecutionPin = {
      kind: "RELEASE",
      releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
      contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
      schemaVersion: "ability-catalog-release-v1",
    };
    const releaseB: AbilityCatalogExecutionPin = {
      kind: "RELEASE",
      releaseId: "bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff",
      releaseKey: "release-b/febbbbbb",
      contentDigest: "b".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
    };
    const a = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "s",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releaseA,
    });
    const b = resolveActiveRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      activeSeasonId: "s",
      providerMode: "fixture",
      abilityCatalogExecutionPin: releaseB,
    });
    expect(a.hash).not.toBe(b.hash);
  });
});
