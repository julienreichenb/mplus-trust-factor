import type { AppEnv } from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import { grantAdminRole, type GrantAdminLookup, type GrantAdminResult } from "./grant-admin.js";

export type BootstrapAdminOutcome =
  | { status: "skipped"; reason: "not_configured" }
  | { status: "granted"; result: GrantAdminResult }
  | { status: "already_admin"; result: GrantAdminResult };

export class BootstrapAdminError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BootstrapAdminError";
    this.code = code;
  }
}

/** Resolve bootstrap lookup from env. Throws when both identities are set. */
export function resolveBootstrapLookup(env: AppEnv): GrantAdminLookup | null {
  const userId = env.ADMIN_BOOTSTRAP_USER_ID;
  const subject = env.ADMIN_BOOTSTRAP_BATTLENET_SUBJECT;
  if (userId && subject) {
    throw new BootstrapAdminError(
      "AMBIGUOUS_BOOTSTRAP_CONFIG",
      "Provide exactly one of ADMIN_BOOTSTRAP_USER_ID or ADMIN_BOOTSTRAP_BATTLENET_SUBJECT",
    );
  }
  if (userId) return { kind: "userId", userId };
  if (subject) return { kind: "battlenetSubject", subject };
  return null;
}

/**
 * Idempotent first-admin bootstrap for deployment/startup.
 * No public HTTP endpoint. Fails loudly when the configured identity is missing or ambiguous.
 */
export async function runAdminBootstrap(
  prisma: PrismaClient,
  env: AppEnv,
): Promise<BootstrapAdminOutcome> {
  const lookup = resolveBootstrapLookup(env);
  if (!lookup) {
    return { status: "skipped", reason: "not_configured" };
  }

  try {
    const result = await grantAdminRole(prisma, lookup, {
      sessionSecret: env.SESSION_SECRET,
      actorLabel: "startup-bootstrap",
    });
    return result.alreadyAdmin
      ? { status: "already_admin", result }
      : { status: "granted", result };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "BOOTSTRAP_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    throw new BootstrapAdminError(code, message);
  }
}

/**
 * After a configured bootstrap, refuse to leave emergency API-key fallback silently enabled
 * in shared environments (staging/production/test deploy). Local development may warn only.
 */
export function assertEmergencyFallbackPolicy(
  env: AppEnv,
  bootstrapConfigured: boolean,
): { ok: true } | { ok: false; message: string } {
  if (!bootstrapConfigured || !env.ADMIN_API_KEY_EMERGENCY_FALLBACK) {
    return { ok: true };
  }
  const sharedEnv = env.APP_ENV === "staging" || env.APP_ENV === "production" || env.APP_ENV === "test";
  const message =
    "ADMIN_BOOTSTRAP_* is configured while ADMIN_API_KEY_EMERGENCY_FALLBACK=true. " +
    "Disable the emergency shared key after first-admin bootstrap (set ADMIN_API_KEY_EMERGENCY_FALLBACK=false).";
  if (sharedEnv) {
    return { ok: false, message };
  }
  return { ok: true };
}
