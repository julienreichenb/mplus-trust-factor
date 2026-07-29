import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "@mplus/config";
import { HttpError } from "../errors.js";
import type { AuthSessionContext, IamAuthService } from "./auth-service.js";
import { writeAuditEvent } from "./audit.js";
import { isValidAdminKey } from "../plugins/admin-auth.js";
import { PERMISSIONS, SESSION_COOKIE_PATH, type PermissionKey } from "./permissions.js";
import { hasPermission } from "./rbac.js";
import { isSecureCookie } from "./redirects.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthSessionContext | null;
    authActor?: "session" | "admin_key" | "anonymous";
  }
}

export function readSessionToken(request: FastifyRequest, env: AppEnv): string | undefined {
  const fromCookie = request.cookies?.[env.SESSION_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const header = request.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, env: AppEnv, token: string): void {
  void reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    path: SESSION_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookie(env),
    domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
    maxAge: env.SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply, env: AppEnv): void {
  void reply.clearCookie(env.SESSION_COOKIE_NAME, {
    path: SESSION_COOKIE_PATH,
    domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
  });
}

export function createSessionPreHandler(authService: IamAuthService, env: AppEnv) {
  return async function sessionPreHandler(request: FastifyRequest): Promise<void> {
    const token = readSessionToken(request, env);
    request.auth = await authService.resolveSession(token);
    request.authActor = request.auth ? "session" : "anonymous";
  };
}

export function requireAuth(request: FastifyRequest): AuthSessionContext {
  if (!request.auth) {
    throw HttpError.unauthorized("UNAUTHORIZED", "Authentication required");
  }
  return request.auth;
}

export function createPermissionPreHandler(
  env: AppEnv,
  required: PermissionKey | PermissionKey[],
  options: { allowEmergencyAdminKey?: boolean; auditAction?: string } = {},
) {
  const allowKey = options.allowEmergencyAdminKey ?? true;
  return async function permissionPreHandler(request: FastifyRequest): Promise<void> {
    if (request.auth && hasPermission(request.auth.permissions, required)) {
      request.authActor = "session";
      return;
    }

    if (
      allowKey &&
      env.ADMIN_API_KEY_EMERGENCY_FALLBACK &&
      isValidAdminKey(env, extractAdminKey(request))
    ) {
      request.authActor = "admin_key";
      if (options.auditAction) {
        await writeAuditEvent(request.server.container.worker.prisma, {
          actorType: "admin_key",
          action: options.auditAction,
          outcome: "SUCCESS",
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          sessionSecret: env.SESSION_SECRET,
          metadata: { emergencyFallback: true, path: request.url },
        });
      }
      return;
    }

    if (!request.auth && !extractAdminKey(request)) {
      throw HttpError.unauthorized("UNAUTHORIZED", "Authentication required");
    }
    if (extractAdminKey(request) && !isValidAdminKey(env, extractAdminKey(request))) {
      throw HttpError.unauthorized("UNAUTHORIZED", "Missing or invalid x-admin-api-key header");
    }
    throw HttpError.forbidden("FORBIDDEN", "Missing required permission");
  };
}

function extractAdminKey(request: FastifyRequest): string | undefined {
  const value = request.headers["x-admin-api-key"];
  return Array.isArray(value) ? value[0] : value;
}

/** Refresh authorization: admin permission, optional owner bypass, or emergency key. */
export async function resolveRefreshPrivileges(
  request: FastifyRequest,
  env: AppEnv,
  authService: IamAuthService,
  characterId: string,
): Promise<{ bypassCooldown: boolean; forceRefresh: boolean; actor: string }> {
  if (
    request.auth &&
    hasPermission(request.auth.permissions, PERMISSIONS.PROFILE_REFRESH_COOLDOWN_BYPASS)
  ) {
    return {
      bypassCooldown: true,
      forceRefresh: hasPermission(request.auth.permissions, PERMISSIONS.PROFILE_REFRESH_FORCE),
      actor: "session_admin",
    };
  }
  if (env.ADMIN_API_KEY_EMERGENCY_FALLBACK && isValidAdminKey(env, extractAdminKey(request))) {
    return { bypassCooldown: true, forceRefresh: true, actor: "admin_key" };
  }
  if (
    env.OWNER_REFRESH_COOLDOWN_BYPASS &&
    request.auth &&
    (await authService.userOwnsCharacter(request.auth.user.id, characterId))
  ) {
    return { bypassCooldown: true, forceRefresh: false, actor: "owner" };
  }
  return { bypassCooldown: false, forceRefresh: false, actor: "anonymous_or_user" };
}
