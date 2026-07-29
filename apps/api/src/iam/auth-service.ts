import { randomUUID } from "node:crypto";
import type { AppEnv } from "@mplus/config";
import { providerTokenEncryptionSecret } from "@mplus/config";
import type { Prisma, PrismaClient, User } from "@mplus/database";
import { writeAuditEvent } from "./audit.js";
import type { BattleNetOAuthClient } from "./battlenet-oauth-client.js";
import {
  decryptSecret,
  encryptSecret,
  hashIdentifier,
  hashToken,
  randomUrlToken,
} from "./crypto.js";
import { syncVerifiedOwnership } from "./ownership-sync.js";
import { BATTLENET_PROVIDER, ROLE_KEYS } from "./permissions.js";
import { loadUserPermissionKeys } from "./rbac.js";
import { isAllowedCallbackUrl, sanitizeReturnTo } from "./redirects.js";

/** MVP: ownership sync is EU-only. */
export const OWNERSHIP_SYNC_SUPPORTED_REGIONS = ["eu"] as const;

export function resolveOwnershipSyncRegion(env: AppEnv): "eu" {
  const configured = (env.BATTLENET_OWNERSHIP_SYNC_REGION || "eu").trim().toLowerCase();
  if (configured !== "eu") {
    throw Object.assign(
      new Error(
        `Ownership sync region '${configured}' is not supported. MVP supports EU only (set BATTLENET_OWNERSHIP_SYNC_REGION=eu).`,
      ),
      { code: "OWNERSHIP_REGION_UNSUPPORTED" },
    );
  }
  return "eu";
}

export interface AuthSessionContext {
  user: User;
  sessionId: string;
  permissions: Set<string>;
  roles: string[];
}


export interface OAuthStartResult {
  authorizeUrl: string;
  stateCookieValue: string;
  stateCookieMaxAgeSec: number;
}

interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  nonce: string;
  createdAt: number;
}

