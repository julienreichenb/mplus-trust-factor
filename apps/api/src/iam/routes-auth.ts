import type { FastifyPluginAsync } from "fastify";
import type { AppEnv } from "@mplus/config";
import { HttpError } from "../errors.js";
import type { IamAuthService } from "../iam/auth-service.js";
import { buildAccountCharactersView } from "../iam/account-characters-view.js";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from "../iam/session.js";
import { isAllowedCallbackUrl, sanitizeReturnTo } from "../iam/redirects.js";
import { parseCallbackAllowlist } from "../iam/redirects.js";
import { maskEmail } from "../lib/maskEmail.js";

const OAUTH_STATE_COOKIE = "mplus_oauth_state";

export function buildAuthRoutes(env: AppEnv, authService: IamAuthService): FastifyPluginAsync {
  return async (app) => {
    const defaultCallback = parseCallbackAllowlist(env)[0] ?? `${env.PUBLIC_BASE_URL}/api/v1/auth/battlenet/callback`;

    app.get("/api/v1/auth/battlenet/start", async (request, reply) => {
      const query = request.query as { returnTo?: string; redirectUri?: string };
      const redirectUri = query.redirectUri?.trim() || defaultCallback;
      if (!isAllowedCallbackUrl(env, redirectUri)) {
        throw HttpError.badRequest("OAUTH_CALLBACK_INVALID", "Callback URL is not allowlisted");
      }
      try {
        const started = authService.startOAuth({
          returnTo: sanitizeReturnTo(query.returnTo),
          redirectUri,
        });
        void reply.setCookie(OAUTH_STATE_COOKIE, started.stateCookieValue, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: env.NODE_ENV === "production" || env.APP_ENV === "production",
          maxAge: started.stateCookieMaxAgeSec,
        });
        return reply.redirect(started.authorizeUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "OAuth start failed";
        throw HttpError.badRequest("OAUTH_START_FAILED", message);
      }
    });

    app.get("/api/v1/auth/battlenet/callback", async (request, reply) => {
      const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      const webOrigin = env.WEB_ORIGIN.replace(/\/$/, "");

      if (query.error) {
        return reply.redirect(
          `${webOrigin}/auth/error?error=${encodeURIComponent(query.error)}&detail=${encodeURIComponent(query.error_description ?? "")}`,
        );
      }
      if (!query.code || !query.state) {
        return reply.redirect(`${webOrigin}/auth/error?error=missing_code`);
      }

      try {
        const result = await authService.completeOAuth({
          code: query.code,
          state: query.state,
          stateCookie: request.cookies?.[OAUTH_STATE_COOKIE],
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
        setSessionCookie(reply, env, result.sessionToken);
        void reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
        return reply.redirect(`${webOrigin}${result.returnTo}`);
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: string }).code)
            : "oauth_failed";
        return reply.redirect(`${webOrigin}/auth/error?error=${encodeURIComponent(code)}`);
      }
    });

    app.post("/api/v1/auth/logout", async (request, reply) => {
      const token = request.cookies?.[env.SESSION_COOKIE_NAME];
      await authService.logout(token, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      clearSessionCookie(reply, env);
      return { ok: true };
    });

    app.get("/api/v1/auth/me", async (request) => {
      if (!request.auth) {
        return { authenticated: false };
      }
      return {
        authenticated: true,
        user: {
          id: request.auth.user.id,
          displayName: request.auth.user.displayName,
          roles: request.auth.roles,
          permissions: [...request.auth.permissions],
        },
      };
    });

    app.get("/api/v1/me/battlenet", async (request) => {
      const auth = requireAuth(request);
      const account = await app.container.worker.prisma.battleNetAccount.findFirst({
        where: { userId: auth.user.id, unlinkedAt: null },
        select: {
          id: true,
          providerAccountId: true,
          battletagDisplay: true,
          linkedAt: true,
          lastOwnershipSyncAt: true,
          lastOwnershipSyncError: true,
          grantedScopes: true,
          tokenExpiresAt: true,
          user: { select: { email: true } },
        },
      });
      if (!account) {
        return { linked: false };
      }
      return {
        linked: true,
        account: {
          id: account.id,
          providerAccountId: account.providerAccountId,
          battletag: account.battletagDisplay,
          /** Masked only — never expose the full email to the Account UI. */
          emailMasked: maskEmail(account.user.email),
          linkedAt: account.linkedAt.toISOString(),
          lastOwnershipSyncAt: account.lastOwnershipSyncAt?.toISOString() ?? null,
          lastOwnershipSyncError: account.lastOwnershipSyncError,
          scopes: account.grantedScopes,
          tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
          // Explicitly never include provider tokens or full email.
        },
      };
    });

    app.get("/api/v1/me/characters", async (request) => {
      const auth = requireAuth(request);
      const query = request.query as { includeIrrelevant?: string };
      const includeIrrelevant = query.includeIrrelevant === "1" || query.includeIrrelevant === "true";
      return buildAccountCharactersView({
        prisma: app.container.worker.prisma,
        env,
        userId: auth.user.id,
        includeIrrelevant,
      });
    });

    app.post("/api/v1/me/characters/refresh-ownership", async (request) => {
      const auth = requireAuth(request);
      try {
        const result = await authService.refreshOwnershipForUser(auth.user.id, {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return { ok: true, ...result };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ownership refresh failed";
        throw HttpError.badRequest("OWNERSHIP_SYNC_FAILED", message);
      }
    });

    app.post("/api/v1/me/characters/:ownershipId/primary", async (request) => {
      const auth = requireAuth(request);
      const params = request.params as { ownershipId: string };
      try {
        await authService.setPrimaryOwnership(auth.user.id, params.ownershipId);
        return { ok: true };
      } catch {
        throw HttpError.notFound("OWNERSHIP_NOT_FOUND", "Ownership not found");
      }
    });

    app.post("/api/v1/me/battlenet/unlink", async (request) => {
      const auth = requireAuth(request);
      await authService.unlinkBattleNet(auth.user.id, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return { ok: true };
    });
  };
}
