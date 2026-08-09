/**
 * Guards for experience-agent05-live-probe destructive evidence reset.
 * Normal invocation must never delete durable CharacterExperienceEvidence.
 */

const DESTRUCTIVE_OPT_IN = "EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET";

const PRODUCTION_LIKE_APP_ENV = new Set(["production", "staging"]);

export function assertExperienceLiveProbeDestructiveResetAllowed(env: {
  EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET?: string | undefined;
  APP_ENV?: string | undefined;
}): void {
  const optIn = String(env.EXPERIENCE_LIVE_PROBE_ALLOW_DESTRUCTIVE_RESET ?? "")
    .trim()
    .toLowerCase();
  if (optIn !== "true" && optIn !== "1") {
    throw new Error(
      `Destructive Experience evidence reset requires ${DESTRUCTIVE_OPT_IN}=true`,
    );
  }

  const appEnv = String(env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  if (PRODUCTION_LIKE_APP_ENV.has(appEnv)) {
    throw new Error(
      `Destructive Experience evidence reset is forbidden when APP_ENV=${appEnv}`,
    );
  }
}
