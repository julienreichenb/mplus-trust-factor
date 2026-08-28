/**
 * Product flow — ACTIVE release is the only runtime catalog authority.
 */

import { describe, expect, it, vi } from "vitest";
import { AbilityCatalogPinError } from "@mplus/contracts";
import { resolveEnqueueAbilityCatalogExecutionPin } from "./ability-catalog-enqueue-pin.js";

describe("Ability catalog product flow enqueue pin", () => {
  it("always resolves ACTIVE release without runtime mode env", async () => {
    const pin = await resolveEnqueueAbilityCatalogExecutionPin({
      prisma: {
        abilityCatalogRelease: {
          findFirst: async () => ({
            id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            releaseKey: "wow-test/catalog-v1/abc12345",
            contentDigest: "a".repeat(64),
            schemaVersion: "ability-catalog-release-v1",
            status: "ACTIVE",
          }),
        },
      } as never,
    });
    expect(pin.kind).toBe("RELEASE");
    expect(pin.releaseKey).toBe("wow-test/catalog-v1/abc12345");
  });

  it("fail closed when no ACTIVE release", async () => {
    await expect(
      resolveEnqueueAbilityCatalogExecutionPin({
        prisma: {
          abilityCatalogRelease: { findFirst: async () => null },
        } as never,
      }),
    ).rejects.toMatchObject({
      code: "ABILITY_CATALOG_RELEASE_NOT_FOUND",
    });
  });

  it("does not fall back to static registry", async () => {
    const findFirst = vi.fn(async () => null);
    await expect(
      resolveEnqueueAbilityCatalogExecutionPin({
        prisma: { abilityCatalogRelease: { findFirst } } as never,
      }),
    ).rejects.toBeInstanceOf(AbilityCatalogPinError);
    expect(findFirst).toHaveBeenCalledOnce();
  });
});
