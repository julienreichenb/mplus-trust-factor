/** Shared production / non-local refusal for ability-catalog:dev:reset. */
export function assertLocalDevResetAllowed(
  env: Record<string, string | undefined> = process.env,
): void {
  const nodeEnv = (env.NODE_ENV ?? "").toLowerCase();
  const appEnv = (env.APP_ENV ?? env.MPLUS_ENV ?? "").toLowerCase();
  if (nodeEnv === "production" || appEnv === "production" || appEnv === "prod") {
    throw new Error("REFUSED: ability-catalog:dev:reset must not run in production");
  }
  if (env.ABILITY_CATALOG_ALLOW_DEV_RESET === "1" || env.MPLUS_ALLOW_DEV_RESET === "1") {
    return;
  }
  const db = env.DATABASE_URL ?? "";
  // Only the URL host/credentials decide locality — NODE_ENV=development must not
  // allow a remote DATABASE_URL through without an explicit override.
  const looksLocalUrl = /localhost|127\.0\.0\.1|@postgres:|mplus:mplus@/i.test(db);
  if (!looksLocalUrl) {
    throw new Error(
      "REFUSED: DATABASE_URL does not look local. Set ABILITY_CATALOG_ALLOW_DEV_RESET=1 to override (never in production).",
    );
  }
}
