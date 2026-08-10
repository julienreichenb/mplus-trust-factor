import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import {
  createBlizzardProvider,
  BlizzardTokenManager,
  BLIZZARD_REGIONS,
  CHARACTER_MEDIA_PATH_SUFFIX,
  encodeCharacterPath,
  LiveBlizzardProvider,
  getRegionConfig,
  namespaceFor,
  parseRetryAfterMs,
  errorReasonOf,
  redactSecrets,
  resolveCurrentSeasonIdFromIndex,
  sanitizeHttpsUrl,
  attachEquipmentIconUrls,
  characterProfileContainsSeason,
  normalizeCharacterAchievements,
  normalizeMythicProfileIndex,
  pickPreferredAchievementCompletion,
  pickSeasonProfileMythicRating,
} from "./index.js";
import type { FixtureBlizzardProvider } from "./fixture-provider.js";
import { fingerprintFor } from "./normalize.js";
import { BlizzardHttpClient } from "./http-client.js";
import {
  characterAchievementsSchema,
  characterAchievementEntrySchema,
  characterProfileSchema,
  equipmentSchema,
  mediaSchema,
  mythicKeystoneProfileIndexSchema,
  mythicKeystoneSeasonProfileSchema,
  periodIndexSchema,
  periodSchema,
  seasonIndexSchema,
  seasonSchema,
  specializationsSchema,
} from "./schemas.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ctx = {
  region: "EU" as const,
  requestId: "test-req",
  correlationId: null,
  forceRefresh: false,
  now: new Date().toISOString(),
};

const identity = {
  region: "EU" as const,
  realmSlug: "Tarren-Mill",
  name: "Examplecharacter",
};

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tools/fixtures/blizzard",
);

describe("Blizzard region/namespace", () => {
  it("defaults EU hosts and namespaces", () => {
    const eu = getRegionConfig("EU");
    expect(eu.apiHost).toBe("https://eu.api.blizzard.com");
    expect(namespaceFor(eu, "profile")).toBe("profile-eu");
    expect(namespaceFor(eu, "dynamic")).toBe("dynamic-eu");
    expect(namespaceFor(eu, "static")).toBe("static-eu");
    expect(eu.defaultLocale).toBe("en_GB");
  });

  it("supports US/KR/TW and rejects China", () => {
    expect(BLIZZARD_REGIONS.us.profileNamespace).toBe("profile-us");
    expect(BLIZZARD_REGIONS.kr.dynamicNamespace).toBe("dynamic-kr");
    expect(BLIZZARD_REGIONS.tw.staticNamespace).toBe("static-tw");
    expect(() => getRegionConfig("CN")).toThrow(/Unsupported Blizzard region/);
  });
});

