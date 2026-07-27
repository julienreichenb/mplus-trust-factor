import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppEnv } from "@mplus/config";
import { HttpError } from "../errors.js";

/**
 * MVP-only admin auth: constant-time comparison of `x-admin-api-key` against `env.ADMIN_API_KEY`.
 * Never expose `ADMIN_API_KEY` to public frontend bundles; this header is server-to-server only.
 */
function isValidAdminKey(env: AppEnv, provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = Buffer.from(env.ADMIN_API_KEY, "utf8");
  const actual = Buffer.from(provided, "utf8");
  // Compare lengths first: timingSafeEqual throws on mismatched lengths, and length alone
  // leaks negligible information compared to early-exit string comparison.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function extractHeader(request: FastifyRequest): string | undefined {
  const value = request.headers["x-admin-api-key"];
  return Array.isArray(value) ? value[0] : value;
}

/** Fastify preHandler enforcing admin auth; throws 401 `HttpError` when the key is missing/invalid. */
export function createAdminAuthPreHandler(env: AppEnv) {
  return async function adminAuthPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const provided = extractHeader(request);
    if (!isValidAdminKey(env, provided)) {
      throw HttpError.unauthorized("UNAUTHORIZED", "Missing or invalid x-admin-api-key header");
    }
  };
}

/** Non-throwing check used to grant cooldown/entitlement bypasses on public routes. */
export function isAdminRequest(env: AppEnv, request: FastifyRequest): boolean {
  return isValidAdminKey(env, extractHeader(request));
}
