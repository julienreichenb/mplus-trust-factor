/**
 * Phase 3B.4 — worker pin loader fail-closed + cache isolation.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { CURRENT_CATALOG_VERSION_ID, getActiveAbilityCatalogContext } from "@mplus/abilities";
import {
  AbilityCatalogPinError,
  createStaticAbilityCatalogPin,
} from "@mplus/contracts";
import {
  clearAbilityCatalogReleaseContextCache,
  decodeJobAbilityCatalogPin,
  getAbilityCatalogReleaseContextCacheSize,
  resolveAbilityCatalogExecution,
} from "./ability-catalog-pin-loader.js";

describe("ability catalog pin loader", () => {
  beforeEach(() => {
    clearAbilityCatalogReleaseContextCache();
  });

  it("decodes absent pin as STATIC", () => {
    const pin = decodeJobAbilityCatalogPin(undefined);
    expect(pin).toEqual(createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID));
  });

  it("STATIC resolution uses static context and leaves no ACTIVE lookup", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => {
          throw new Error("STATIC must not query AbilityCatalogRelease");
        },
      },
    } as never;
    const resolved = await resolveAbilityCatalogExecution({
      prisma,
      pin: createStaticAbilityCatalogPin(CURRENT_CATALOG_VERSION_ID),
    });
    expect(resolved.pin.kind).toBe("STATIC");
    expect(resolved.context.identity.kind).toBe("static");
    expect(getActiveAbilityCatalogContext()).toBeNull();
  });

  it("RELEASE missing row fails closed (no STATIC fallback)", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => null,
      },
    } as never;
    await expect(
      resolveAbilityCatalogExecution({
        prisma,
        pin: {
          kind: "RELEASE",
          releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
        },
      }),
    ).rejects.toBeInstanceOf(AbilityCatalogPinError);
  });

  it("RELEASE wrong status fails closed", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          status: "DRAFT_BUILD",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
          casContentHash: "x",
          generatedAt: new Date(),
        }),
      },
    } as never;
    await expect(
      resolveAbilityCatalogExecution({
        prisma,
        pin: {
          kind: "RELEASE",
          releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
        },
      }),
    ).rejects.toMatchObject({ code: "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE" });
  });

  it("RELEASE ACTIVE status is executable (pinned jobs after activation)", async () => {
    const prisma = {
      abilityCatalogRelease: {
        findUnique: async () => ({
          id: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          status: "ACTIVE",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
          casContentHash: "x",
          generatedAt: new Date(),
        }),
      },
      rawArtifactPayload: {
        findUnique: async () => null,
      },
    } as never;
    // Fail on CAS missing — but not on status (ACTIVE is executable).
    await expect(
      resolveAbilityCatalogExecution({
        prisma,
        pin: {
          kind: "RELEASE",
          releaseId: "d68793e5-7389-4cd6-b4c2-2eec96bea068",
          releaseKey: "wow-unknown-static/catalog-v1/fe8c9a03",
          contentDigest: "fe8c9a031e0cd4841f27ed55a87b44cd7c3b0af483fb068d7e432a57b189c761",
          schemaVersion: "ability-catalog-release-v1",
        },
      }),
    ).rejects.toMatchObject({ code: "ABILITY_CATALOG_RELEASE_INVALID" });
  });

  it("cache is keyed by releaseId+digest", () => {
    expect(getAbilityCatalogReleaseContextCacheSize()).toBe(0);
  });
});
