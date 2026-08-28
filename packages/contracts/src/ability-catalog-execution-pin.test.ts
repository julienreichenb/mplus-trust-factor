/**
 * Phase 3B.4 — ability catalog execution pin contracts.
 */

import { describe, expect, it } from "vitest";
import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  abilityCatalogExecutionKey,
  abilityCatalogExecutionPinSchema,
  createStaticAbilityCatalogPin,
  decodeAbilityCatalogExecutionPin,
  refreshCharacterJobSchema,
} from "@mplus/contracts";

describe("ability catalog execution pin contract", () => {
  it("accepts STATIC and RELEASE schemas", () => {
    expect(
      abilityCatalogExecutionPinSchema.parse({
        kind: "STATIC",
        catalogVersionId: CURRENT_CATALOG_VERSION_ID,
      }).kind,
    ).toBe("STATIC");
    expect(
      abilityCatalogExecutionPinSchema.parse({
        kind: "RELEASE",
        releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
        releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
        contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
        schemaVersion: "ability-catalog-release-v1",
      }).kind,
    ).toBe("RELEASE");
  });

  it("rejects unknown kind and forged incomplete RELEASE", () => {
    expect(() =>
      abilityCatalogExecutionPinSchema.parse({ kind: "ACTIVE", catalogVersionId: "x" }),
    ).toThrow();
    expect(() =>
      abilityCatalogExecutionPinSchema.parse({
        kind: "RELEASE",
        releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      }),
    ).toThrow();
  });

  it("legacy absent job pin decodes to STATIC", () => {
    const pin = decodeAbilityCatalogExecutionPin(null, CURRENT_CATALOG_VERSION_ID);
    expect(pin).toEqual(createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID));
    expect(abilityCatalogExecutionKey(pin)).toBe(`static:${CURRENT_CATALOG_VERSION_ID}`);
  });

  it("old refresh payloads without pin still parse", () => {
    const job = refreshCharacterJobSchema.parse({
      region: "EU",
      realmSlug: "kazzak",
      name: "Test",
      requestedAt: "2026-08-16T00:00:00.000Z",
    });
    expect(job.abilityCatalogExecutionPin).toBeUndefined();
    const decoded = decodeAbilityCatalogExecutionPin(
      job.abilityCatalogExecutionPin,
      CURRENT_CATALOG_VERSION_ID,
    );
    expect(decoded.kind).toBe("STATIC");
  });

  it("execution keys distinguish STATIC vs RELEASE", () => {
    const a = createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID);
    const b = abilityCatalogExecutionPinSchema.parse({
      kind: "RELEASE",
      releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
      contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
      schemaVersion: "ability-catalog-release-v1",
    });
    expect(abilityCatalogExecutionKey(a)).not.toBe(abilityCatalogExecutionKey(b));
  });
});