export class IamAuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly oauth: BattleNetOAuthClient,
  ) {}

  startOAuth(input: { returnTo?: string; redirectUri: string }): OAuthStartResult {
    if (!isAllowedCallbackUrl(this.env, input.redirectUri)) {
      throw new Error("OAuth callback URL is not allowlisted");
    }
    if (!this.env.BLIZZARD_CLIENT_ID || !this.env.BLIZZARD_CLIENT_SECRET) {
      throw new Error("Battle.net OAuth client credentials are not configured");
    }

    const state = randomUrlToken(24);
    const codeVerifier = randomUrlToken(32);
    const payload: OAuthStatePayload = {
      state,
      codeVerifier,
      redirectUri: input.redirectUri,
      returnTo: sanitizeReturnTo(input.returnTo),
      nonce: randomUrlToken(16),
      createdAt: Date.now(),
    };
    const stateCookieValue = encryptSecret(JSON.stringify(payload), this.env.SESSION_SECRET);
    const authorizeUrl = this.oauth.buildAuthorizeUrl({
      redirectUri: input.redirectUri,
      state,
      codeVerifier,
      scopes: this.env.BATTLENET_OAUTH_SCOPES,
    });
    return {
      authorizeUrl,
      stateCookieValue,
      stateCookieMaxAgeSec: this.env.OAUTH_STATE_TTL_SECONDS,
    };
  }

  parseStateCookie(raw: string | undefined): OAuthStatePayload | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(decryptSecret(raw, this.env.SESSION_SECRET)) as OAuthStatePayload;
      if (!parsed.state || !parsed.codeVerifier || !parsed.redirectUri) return null;
      if (Date.now() - parsed.createdAt > this.env.OAUTH_STATE_TTL_SECONDS * 1000) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async completeOAuth(input: {
    code: string;
    state: string;
    stateCookie: string | undefined;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ sessionToken: string; returnTo: string; userId: string }> {
    const payload = this.parseStateCookie(input.stateCookie);
    if (!payload || payload.state !== input.state) {
      await writeAuditEvent(this.prisma, {
        actorType: "anonymous",
        action: "auth.oauth.state_mismatch",
        outcome: "DENIED",
        ip: input.ip,
        userAgent: input.userAgent,
        sessionSecret: this.env.SESSION_SECRET,
      });
      throw Object.assign(new Error("OAuth state mismatch"), { code: "OAUTH_STATE_MISMATCH" });
    }

    const tokens = await this.oauth.exchangeAuthorizationCode({
      code: input.code,
      redirectUri: payload.redirectUri,
      codeVerifier: payload.codeVerifier,
    });

    const userInfo = await this.oauth.fetchUserInfo(tokens.access_token);
    const providerAccountId = String(userInfo.sub ?? userInfo.id ?? "");
    if (!providerAccountId) {
      throw Object.assign(new Error("Battle.net userinfo missing durable account id"), {
        code: "OAUTH_USERINFO_INVALID",
      });
    }
    const battletag = typeof userInfo.battletag === "string" ? userInfo.battletag : null;
    const battletagHash = hashIdentifier(battletag ?? providerAccountId, this.env.SESSION_SECRET);

    const user = await this.upsertBattleNetUser({
      providerAccountId,
      battletag,
      battletagHash,
      tokens,
      userInfo,
    });

    const sessionToken = await this.createSession({
      userId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    await writeAuditEvent(this.prisma, {
      userId: user.id,
      actorType: "user",
      action: "auth.oauth.login",
      resourceType: "user",
      resourceId: user.id,
      ip: input.ip,
      userAgent: input.userAgent,
      sessionSecret: this.env.SESSION_SECRET,
      metadata: { provider: BATTLENET_PROVIDER },
    });

    // Best-effort ownership sync; login still succeeds if profile API is down.
    try {
      await this.refreshOwnershipForUser(user.id, {
        ip: input.ip,
        userAgent: input.userAgent,
      });
    } catch {
      // audited inside refreshOwnershipForUser
    }

    return { sessionToken, returnTo: payload.returnTo, userId: user.id };
  }

  private async upsertBattleNetUser(input: {
    providerAccountId: string;
    battletag: string | null;
    battletagHash: string;
    tokens: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    userInfo: Record<string, unknown>;
  }): Promise<User> {
    const tokenSecret = providerTokenEncryptionSecret(this.env);
    const accessTokenEncrypted = encryptSecret(input.tokens.access_token, tokenSecret);
    const refreshTokenEncrypted = input.tokens.refresh_token
      ? encryptSecret(input.tokens.refresh_token, tokenSecret)
      : null;
    const tokenExpiresAt = new Date(Date.now() + input.tokens.expires_in * 1000);

    const existingIdentity = await this.prisma.externalIdentity.findUnique({
      where: {
        provider_subject: { provider: BATTLENET_PROVIDER, subject: input.providerAccountId },
      },
      include: { user: true },
    });

    const userRole = await this.prisma.role.findUnique({ where: { key: ROLE_KEYS.USER } });

    if (existingIdentity) {
      const user = await this.prisma.user.update({
        where: { id: existingIdentity.userId },
        data: {
          displayName: input.battletag ?? existingIdentity.user.displayName,
          updatedAt: new Date(),
        },
      });
      await this.prisma.externalIdentity.update({
        where: { id: existingIdentity.id },
        data: {
          displayName: input.battletag,
          rawProfile: input.userInfo as Prisma.InputJsonValue,
          lastLoginAt: new Date(),
        },
      });
      await this.prisma.battleNetAccount.upsert({
        where: { providerAccountId: input.providerAccountId },
        create: {
          id: randomUUID(),
          userId: user.id,
          providerAccountId: input.providerAccountId,
          battletagHash: input.battletagHash,
          battletagDisplay: input.battletag,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt,
          grantedScopes: input.tokens.scope ?? this.env.BATTLENET_OAUTH_SCOPES,
          claimed: true,
          linkedAt: new Date(),
          unlinkedAt: null,
        },
        update: {
          userId: user.id,
          battletagHash: input.battletagHash,
          battletagDisplay: input.battletag,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiresAt,
          grantedScopes: input.tokens.scope ?? this.env.BATTLENET_OAUTH_SCOPES,
          claimed: true,
          unlinkedAt: null,
          linkedAt: new Date(),
        },
      });
      if (userRole) {
        await this.prisma.userRoleAssignment.upsert({
          where: { userId_roleId: { userId: user.id, roleId: userRole.id } },
          create: { id: randomUUID(), userId: user.id, roleId: userRole.id },
          update: {},
        });
      }
      return user;
    }

    const user = await this.prisma.user.create({
      data: {
        id: randomUUID(),
        displayName: input.battletag,
        role: "USER",
        authProvider: BATTLENET_PROVIDER,
        externalSubject: input.providerAccountId,
        externalIdentities: {
          create: {
            id: randomUUID(),
            provider: BATTLENET_PROVIDER,
            subject: input.providerAccountId,
            displayName: input.battletag,
            rawProfile: input.userInfo as Prisma.InputJsonValue,
            lastLoginAt: new Date(),
          },
        },
        battleNetAccounts: {
          create: {
            id: randomUUID(),
            providerAccountId: input.providerAccountId,
            battletagHash: input.battletagHash,
            battletagDisplay: input.battletag,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenExpiresAt,
            grantedScopes: input.tokens.scope ?? this.env.BATTLENET_OAUTH_SCOPES,
            claimed: true,
          },
        },
      },
    });

    if (userRole) {
      await this.prisma.userRoleAssignment.create({
        data: { id: randomUUID(), userId: user.id, roleId: userRole.id },
      });
    }
    return user;
  }

  async createSession(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
    rotatedFromId?: string | null;
  }): Promise<string> {
    const token = randomUrlToken(32);
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_SECONDS * 1000);
    await this.prisma.userSession.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        tokenHash: hashToken(token),
        expiresAt,
        rotatedFromId: input.rotatedFromId ?? null,
        ipHash: input.ip ? hashIdentifier(input.ip, this.env.SESSION_SECRET) : null,
        userAgentHash: input.userAgent
          ? hashIdentifier(input.userAgent, this.env.SESSION_SECRET)
          : null,
      },
    });
    return token;
  }

  async resolveSession(token: string | undefined): Promise<AuthSessionContext | null> {
    if (!token) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    if (session.user.disabledAt) {
      return null;
    }
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    const permissions = await loadUserPermissionKeys(this.prisma, session.userId);
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId: session.userId },
      include: { role: true },
    });
    return {
      user: session.user,
      sessionId: session.id,
      permissions,
      roles: assignments.map((a) => a.role.key),
    };
  }

  async logout(token: string | undefined, meta: { ip?: string | null; userAgent?: string | null }) {
    if (!token) return;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!session || session.revokedAt) return;
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await writeAuditEvent(this.prisma, {
      userId: session.userId,
      actorType: "user",
      action: "auth.logout",
      resourceType: "session",
      resourceId: session.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      sessionSecret: this.env.SESSION_SECRET,
    });
  }

  async refreshOwnershipForUser(
    userId: string,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ) {
    const account = await this.prisma.battleNetAccount.findFirst({
      where: { userId, unlinkedAt: null },
      orderBy: { linkedAt: "desc" },
    });
    if (!account?.accessTokenEncrypted) {
      throw Object.assign(new Error("No linked Battle.net account"), { code: "BNET_NOT_LINKED" });
    }

    const tokenSecret = providerTokenEncryptionSecret(this.env);
    let accessToken = decryptSecret(account.accessTokenEncrypted, tokenSecret);
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000) {
      if (!account.refreshTokenEncrypted) {
        throw Object.assign(new Error("Battle.net token expired"), { code: "BNET_TOKEN_EXPIRED" });
      }
      const refreshed = await this.oauth.refreshAccessToken(
        decryptSecret(account.refreshTokenEncrypted, tokenSecret),
      );
      accessToken = refreshed.access_token;
      await this.prisma.battleNetAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEncrypted: encryptSecret(refreshed.access_token, tokenSecret),
          refreshTokenEncrypted: refreshed.refresh_token
            ? encryptSecret(refreshed.refresh_token, tokenSecret)
            : account.refreshTokenEncrypted,
          tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
          grantedScopes: refreshed.scope ?? account.grantedScopes,
        },
      });
    }

    const region = resolveOwnershipSyncRegion(this.env);
    try {
      const profile = await this.oauth.fetchWowAccountProfile(accessToken, region);
      const result = await syncVerifiedOwnership({
        prisma: this.prisma,
        userId,
        battleNetAccountId: account.id,
        regionCode: region,
        profile,
      });
      await this.prisma.battleNetAccount.update({
        where: { id: account.id },
        data: { lastOwnershipSyncAt: new Date(), lastOwnershipSyncError: null },
      });
      await writeAuditEvent(this.prisma, {
        userId,
        actorType: "user",
        action: "ownership.sync",
        resourceType: "battlenet_account",
        resourceId: account.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        sessionSecret: this.env.SESSION_SECRET,
        metadata: result as unknown as Record<string, unknown>,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ownership sync failed";
      await this.prisma.battleNetAccount.update({
        where: { id: account.id },
        data: { lastOwnershipSyncError: message },
      });
      await writeAuditEvent(this.prisma, {
        userId,
        actorType: "user",
        action: "ownership.sync",
        resourceType: "battlenet_account",
        resourceId: account.id,
        outcome: "FAILURE",
        ip: meta.ip,
        userAgent: meta.userAgent,
        sessionSecret: this.env.SESSION_SECRET,
        metadata: { error: message },
      });
      throw error;
    }
  }

  async unlinkBattleNet(
    userId: string,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ) {
    const account = await this.prisma.battleNetAccount.findFirst({
      where: { userId, unlinkedAt: null },
    });
    if (!account) return;

    await this.prisma.battleNetAccount.update({
      where: { id: account.id },
      data: {
        unlinkedAt: new Date(),
        claimed: false,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
      },
    });
    await this.prisma.verifiedCharacterOwnership.updateMany({
      where: { battleNetAccountId: account.id, status: "CURRENT" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await writeAuditEvent(this.prisma, {
      userId,
      actorType: "user",
      action: "auth.battlenet.unlink",
      resourceType: "battlenet_account",
      resourceId: account.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      sessionSecret: this.env.SESSION_SECRET,
    });
  }

  async setPrimaryOwnership(userId: string, ownershipId: string) {
    const ownership = await this.prisma.verifiedCharacterOwnership.findFirst({
      where: { id: ownershipId, userId, status: "CURRENT" },
    });
    if (!ownership) {
      throw Object.assign(new Error("Ownership not found"), { code: "OWNERSHIP_NOT_FOUND" });
    }
    await this.prisma.$transaction([
      this.prisma.verifiedCharacterOwnership.updateMany({
        where: { userId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.prisma.verifiedCharacterOwnership.update({
        where: { id: ownershipId },
        data: { isPrimary: true },
      }),
    ]);
  }

  async userOwnsCharacter(userId: string, characterId: string): Promise<boolean> {
    const row = await this.prisma.verifiedCharacterOwnership.findFirst({
      where: {
        userId,
        characterId,
        status: "CURRENT",
        battleNetAccount: { unlinkedAt: null },
      },
    });
    return Boolean(row);
  }
}
