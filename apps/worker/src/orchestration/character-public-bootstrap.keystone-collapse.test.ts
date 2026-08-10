/**
 * Agent 02 acceptance — public bootstrap current-season Mythic+ states.
 *
 * Provider failure must NEVER collapse into confirmed no-score.
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

describe("scoring-stabilization: public bootstrap current-season Mythic states", () => {
  it("provider keystone failure is UNKNOWN (not confirmed no-score)", async () => {
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
    expect(result.currentSeasonMythic.state).toBe("UNKNOWN");
    expect(result.mythicRating).toBeNull();
    expect(result.providerCalls).toBe(2);
    expect(blizzard.getCharacterProfile).toHaveBeenCalledTimes(1);
    expect(blizzard.getMythicKeystoneProfile).toHaveBeenCalledTimes(1);
  });

  it("keeps successful currentMythicRating as HAS_SCORE", async () => {
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
    expect(result.currentSeasonMythic).toEqual({ state: "HAS_SCORE", rating: 1842 });
    expect(result.mythicRating).toBe(1842);
  });

  it("successful keystone with missing rating is CONFIRMED_NO_SCORE", async () => {
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
    expect(result.currentSeasonMythic.state).toBe("CONFIRMED_NO_SCORE");
    expect(result.mythicRating).toBeNull();
    expect(result.providerCalls).toBe(2);
  });
});
