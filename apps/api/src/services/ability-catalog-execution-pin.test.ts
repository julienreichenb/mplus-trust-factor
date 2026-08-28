/**
 * Server-side pin resolution — never trusts client digests.
 */

import { describe, expect, it } from "vitest";
import { AbilityCatalogPinError } from "@mplus/contracts";
import {
  resolveReleaseAbilityCatalogExecutionPin,
  resolveStaticAbilityCatalogExecutionPin,
} from "./ability-catalog-execution-pin.js";

describe("ability-catalog-execution-pin server resolve", () => {
  it("STATIC pin uses catalog version id", () => {
    const pin = resolveStaticAbilityCatalogExecutionPin("12.0.0/midnight-season-1");
    expect(pin).toEqual({
      kind: "STATIC",
      catalogVersionId: "12.0.0/midnight-season-1",
    });
  });

  it("RELEASE pin is built from DB row (client digest ignored)", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest:
            "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
          status: "VALIDATED",
        }),
      },
    } as never;
    const pin = await resolveReleaseAbilityCatalogExecutionPin({
      prisma,
      releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
    });
    expect(pin.kind).toBe("RELEASE");
    if (pin.kind === "RELEASE") {
      expect(pin.contentDigest).toBe(
        "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
      );
      expect(pin.releaseKey).toBe("wow-unknown-static/catalog-v1/fe8c9a03");
    }
  });

  it("rejects DRAFT_BUILD (no ACTIVE requirement; VALIDATED only)", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          releaseKey: "x",
          contentDigest: "a".repeat(64),
          schemaVersion: "ability-catalog-release-v1",
          status: "DRAFT_BUILD",
        }),
      },
    } as never;
    await expect(
      resolveReleaseAbilityCatalogExecutionPin({
        prisma,
        releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      }),
    ).rejects.toMatchObject({ code: "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE" });
  });

  it("rejects missing release", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => null,
      },
    } as never;
    await expect(
      resolveReleaseAbilityCatalogExecutionPin({
        prisma,
        releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
      }),
    ).rejects.toBeInstanceOf(AbilityCatalogPinError);
  });
});
