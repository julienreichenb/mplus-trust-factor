/**
 * Resolve AbilityCatalogExecutionPin at job enqueue.
 * Worker never calls this — it only consumes the frozen job pin.
 *
 * Always loads the current ACTIVE AbilityCatalogRelease (fail closed if missing).
 */

import {
  AbilityCatalogPinError,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import { ABILITY_CATALOG_RELEASE_SCHEMA_V1 } from "@mplus/abilities/release";

export async function resolveEnqueueAbilityCatalogExecutionPin(input: {
  prisma: PrismaClient;
}): Promise<AbilityCatalogExecutionPin> {
  const row = await input.prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      releaseKey: true,
      contentDigest: true,
      schemaVersion: true,
      status: true,
    },
  });
  if (!row) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_NOT_FOUND",
      "No ACTIVE ability catalog release exists — activate Bootstrap or a validated release before enqueueing analyses (fail closed)",
    );
  }
  if (row.schemaVersion !== ABILITY_CATALOG_RELEASE_SCHEMA_V1) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_SCHEMA_UNSUPPORTED",
      `ACTIVE release schema ${row.schemaVersion} is unsupported`,
    );
  }
  return {
    kind: "RELEASE",
    releaseId: row.id,
    releaseKey: row.releaseKey,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion,
  };
}