describe("URL encoding", () => {
  it("encodes accented and apostrophe names", () => {
    expect(encodeCharacterPath("tarren-mill", "Élisé")).toContain("%C3%A9lis%C3%A9");
    expect(encodeCharacterPath("tarren-mill", "O'Connor")).toMatch(/o(%27|')connor/);
  });
});

describe("MVP response-shape contracts", () => {
  const load = (name: string) => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));

  it("validates all MVP endpoint fixtures against Zod schemas", () => {
    expect(() => characterProfileSchema.parse(load("character-profile-normal.json"))).not.toThrow();
    expect(() => equipmentSchema.parse(load("equipment-key-items.json"))).not.toThrow();
    expect(() => specializationsSchema.parse(load("specializations-multi.json"))).not.toThrow();
    expect(() => mediaSchema.parse(load("media-avatar.json"))).not.toThrow();
    expect(() => characterAchievementsSchema.parse(load("character-achievements.json"))).not.toThrow();
    expect(() =>
      mythicKeystoneProfileIndexSchema.parse(load("mythic-keystone-profile-index.json")),
    ).not.toThrow();
    expect(() =>
      mythicKeystoneSeasonProfileSchema.parse(load("mythic-keystone-season-current.json")),
    ).not.toThrow();
    expect(() => seasonIndexSchema.parse(load("season-index.json"))).not.toThrow();
    expect(() => seasonSchema.parse(load("season-current.json"))).not.toThrow();
    expect(() => periodIndexSchema.parse(load("period-index.json"))).not.toThrow();
    expect(() => periodSchema.parse(load("period-current.json"))).not.toThrow();
  });

  it("rejects malformed achievement identifiers", () => {
    expect(() =>
      characterAchievementEntrySchema.parse({
        achievement: { id: "not-a-number" },
        completed_timestamp: 1,
      }),
    ).toThrow();
    expect(() =>
      characterAchievementsSchema.parse({
        achievements: [{ completed_timestamp: 1 }],
      }),
    ).toThrow();
  });

  it("allows achievement entries without completed_timestamp", () => {
    const parsed = characterAchievementEntrySchema.parse({
      id: 11152,
      achievement: { id: 11152 },
    });
    expect(parsed.achievement?.id).toBe(11152);
    expect(parsed.completed_timestamp).toBeUndefined();
  });

  it("resolves current season from index.current_season without hardcoding", () => {
    const index = seasonIndexSchema.parse(load("season-index.json"));
    const resolved = resolveCurrentSeasonIdFromIndex(index);
    expect(resolved.seasonId).toBe(13);
    expect(resolved.source).toBe("season_index.current_season");
  });
});

