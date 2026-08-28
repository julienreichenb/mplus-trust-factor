/**
 * Phase 3B.4 — pin identity persistence + isolation (unit).
 */

import { describe, expect, it } from "vitest";
import {
  abilityCatalogExecutionKey,
  createStaticAbilityCatalogPin,
  hashRefreshContract,
  type RefreshContractVersions,
} from "@mplus/contracts";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";

function baseContract(
  overrides: Partial<RefreshContractVersions> = {},
): RefreshContractVersions {
  return {
    scoringModelKey: "default",
    scoringModelVersion: 1,
    observationSchemaVersion: "observations-v2",
    wclAdapterVersion: "wcl",
    blizzardAdapterVersion: "blizz",
    raiderIoAdapterVersion: "rio",
    runSelectionVersion: "sel",
    abilityCatalogVersion: CURRENT_CATALOG_VERSION_ID,
    abilityCatalogExecutionKey: `static:${CURRENT_CATALOG_VERSION_ID}`,
    mechanicCatalogVersion: "mech",
    activeSeasonId: "season",
    zoneId: 1,
    partition: null,
    ...overrides,
  };
}

describe("ability catalog pin scoring identity", () => {
  it("STATIC and RELEASE pins produce distinct refresh contract hashes", () => {
    const staticHash = hashRefreshContract(baseContract());
    const releasePin = {
      kind: "RELEASE" as const,
      releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
      contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
      schemaVersion: "ability-catalog-release-v1",
    };
    const releaseHash = hashRefreshContract(
      baseContract({
        abilityCatalogVersion: releasePin.releaseKey,
        abilityCatalogExecutionKey: abilityCatalogExecutionKey(releasePin),
      }),
    );
    expect(staticHash).not.toBe(releaseHash);
  });

  it("two RELEASE pins stay isolated by execution key", () => {
    const a = abilityCatalogExecutionKey({
      kind: "RELEASE",
      releaseId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      releaseKey: "a",
      contentDigest: "a".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
    });
    const b = abilityCatalogExecutionKey({
      kind: "RELEASE",
      releaseId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      releaseKey: "b",
      contentDigest: "b".repeat(64),
      schemaVersion: "ability-catalog-release-v1",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(abilityCatalogExecutionKey(createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID)));
  });

  it("legacy parse without executionKey maps to static derivation", async () => {
    const { parseRefreshContract } = await import("@mplus/contracts");
    const parsed = parseRefreshContract({
      scoringModelKey: "default",
      scoringModelVersion: 1,
      observationSchemaVersion: "observations-v2",
      wclAdapterVersion: "wcl",
      blizzardAdapterVersion: "blizz",
      raiderIoAdapterVersion: "rio",
      runSelectionVersion: "sel",
      abilityCatalogVersion: "12.0.0/midnight-season-1",
      mechanicCatalogVersion: "mech",
      activeSeasonId: "season",
      zoneId: 1,
      partition: null,
    });
    expect(parsed?.abilityCatalogExecutionKey).toBe("static:12.0.0/midnight-season-1");
  });
});
