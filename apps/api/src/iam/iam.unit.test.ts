import { describe, expect, it, vi } from "vitest";
import { encryptSecret, decryptSecret, hashToken, pkceChallengeS256, safeEqualString } from "./crypto.js";
import { sanitizeReturnTo, isAllowedCallbackUrl, isSecureCookie } from "./redirects.js";
import { createBattleNetOAuthClient } from "./battlenet-oauth-client.js";
import { IamAuthService } from "./auth-service.js";
import { syncVerifiedOwnership } from "./ownership-sync.js";
import { buildTestEnv } from "../test-helpers.js";
import type { PrismaClient } from "@mplus/database";
import { PERMISSIONS } from "./permissions.js";
import { hasPermission } from "./rbac.js";

describe("IAM crypto and redirects", () => {
  it("encrypts provider tokens without leaking plaintext round-trip failures", () => {
    const secret = "test-session-secret-at-least-32-chars!!";
    const token = "bn_access_token_super_secret";
    const enc = encryptSecret(token, secret);
    expect(enc).not.toContain(token);
    expect(decryptSecret(enc, secret)).toBe(token);
  });

  it("rejects open redirects", () => {
    expect(sanitizeReturnTo("https://evil.example/phish")).toBe("/account");
    expect(sanitizeReturnTo("//evil.example")).toBe("/account");
    expect(sanitizeReturnTo("\\evil")).toBe("/account");
    expect(sanitizeReturnTo("/account/settings")).toBe("/account/settings");
  });

  it("enforces callback allowlist", () => {
    const env = buildTestEnv({
      BATTLENET_OAUTH_CALLBACK_URLS: "http://localhost:3000/api/v1/auth/battlenet/callback",
    });
    expect(isAllowedCallbackUrl(env, "http://localhost:3000/api/v1/auth/battlenet/callback")).toBe(true);
    expect(isAllowedCallbackUrl(env, "https://evil.example/callback")).toBe(false);
  });

  it("marks session cookies secure in production", () => {
    expect(isSecureCookie(buildTestEnv({ NODE_ENV: "production", APP_ENV: "production" }))).toBe(true);
    expect(isSecureCookie(buildTestEnv({ NODE_ENV: "development", APP_ENV: "development" }))).toBe(false);
  });

  it("produces PKCE S256 challenges", () => {
    const challenge = pkceChallengeS256("verifier");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(safeEqualString(hashToken("a"), hashToken("a"))).toBe(true);
  });
});

describe("OAuth state mismatch", () => {
  it("rejects callback when state cookie does not match", async () => {
    const env = buildTestEnv({
      BLIZZARD_CLIENT_ID: "cid",
      BLIZZARD_CLIENT_SECRET: "csecret",
    });
    const oauth = createBattleNetOAuthClient(env, vi.fn() as unknown as typeof fetch);
    const prisma = {
      auditEvent: { create: vi.fn(async () => ({})) },
    } as unknown as PrismaClient;
    const service = new IamAuthService(prisma, env, oauth);
    await expect(
      service.completeOAuth({
        code: "abc",
        state: "attacker-state",
        stateCookie: undefined,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_MISMATCH" });
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });
});

describe("ownership sync", () => {
  it("requires provider-backed character ids and retains durable id across rename", async () => {
    const updates: unknown[] = [];
    const upserts: unknown[] = [];
    const prisma = {
      region: {
        findUnique: vi.fn(async () => ({ id: "region-eu", code: "EU" })),
      },
      character: {
        findFirst: vi.fn(async () => ({
          id: "char-1",
          blizzardCharacterId: 42n,
          realm: { slug: "tarren-mill" },
        })),
        update: vi.fn(async () => ({})),
      },
      verifiedCharacterOwnership: {
        upsert: vi.fn(async (args: unknown) => {
          upserts.push(args);
          return { id: "own-1", isPrimary: false };
        }),
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async (args: unknown) => {
          updates.push(args);
          return { count: 0 };
        }),
        count: vi.fn(async () => 1),
      },
    } as unknown as PrismaClient;

    await syncVerifiedOwnership({
      prisma,
      userId: "user-1",
      battleNetAccountId: "bnet-1",
      regionCode: "eu",
      profile: {
        wow_accounts: [
          {
            id: 1,
            characters: [
              {
                id: 42,
                name: "Newname",
                realm: { slug: "tarren-mill", name: "Tarren Mill" },
                level: 80,
              },
            ],
          },
        ],
      },
    });

    expect(upserts.length).toBe(1);
    const upsert = upserts[0] as {
      where: { battleNetAccountId_blizzardCharacterId: { blizzardCharacterId: bigint } };
      update: { characterName: string };
    };
    expect(upsert.where.battleNetAccountId_blizzardCharacterId.blizzardCharacterId).toBe(42n);
    expect(upsert.update.characterName).toBe("Newname");
  });
});

describe("RBAC helpers", () => {
  it("requires cooldown bypass permission for privileged refresh", () => {
    const userPerms = new Set<string>([PERMISSIONS.PROFILE_REFRESH_REQUEST]);
    const adminPerms = new Set<string>([
      PERMISSIONS.PROFILE_REFRESH_REQUEST,
      PERMISSIONS.PROFILE_REFRESH_COOLDOWN_BYPASS,
    ]);
    expect(hasPermission(userPerms, PERMISSIONS.PROFILE_REFRESH_COOLDOWN_BYPASS)).toBe(false);
    expect(hasPermission(adminPerms, PERMISSIONS.PROFILE_REFRESH_COOLDOWN_BYPASS)).toBe(true);
  });
});