describe("normalizeCharacterAchievements", () => {
  it("preserves IDs, normalizes timestamps, and sorts ascending", () => {
    const result = normalizeCharacterAchievements({
      achievements: [
        {
          id: 20526,
          achievement: { id: 20526 },
          completed_timestamp: 1735689600000,
        },
        {
          id: 6,
          achievement: { id: 6 },
          completed_timestamp: 1609459200000,
        },
        {
          achievement: { id: 11152 },
        },
      ],
    });
    expect(result.achievements.map((a) => a.achievementId)).toEqual([6, 11152, 20526]);
    expect(result.achievements[0]).toEqual({
      achievementId: 6,
      completedAt: new Date(1609459200000).toISOString(),
    });
    expect(result.achievements[1]).toEqual({
      achievementId: 11152,
      completedAt: null,
    });
  });

  it("deduplicates by preferring non-null then earlier completedAt", () => {
    const result = normalizeCharacterAchievements({
      achievements: [
        { achievement: { id: 10 }, completed_timestamp: 2_000 },
        { achievement: { id: 10 }, completed_timestamp: 1_000 },
        { achievement: { id: 10 } },
        { id: 20 },
        { achievement: { id: 20 }, completed_timestamp: 3_000 },
      ],
    });
    expect(result.achievements).toEqual([
      { achievementId: 10, completedAt: new Date(1_000).toISOString() },
      { achievementId: 20, completedAt: new Date(3_000).toISOString() },
    ]);
    expect(
      pickPreferredAchievementCompletion(
        { achievementId: 1, completedAt: null },
        { achievementId: 1, completedAt: "2020-01-01T00:00:00.000Z" },
      ).completedAt,
    ).toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("normalizeMythicProfileIndex season authority", () => {
  const identity = {
    region: "EU" as const,
    realmSlug: "tarren-mill",
    name: "Example",
  };

  it("uses authoritative season 17 when character seasons are [17, 3] in any order", () => {
    const a = normalizeMythicProfileIndex(
      {
        seasons: [{ id: 17 }, { id: 3 }],
        current_mythic_rating: { rating: 1200 },
        character: { name: "Example", realm: { slug: "tarren-mill" } },
      },
      identity,
      17,
    );
    const b = normalizeMythicProfileIndex(
      {
        seasons: [{ id: 3 }, { id: 17 }],
        current_mythic_rating: { rating: 1200 },
        character: { name: "Example", realm: { slug: "tarren-mill" } },
      },
      identity,
      17,
    );
    expect(a.currentSeasonId).toBe(17);
    expect(b.currentSeasonId).toBe(17);
  });

  it("keeps regional current season 17 when character only lists historical season 3", () => {
    const normalized = normalizeMythicProfileIndex(
      {
        seasons: [{ id: 3 }],
        current_mythic_rating: { rating: 0 },
        character: { name: "Example", realm: { slug: "tarren-mill" } },
      },
      identity,
      17,
    );
    expect(normalized.currentSeasonId).toBe(17);
    expect(normalized.seasons.map((s) => s.seasonId)).toEqual([3]);
    expect(characterProfileContainsSeason(normalized.seasons, 17)).toBe(false);
  });

  it("does not silently declare last seasons[] element authoritative without preferred id", () => {
    const normalized = normalizeMythicProfileIndex(
      {
        seasons: [{ id: 17 }, { id: 3 }],
        current_mythic_rating: { rating: 900 },
        character: { name: "Example", realm: { slug: "tarren-mill" } },
      },
      identity,
    );
    expect(normalized.currentSeasonId).toBeNull();
  });
});

describe("FixtureBlizzardProvider", () => {
  const provider = createBlizzardProvider("fixture") as FixtureBlizzardProvider;

  it("resolves realm metadata", async () => {
    const result = await provider.getRealm("tarren-mill", ctx);
    expect(result.data.slug).toBe("tarren-mill");
    expect(result.data.blizzardRealmId).toBe(1084);
    expect(result.data.connectedRealmId).toBe(1084);
    expect(result.provenance.provider).toBe("blizzard");
  });

  it("exposes legitimate and technical realms in the fixture index", async () => {
    const index = await provider.getRealmIndex(ctx);
    const names = index.data.map((r) => r.name);
    expect(names).toContain("Kazzak");
    expect(names).toContain("EU1A1-INST");
    expect(names).toContain("EU1A Account Realm");
    expect(names).toContain("Arena Tournament");
    const inst = await provider.getRealm("eu1a1inst", ctx);
    expect(inst.data.isTournament).toBe(false);
    expect(inst.data.name).toContain("INST");
    const tourney = await provider.getRealm("arena-tournament", ctx);
    expect(tourney.data.isTournament).toBe(true);
  });

  it("returns CanonicalCharacter for normal max-level EU character", async () => {
    const result = await provider.getCharacterProfile(identity, ctx);
    expect(result.data.displayName).toBe("Examplecharacter");
    expect(result.data.normalizedName).toBe("examplecharacter");
    expect(result.data.classSlug).toBe("mage");
    expect(result.data.specSlug).toBe("fire");
    expect(result.data.role).toBe("DPS");
    expect(result.data.blizzardCharacterId).toBe("123456789");
    expect(result.data.wclCanonicalId).toBeNull();
    expect(result.data.itemLevelEquipped).toBe(632);
    expect(result.data.itemLevelAverage).toBe(630);
  });

  it("emits identity diagnostics and redacted observation envelopes", async () => {
    const resolved = await provider.resolveCharacterIdentity(identity, ctx);
    expect(resolved.identityDiagnostics.matchesSubmitted).toBe(true);
    expect(resolved.observation.provider).toBe("blizzard");
    expect(JSON.stringify(resolved.observation)).not.toMatch(/Bearer|client_secret|access_token/i);
  });

  it("supports accented character names", async () => {
    const result = await provider.getCharacterProfile(
      { region: "EU", realmSlug: "tarren-mill", name: "Élisé" },
      ctx,
    );
    expect(result.data.displayName).toBe("Élisé");
    expect(result.data.normalizedName).toBe("élisé");
  });

  it("maps missing characters to NOT_FOUND", async () => {
    await expect(
      provider.getCharacterProfile({ region: "EU", realmSlug: "tarren-mill", name: "Missing" }, ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND", provider: "blizzard" });
  });

  it("normalizes equipment and key items", async () => {
    const result = await provider.getEquipmentSnapshot(identity, ctx);
    expect(result.data.equippedItemLevel).toBe(632);
    expect(Array.isArray(result.data.keyItems)).toBe(true);
    expect((result.data.keyItems as unknown[]).length).toBeGreaterThan(0);
    const items = result.data.items as Array<{
      itemLevel: number | null;
      bonusList?: number[];
      name?: string | null;
    }>;
    const trinket = items.find((i) => i.name === "Sample Key Trinket");
    expect(trinket?.itemLevel).toBe(298);
    expect(trinket?.bonusList).toEqual([6652, 7932]);
    const helm = items.find((i) => i.name === "Sample Helm");
    expect(helm?.itemLevel).toBe(629);
  });

  it("sanitizes equipment icon URLs and rejects unsafe schemes", () => {
    expect(sanitizeHttpsUrl("http://example.com/x.png")).toBeNull();
    expect(sanitizeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpsUrl("https://cdn.blizzard.com/icon.png")).toBe(
      "https://cdn.blizzard.com/icon.png",
    );

    const attached = attachEquipmentIconUrls(
      {
        id: "eq-1",
        characterSnapshotId: "c-1",
        capturedAt: new Date().toISOString(),
        averageItemLevel: 600,
        equippedItemLevel: 600,
        items: [{ itemId: 1, slot: "Head", name: "Helm", iconUrl: null }],
        keyItems: [],
        sourcePayloadId: null,
      } as never,
      new Map([[1, "https://render.worldofwarcraft.com/icons/56/inv.png"]]),
    );
    expect((attached.items as Array<{ iconUrl: string | null }>)[0]?.iconUrl).toContain("https://");
  });

  it("returns CharacterSnapshotDTO from getCharacterEquipment", async () => {
    const result = await provider.getCharacterEquipment(identity, ctx);
    expect(result.data.itemLevelEquipped).toBe(632);
    expect(result.data.mythicRating).toBeCloseTo(2845.12);
  });

  it("normalizes multi-spec talent snapshot", async () => {
    const result = await provider.getTalentSnapshot(identity, ctx);
    expect(result.data.specializationSlug).toBe("fire");
    expect(result.data.loadoutCode).toBe("C8DAH");
    const selected = (result.data.talents as { selectedTalents?: Array<{ spellId: number | null; tree: string }> })
      .selectedTalents;
    expect(selected?.length).toBe(3);
    expect(selected?.some((t) => t.tree === "CLASS" && t.spellId === 2948)).toBe(true);
    expect(selected?.some((t) => t.tree === "SPEC" && t.spellId === 11366)).toBe(true);
    expect(selected?.some((t) => t.tree === "HERO" && t.spellId === 123456)).toBe(true);
  });

  it("returns media avatar with character-media source path", async () => {
    const result = await provider.getCharacterMedia(identity, ctx);
    expect(result.data.avatarUrl).toContain("avatar.jpg");
    expect(result.provenance.sourceUrl).toContain(`/${CHARACTER_MEDIA_PATH_SUFFIX}`);
    expect(result.provenance.sourceUrl).not.toMatch(/\/media(\?|$)/);
  });

  it("returns normalized character achievements from fixture data", async () => {
    const result = await provider.getCharacterAchievements(identity, ctx);
    expect(result.metadata.endpointKey).toBe("character.achievements");
    expect(result.provenance.sourceUrl).toContain("/achievements");
    expect(result.data.achievements.map((a) => a.achievementId)).toEqual([6, 11152, 20526]);
    expect(result.data.achievements[0]?.completedAt).toBe(new Date(1609459200000).toISOString());
    expect(result.data.achievements[1]?.completedAt).toBeNull();
    expect(result.data.achievements[2]?.completedAt).toBe(new Date(1735689600000).toISOString());
  });

  it("returns mythic keystone profile and season runs", async () => {
    const index = await provider.getMythicKeystoneProfile(identity, ctx);
    expect(index.data.currentMythicRating).toBeCloseTo(2845.12);
    // Authoritative current season comes from season index, not character seasons[] order.
    expect(index.data.currentSeasonId).toBe(13);
    const authoritative = await provider.resolveAuthoritativeCurrentSeasonId(ctx);
    expect(authoritative.data.seasonId).toBe(13);
    expect(authoritative.data.slug).toBe("blizzard-season-13");
    expect(authoritative.data.source).toBe("season_index.current_season");
    const season = await provider.getMythicKeystoneSeasonProfile(identity, 13, ctx);
    expect(season.data.runs.length).toBe(1);
    expect(season.data.runs[0]?.keyLevel).toBe(12);
    expect(season.data.runs[0]?.sources[0]?.provider).toBe("BLIZZARD");
  });

  it("resolves dynamic current season/period and current-season best runs", async () => {
    const current = await provider.resolveCurrentSeasonPeriod(ctx);
    expect(current.data.seasonId).toBe(13);
    expect(current.data.periodId).toBe(952);
    const best = await provider.getCurrentSeasonBestRuns(identity, ctx);
    expect(best.data.seasonId).toBe(13);
    expect(best.data.runs.length).toBe(1);
  });

  it("returns season/dungeon indexes and item details for requested IDs only", async () => {
    const seasons = await provider.getMythicKeystoneSeasonIndex(ctx);
    expect(seasons.data.some((s) => s.blizzardSeasonId === 13)).toBe(true);
    const dungeons = await provider.getMythicKeystoneDungeonIndex(ctx);
    expect(dungeons.data[0]?.slug).toBeTruthy();
    const items = await provider.getItems([194301, 999999], ctx);
    expect(items.data).toHaveLength(1);
    expect(items.data[0]?.blizzardItemId).toBe(194301);
  });

  it("exposes leaderboard method without crawling", async () => {
    const board = await provider.getConnectedRealmMythicLeaderboard(1084, 399, 952, ctx);
    expect(board.data.connectedRealmId).toBe(1084);
    expect(Array.isArray(board.data.leadingGroups)).toBe(true);
  });

  it("maps 400/403/404/429/5xx and profile-unavailable reasons", () => {
    expect(() => provider.simulateError("429")).toThrow(ExternalApiError);
    try {
      provider.simulateError("429");
    } catch (error) {
      expect(error).toMatchObject({ code: "RATE_LIMITED" });
      expect(errorReasonOf(error)).toBe("RATE_LIMITED");
    }
    try {
      provider.simulateError("500");
    } catch (error) {
      expect(error).toMatchObject({ code: "NETWORK" });
    }
    try {
      provider.simulateError("400");
    } catch (error) {
      expect(errorReasonOf(error)).toBe("INVALID_REQUEST");
    }
    try {
      provider.simulateError("403");
    } catch (error) {
      expect(errorReasonOf(error)).toBe("PRIVATE_OR_RESTRICTED");
    }
    try {
      provider.simulateError("404");
    } catch (error) {
      expect(errorReasonOf(error)).toBe("NOT_FOUND");
    }
    try {
      provider.simulateError("profile-404");
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND" });
      expect(errorReasonOf(error)).toBe("PROFILE_UNAVAILABLE");
    }
  });
});

describe("BlizzardTokenManager", () => {
  it("caches token and deduplicates concurrent refreshes", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ access_token: "tok-abc", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const manager = new BlizzardTokenManager({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      now: () => 1_000_000,
    });

    const [a, b, c] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ]);
    expect(a).toBe("tok-abc");
    expect(b).toBe("tok-abc");
    expect(c).toBe("tok-abc");
    expect(calls).toBe(1);

    const again = await manager.getAccessToken();
    expect(again).toBe("tok-abc");
    expect(calls).toBe(1);
  });

  it("never requires logging secrets (token response isolated)", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ access_token: "super-secret-token", expires_in: 60 }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const manager = new BlizzardTokenManager({
      clientId: "client-id",
      clientSecret: "client-secret-value",
      fetchImpl,
    });
    const token = await manager.getAccessToken();
    expect(token).toBe("super-secret-token");
    const redacted = redactSecrets({
      Authorization: `Bearer ${token}`,
      client_secret: "client-secret-value",
      access_token: token,
    });
    expect(JSON.stringify(redacted)).not.toContain("super-secret-token");
    expect(JSON.stringify(redacted)).not.toContain("client-secret-value");
  });
});

describe("LiveBlizzardProvider HTTP behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses regional host/namespace and caches GETs", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      if (url.includes("/realm/")) {
        expect(url).toContain("eu.api.blizzard.com");
        expect(url).toContain("namespace=dynamic-eu");
        expect(url).toContain("locale=en_GB");
        return new Response(
          JSON.stringify({
            id: 1084,
            slug: "tarren-mill",
            name: "Tarren Mill",
            connected_realm: { href: "https://eu.api.blizzard.com/data/wow/connected-realm/1084" },
          }),
          { status: 200, headers: { etag: '"abc"' } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      defaultRegion: "eu",
      defaultLocale: "en_GB",
    });

    const first = await provider.getRealm("tarren-mill", ctx);
    const second = await provider.getRealm("tarren-mill", ctx);
    expect(first.data.slug).toBe("tarren-mill");
    expect(second.metadata.cacheHit).toBe(true);
    expect(calls.filter((u) => u.includes("/realm/")).length).toBe(1);
    expect(initAuthHeaderSafe(fetchImpl)).toBe(true);
  });

  it("calls character-media (not /media) for media endpoint", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      expect(url).toContain("/character-media");
      expect(url).not.toMatch(/\/media\?/);
      return new Response(
        JSON.stringify({
          assets: [{ key: "avatar", value: "https://render.example/avatar.jpg" }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    const media = await provider.getCharacterMedia(identity, { ...ctx, forceRefresh: true });
    expect(media.data.avatarUrl).toContain("avatar.jpg");
    expect(urls.some((u) => u.includes("/character-media"))).toBe(true);
  });

  it("fetches character achievements with profile namespace and normalized path", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      expect(url).toContain("namespace=profile-eu");
      expect(url).toContain("/profile/wow/character/tarren-mill/examplecharacter/achievements");
      return new Response(
        JSON.stringify({
          achievements: [
            {
              id: 99,
              achievement: { id: 99 },
              completed_timestamp: 1_700_000_000_000,
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    const result = await provider.getCharacterAchievements(identity, {
      ...ctx,
      forceRefresh: true,
    });
    expect(result.data.achievements).toEqual([
      { achievementId: 99, completedAt: new Date(1_700_000_000_000).toISOString() },
    ]);
    expect(result.metadata.endpointKey).toBe("character.achievements");
    expect(result.metadata.requestFingerprint.length).toBeGreaterThan(10);
    const again = await provider.getCharacterAchievements(identity, {
      ...ctx,
      forceRefresh: false,
    });
    expect(again.metadata.requestFingerprint).toBe(result.metadata.requestFingerprint);
    expect(again.metadata.cacheHit).toBe(true);
    expect(urls.filter((u) => u.includes("/achievements")).length).toBe(1);
  });

  it("maps achievements 404 to PROFILE_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    try {
      await provider.getCharacterAchievements(identity, { ...ctx, forceRefresh: true });
      expect.fail("expected achievements 404");
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND" });
      expect(errorReasonOf(error)).toBe("PROFILE_UNAVAILABLE");
    }
  });

  it("rejects malformed achievements payloads with INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ achievements: [{ completed_timestamp: 1 }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    await expect(
      provider.getCharacterAchievements(identity, { ...ctx, forceRefresh: true }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("retries 429 with Retry-After and jitter using fake timers", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ detail: "Too Many Requests" }), {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ id: 13, start_timestamp: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    const promise = provider.getMythicKeystoneSeason(13, { ...ctx, forceRefresh: true });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.data.blizzardSeasonId).toBe(13);
    expect(attempts).toBe(3);
  });

  it("maps profile 404 to PROFILE_UNAVAILABLE reason", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    try {
      await provider.getCharacterProfile(identity, { ...ctx, forceRefresh: true });
      expect.fail("expected profile 404");
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND" });
      expect(errorReasonOf(error)).toBe("PROFILE_UNAVAILABLE");
      expect((error as ExternalApiError).details).toMatchObject({
        submittedIdentity: expect.objectContaining({
          normalizedName: "examplecharacter",
        }),
      });
    }
  });

  it("rejects invalid payloads with INVALID_RESPONSE", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ not: "a realm" }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
    });

    await expect(provider.getRealm("tarren-mill", { ...ctx, forceRefresh: true })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("times out and classifies TIMEOUT", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth.battle.net")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing abort signal"));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    }) as unknown as typeof fetch;

    const provider = new LiveBlizzardProvider({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    const promise = provider.getRealm("tarren-mill", { ...ctx, forceRefresh: true });
    const assertion = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });
});

