/**
 * Server-side AbilityCatalogExecutionPin resolution (Phase 3B.4).
 * Never trusts client-supplied digests/releaseKeys.
 * THIS DOES NOT ACTIVATE THE RELEASE.
 */

import { CURRENT_CATALOG_VERSION_ID } from "@mplus/abilities";
import {
  AbilityCatalogPinError,
  createStaticAbilityCatalogPin,
  isExecutableAbilityCatalogReleaseStatus,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";
import { ABILITY_CATALOG_RELEASE_SCHEMA_V1 } from "@mplus/abilities/release";

export function resolveStaticAbilityCatalogExecutionPin(
  catalogVersionId: string = CURRENT_CATALOG_VERSION_ID,
): AbilityCatalogExecutionPin {
  return createStaticAbilityCatalogPin(catalogVersionId);
}

/**
 * Load VALIDATED release by id and build the canonical pin.
 * Rejects DRAFT_BUILD / REJECTED / ACTIVE / SUPERSEDED for Phase 3B.4 policy.
 */
export async function resolveReleaseAbilityCatalogExecutionPin(input: {
  prisma: PrismaClient;
  releaseId: string;
}): Promise<AbilityCatalogExecutionPin> {
  const row = await input.prisma.abilityCatalogRelease.findUnique({
    where: { id: input.releaseId },
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
      `Release ${input.releaseId} not found`,
    );
  }
  if (!isExecutableAbilityCatalogReleaseStatus(row.status)) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE",
      `Release status ${row.status} cannot execute (VALIDATED required). THIS DOES NOT ACTIVATE.`,
    );
  }
  if (row.schemaVersion !== ABILITY_CATALOG_RELEASE_SCHEMA_V1) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_SCHEMA_UNSUPPORTED",
      `Unsupported schema ${row.schemaVersion}`,
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
