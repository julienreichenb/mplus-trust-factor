import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@mplus/database";
import { buildApp } from "../app.js";
import { createApiContainer, type ApiContainer } from "../container.js";
import { buildTestEnv, createTestPrismaClient } from "../test-helpers.js";
import type { BattleNetOAuthClient } from "./battlenet-oauth-client.js";
import { encryptSecret } from "./crypto.js";
import { ensureIamSeed } from "./seed.js";
import { ROLE_KEYS } from "./permissions.js";
import { randomUUID } from "node:crypto";

const { prisma, dbAvailable } = await createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

function mockOAuth(): BattleNetOAuthClient {
  return {
    buildAuthorizeUrl: ({ state, redirectUri }) =>
      `https://oauth.battle.net/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeAuthorizationCode: vi.fn(async () => ({
      access_token: "access-token-value",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh-token-value",
      scope: "openid wow.profile",
    })),
    refreshAccessToken: vi.fn(async () => ({
      access_token: "access-token-value",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh-token-value",
    })),
    fetchUserInfo: vi.fn(async () => ({
      sub: "bnet-sub-123",
      id: 123,
      battletag: "Tester#1234",
    })),
    fetchWowAccountProfile: vi.fn(async () => ({
      wow_accounts: [
        {
          id: 9,
          characters: [
            {
              id: 555001,
              name: "Ownedone",
              realm: { slug: "tarren-mill", name: "Tarren Mill" },
              level: 80,
              playable_class: { id: 8 },
              faction: { type: "HORDE" },
            },
            {
              id: 555002,
              name: "Lowbie",
              realm: { slug: "tarren-mill", name: "Tarren Mill" },
              level: 10,
              playable_class: { id: 1 },
              faction: { type: "HORDE" },
            },
          ],
        },
      ],
    })),
  };
}

describe.skipIf(!dbAvailable)("IAM auth routes", () => {
  let app: FastifyInstance;
  let container: ApiContainer;
  const oauth = mockOAuth();

  beforeAll(async () => {
    const env = buildTestEnv({
      BLIZZARD_CLIENT_ID: "test-client",
      BLIZZARD_CLIENT_SECRET: "test-secret",
      BATTLENET_OAUTH_CALLBACK_URLS: "http://localhost:3000/api/v1/auth/battlenet/callback",
      NODE_ENV: "production",
      APP_ENV: "production",
    });
    container = createApiContainer(env, {
      workerOverrides: {
        prisma: prisma as PrismaClient,
        providers: {
          blizzard: {
            name: "blizzard",
            getMythicKeystoneProfile: vi.fn(async () => ({
              data: { currentMythicRating: 2100 },
              provenance: { sourceUrl: "test", fetchedAt: new Date().toISOString() },
              metadata: { cacheHit: false, statusCode: 200 },
              freshness: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
            })),
          } as never,
        },
      },
      skipQueues: true,
      oauthClient: oauth,
    });
    await ensureIamSeed(prisma as PrismaClient);
    app = await buildApp({ env, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts OAuth with allowlisted callback and sets HttpOnly state cookie", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/battlenet/start?returnTo=/account",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("oauth.battle.net/authorize");
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeTruthy();
    const cookie = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("secure");
  });

  it("rejects non-allowlisted redirectUri", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/battlenet/start?redirectUri=https://evil.example/cb",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("OAUTH_CALLBACK_INVALID");
  });

  it("rejects OAuth state mismatch on callback", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/battlenet/callback?code=abc&state=wrong",
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain("OAUTH_STATE_MISMATCH");
  });

  it("completes OAuth, sets session cookie without provider tokens, and hides alts on public profile shape", async () => {
    const start = await app.inject({
      method: "GET",
      url: "/api/v1/auth/battlenet/start?returnTo=/account",
    });
    const setCookie = start.headers["set-cookie"];
    const stateCookie = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie))
      .split(";")[0];
    const location = String(start.headers.location);
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/api/v1/auth/battlenet/callback?code=good&state=${state}`,
      headers: { cookie: stateCookie },
    });
    expect(callback.statusCode).toBe(302);
    const sessionCookies = callback.headers["set-cookie"];
    const sessionHeader = Array.isArray(sessionCookies) ? sessionCookies.join("\n") : String(sessionCookies);
    expect(sessionHeader.toLowerCase()).toContain("httponly");
    expect(sessionHeader.toLowerCase()).toContain("secure");
    expect(sessionHeader).not.toContain("access-token-value");
    expect(sessionHeader).not.toContain("refresh-token-value");

    const sessionPair = sessionHeader
      .split("\n")
      .map((line) => line.split(";")[0])
      .find((line) => line.startsWith("mplus_session="));
    expect(sessionPair).toBeTruthy();

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sessionPair! },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json();
    expect(meBody.authenticated).toBe(true);
    expect(JSON.stringify(meBody)).not.toContain("access-token");
    expect(JSON.stringify(meBody)).not.toContain("refresh-token");

    const owned = await app.inject({
      method: "GET",
      url: "/api/v1/me/characters",
      headers: { cookie: sessionPair! },
    });
    expect(owned.statusCode).toBe(200);
    const ownedBody = owned.json();
    expect(ownedBody.totalOwnedCharacterCount).toBeGreaterThanOrEqual(2);
    expect(ownedBody.hiddenCharacterCount).toBeGreaterThanOrEqual(1);
    expect(ownedBody.characters.length).toBeGreaterThan(0);
    expect(ownedBody.characters.every((c: { relevance: { eligible: boolean } }) => c.relevance.eligible)).toBe(
      true,
    );
    expect(ownedBody.characters[0]).toMatchObject({
      name: "Ownedone",
      level: 80,
      characterClass: expect.objectContaining({ slug: "mage" }),
    });
    expect(JSON.stringify(ownedBody)).not.toContain("access-token");
    expect(ownedBody.discovery).toBeTruthy();

    const bnet = await app.inject({
      method: "GET",
      url: "/api/v1/me/battlenet",
      headers: { cookie: sessionPair! },
    });
    expect(bnet.statusCode).toBe(200);
    expect(JSON.stringify(bnet.json())).not.toContain("access-token-value");
    expect(bnet.json().account.providerAccountId).toBe("bnet-sub-123");
  });

  it("unlinks and invalidates future private sync tokens", async () => {
    const account = await prisma.battleNetAccount.findFirst({
      where: { providerAccountId: "bnet-sub-123" },
    });
    expect(account).toBeTruthy();
    const userId = account!.userId;
    const sessionToken = await container.authService.createSession({ userId });

    const unlink = await app.inject({
      method: "POST",
      url: "/api/v1/me/battlenet/unlink",
      headers: { cookie: `mplus_session=${sessionToken}` },
    });
    expect(unlink.statusCode).toBe(200);

    const updated = await prisma.battleNetAccount.findUnique({ where: { id: account!.id } });
    expect(updated?.unlinkedAt).toBeTruthy();
    expect(updated?.accessTokenEncrypted).toBeNull();
    expect(updated?.refreshTokenEncrypted).toBeNull();

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/me/characters/refresh-ownership",
      headers: { cookie: `mplus_session=${sessionToken}` },
    });
    expect(refresh.statusCode).toBe(400);
  });

  it("audits privileged admin-key cooldown bypass and still enforces normal user cooldown semantics", async () => {
    const region = await prisma.region.findFirst();
    expect(region).toBeTruthy();
    let realm = await prisma.realm.findFirst({ where: { regionId: region!.id } });
    if (!realm) {
      realm = await prisma.realm.create({
        data: {
          id: randomUUID(),
          regionId: region!.id,
          slug: "iam-test-realm",
          name: "IAM Test Realm",
        },
      });
    }
    const charName = `Iamcd${randomUUID().slice(0, 6)}`;
    const character = await prisma.character.create({
      data: {
        id: randomUUID(),
        regionId: region!.id,
        realmId: realm.id,
        normalizedName: charName.toLowerCase(),
        displayName: charName,
        lastPublicRefreshAt: new Date(),
      },
    });

    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${region!.code}/${realm.slug}/${charName}/refresh`,
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().cooldownSecondsRemaining).toBeGreaterThan(0);

    const bypass = await app.inject({
      method: "POST",
      url: `/api/v1/characters/${region!.code}/${realm.slug}/${charName}/refresh`,
      headers: { "x-admin-api-key": "test-admin-key" },
    });
    expect(bypass.statusCode).toBe(200);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "profile.refresh.cooldown_bypass", resourceId: character.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorType).toBe("admin_key");
  });

  it("does not destroy identity when Redis is unused (sessions live in Postgres)", async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        authProvider: "battlenet",
        externalSubject: `redis-loss-${randomUUID()}`,
        displayName: "RedisSafe",
        role: "USER",
      },
    });
    const role = await prisma.role.findUnique({ where: { key: ROLE_KEYS.USER } });
    if (role) {
      await prisma.userRoleAssignment.create({
        data: { id: randomUUID(), userId: user.id, roleId: role.id },
      });
    }
    const token = await container.authService.createSession({ userId: user.id });
    const resolved = await container.authService.resolveSession(token);
    expect(resolved?.user.id).toBe(user.id);
    // Identity remains queryable from Postgres without Redis.
    const persisted = await prisma.user.findUnique({ where: { id: user.id } });
    expect(persisted).toBeTruthy();
  });
});

describe("provider token encryption helpers", () => {
  it("never places raw provider tokens in encrypted blob plaintext checks", () => {
    const env = buildTestEnv();
    const enc = encryptSecret("provider-token-xyz", env.SESSION_SECRET);
    expect(enc.includes("provider-token-xyz")).toBe(false);
  });
});