describe("Retry-After parsing", () => {
  it("supports delta-seconds and HTTP-date", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    const now = () => Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", now)).toBe(5000);
  });
});

describe("request fingerprint", () => {
  it("is stable for sorted params", () => {
    const a = fingerprintFor({
      region: "eu",
      endpointKey: "item.get",
      pathParams: { itemId: "1" },
      queryParams: { b: "2", a: "1" },
    });
    const b = fingerprintFor({
      region: "eu",
      endpointKey: "item.get",
      pathParams: { itemId: "1" },
      queryParams: { a: "1", b: "2" },
    });
    expect(a).toBe(b);
  });
});

describe("HttpClient conditional requests", () => {
  it("stores etag on success", async () => {
    const tokenManager = new BlizzardTokenManager({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 }),
      ) as unknown as typeof fetch,
    });
    const http = new BlizzardHttpClient(tokenManager, {
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { etag: '"x"', "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
        }),
      ) as unknown as typeof fetch,
    });
    const region = getRegionConfig("eu");
    const result = await http.getJson({
      regionConfig: region,
      namespaceKind: "static",
      path: "data/wow/item/1",
      endpointKey: "item.get",
      fingerprint: "fp-1",
      ttlSeconds: 60,
    });
    expect(result.etag).toBe('"x"');
    const cached = await http.getJson({
      regionConfig: region,
      namespaceKind: "static",
      path: "data/wow/item/1",
      endpointKey: "item.get",
      fingerprint: "fp-1",
      ttlSeconds: 60,
    });
    expect(cached.cacheHit).toBe(true);
  });
});

