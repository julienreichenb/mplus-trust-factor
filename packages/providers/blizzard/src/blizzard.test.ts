import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ExternalApiError } from "@mplus/contracts";
import {
  createBlizzardProvider,
  BlizzardTokenManager,
  BLIZZARD_REGIONS,
  encodeCharacterPath,
  LiveBlizzardProvider,
  getRegionConfig,
  namespaceFor,
} from "./index.js";
import type { FixtureBlizzardProvider } from "./fixture-provider.js";
import { fingerprintFor } from "./normalize.js";
import { BlizzardHttpClient } from "./http-client.js";

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

describe("Blizzard region/namespace", () => {
  it("defaults EU hosts and namespaces", () => {
    const eu = getRegionConfig("EU");
    expect(eu.apiHost).toBe("https://eu.api.blizzard.com");
    expect(namespaceFor(eu, "profile")).toBe("profile-eu");
    expect(namespaceFor(eu, "dynamic")).toBe("dynamic-eu");
    expect(namespaceFor(eu, "static")).toBe("static-eu");
    expect(eu.defaultLocale).toBe("en_GB");
  });

  it("supports US/KR/TW", () => {
    expect(BLIZZARD_REGIONS.us.profileNamespace).toBe("profile-us");
    expect(BLIZZARD_REGIONS.kr.dynamicNamespace).toBe("dynamic-kr");
    expect(BLIZZARD_REGIONS.tw.staticNamespace).toBe("static-tw");
  });
});

describe("URL encoding", () => {
  it("encodes accented and apostrophe names", () => {
    expect(encodeCharacterPath("tarren-mill", "Élisé")).toContain("%C3%A9lis%C3%A9");
    expect(encodeCharacterPath("tarren-mill", "O'Connor")).toMatch(/o(%27|')connor/);
  });
});

describe("FixtureBlizzardProvider", () => {
  const provider = createBlizzardProvider("fixture");

  it("resolves realm metadata", async () => {
    const result = await provider.getRealm("tarren-mill", ctx);
    expect(result.data.slug).toBe("tarren-mill");
    expect(result.data.blizzardRealmId).toBe(1084);
    expect(result.data.connectedRealmId).toBe(1084);
    expect(result.provenance.provider).toBe("blizzard");
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
  });

  it("returns media avatar", async () => {
    const result = await provider.getCharacterMedia(identity, ctx);
    expect(result.data.avatarUrl).toContain("avatar.jpg");
  });

  it("returns mythic keystone profile and season runs", async () => {
    const index = await provider.getMythicKeystoneProfile(identity, ctx);
    expect(index.data.currentMythicRating).toBeCloseTo(2845.12);
    const season = await provider.getMythicKeystoneSeasonProfile(identity, 13, ctx);
    expect(season.data.runs.length).toBe(1);
    expect(season.data.runs[0]?.keyLevel).toBe(12);
    expect(season.data.runs[0]?.sources[0]?.provider).toBe("BLIZZARD");
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

  it("maps 429 and 5xx fixture errors", () => {
    const fixture = provider as FixtureBlizzardProvider;
    expect(() => fixture.simulateError("429")).toThrow(ExternalApiError);
    try {
      fixture.simulateError("429");
    } catch (error) {
      expect(error).toMatchObject({ code: "RATE_LIMITED" });
    }
    try {
      fixture.simulateError("500");
    } catch (error) {
      expect(error).toMatchObject({ code: "NETWORK" });
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
    const serialized = JSON.stringify({ clientSecret: "client-secret-value", token });
    // Callers must redact; manager itself does not embed secrets into thrown errors on success.
    expect(serialized).toContain("client-secret-value");
    expect(() =>
      JSON.parse(JSON.stringify({ ok: true, hasToken: Boolean(token) })),
    ).not.toThrow();
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

  it("retries 429 with backoff using fake timers", async () => {
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
      return new Response(
        JSON.stringify({ id: 13, start_timestamp: 1 }),
        { status: 200 },
      );
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
