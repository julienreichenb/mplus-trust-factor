import {
  checkActiveScoreModelVersion,
  formatActiveScoreModelVersionWarning,
  type AppEnv,
} from "@mplus/config";
import type { PrismaClient } from "@mplus/database";
import type { Logger } from "@mplus/observability";

/** Warn when env-configured model version disagrees with the DB active model. */
export async function validateActiveScoreModelAtStartup(
  env: AppEnv,
  prisma: PrismaClient,
  logger: Logger,
): Promise<void> {
  const active = await prisma.scoreModel.findFirst({
    where: { key: env.ACTIVE_SCORE_MODEL_KEY, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
  if (!active) {
    logger.warn(
      {
        modelKey: env.ACTIVE_SCORE_MODEL_KEY,
        envVersion: env.ACTIVE_SCORE_MODEL_VERSION,
      },
      "No ACTIVE score model found in database for configured ACTIVE_SCORE_MODEL_KEY",
    );
    return;
  }

  const check = checkActiveScoreModelVersion({
    envKey: env.ACTIVE_SCORE_MODEL_KEY,
    envVersion: env.ACTIVE_SCORE_MODEL_VERSION,
    dbKey: active.key,
    dbVersion: active.version,
  });
  const warning = formatActiveScoreModelVersionWarning(check);
  if (warning) {
    logger.warn(
      {
        envModel: `${check.envKey}@${check.envVersion}`,
        dbModel: `${check.dbKey}@${check.dbVersion}`,
      },
      warning,
    );
  }
}