describe("pickSeasonProfileMythicRating (season-details field)", () => {
  it("prefers mythic_rating (season endpoint) over current_mythic_rating", () => {
    expect(
      pickSeasonProfileMythicRating({
        mythic_rating: { rating: 2845.5 },
        current_mythic_rating: { rating: 100 },
      }),
    ).toEqual({ rating: 2845.5 });
  });

  it("falls back to current_mythic_rating when mythic_rating absent", () => {
    expect(
      pickSeasonProfileMythicRating({
        current_mythic_rating: { rating: 900 },
      }),
    ).toEqual({ rating: 900 });
  });

  it("parses season-details payloads that only expose mythic_rating", () => {
    const parsed = mythicKeystoneSeasonProfileSchema.parse({
      season: { id: 15 },
      best_runs: [],
      mythic_rating: { rating: 3100.25 },
    });
    expect(pickSeasonProfileMythicRating(parsed)).toEqual({ rating: 3100.25 });
    const profile = normalizeMythicProfileIndex(
      {
        seasons: [{ id: 15 }],
        current_mythic_rating: pickSeasonProfileMythicRating(parsed),
      },
      { region: "EU", realmSlug: "archimonde", name: "Tester" },
      15,
    );
    expect(profile.currentMythicRating).toBe(3100.25);
  });
});

function initAuthHeaderSafe(fetchImpl: ReturnType<typeof vi.fn>): boolean {
  for (const call of fetchImpl.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    const auth = init?.headers && (init.headers as Record<string, string>).Authorization;
    if (typeof auth === "string" && auth.includes("secret")) {
      return false;
    }
  }
  return true;
}
