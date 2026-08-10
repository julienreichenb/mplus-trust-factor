/**
 * Agent 01 diagnostic freeze — public bootstrap keystone failure collapse.
 *
 * CURRENT BEHAVIOR (not a desired fix): when getMythicKeystoneProfile throws,
 * fetchBlizzardPublicBootstrap returns mythicRating=null, indistinguishable from
 * a successful provider response proving no current-season rating.
 */
import { describe, expect, it, vi } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import { fetchBlizzardPublicBootstrap } from "./character-public-bootstrap.js";

const identity = {
  region: "EU" as const,
  realmSlug: "archimonde",
  name: "PublicSearchTarget",
};

const profile = {
  region: "EU" as const,
  realmSlug: "archimonde",
  name: "PublicSearchTarget",
  displayName: "PublicSearchTarget",
  classSlug: "warlock",
  specSlug: "demonology",
  role: "DPS" as const,
  level: 90,
  faction: "HORDE" as const,
  blizzardCharacterId: "42",
};

describe("scoring-stabilization: public bootstrap keystone collapse", () => {
  it("collapses keystone provider failure to mythicRating=null (same as no rating)", async () => {
    const blizzard = {
      getCharacterProfile: vi.fn(async () => ({
        data: profile,
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
      })),
      getMythicKeystoneProfile: vi.fn(async () => {
        throw new ExternalApiError({
          message: "Blizzard keystone unavailable",
          code: "UPSTREAM_5XX",
          provider: "blizzard",
          retryable: true,
        });
      }),
    };

    const result = await fetchBlizzardPublicBootstrap(blizzard as never, identity);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mythicRating).toBeNull();
    // CURRENT: failed keystone calls are not counted in providerCalls (only success increments).
    expect(result.providerCalls).toBe(1);
    expect(blizzard.getCharacterProfile).toHaveBeenCalledTimes(1);
    expect(blizzard.getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps successful currentMythicRating when keystone succeeds", async () => {
    const blizzard = {
      getCharacterProfile: vi.fn(async () => ({
        data: profile,
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
      })),
      getMythicKeystoneProfile: vi.fn(async () => ({
        data: { currentMythicRating: 1842 },
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
      })),
    };

    const result = await fetchBlizzardPublicBootstrap(blizzard as never, identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mythicRating).toBe(1842);
  });

  it("maps successful keystone with missing rating to null (true absence)", async () => {
    const blizzard = {
      getCharacterProfile: vi.fn(async () => ({
        data: profile,
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
      })),
      getMythicKeystoneProfile: vi.fn(async () => ({
        data: { currentMythicRating: null },
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
      })),
    };

    const result = await fetchBlizzardPublicBootstrap(blizzard as never, identity);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same null as the failure path — diagnostic point for Agent 02.
    expect(result.mythicRating).toBeNull();
  });
});
