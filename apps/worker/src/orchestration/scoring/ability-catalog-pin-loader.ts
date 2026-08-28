/**
 * Resolve AbilityCatalogContext from an explicit execution pin (Phase 3B.4).
 * Fail-closed for RELEASE. Never looks up ACTIVE / latest VALIDATED.
 */

import { createHash } from "node:crypto";
import {
  CURRENT_CATALOG_VERSION_ID,
  createStaticAbilityCatalogContext,
  type AbilityCatalogContext,
} from "@mplus/abilities";
import {
  artifactFromSemanticContentBytes,
  createReleaseAbilityCatalogContext,
  validateAbilityCatalogReleaseArtifact,
  ABILITY_CATALOG_RELEASE_SCHEMA_V1,
  type AbilityCatalogReleaseArtifact,
} from "@mplus/abilities/release";
import {
  AbilityCatalogPinError,
  decodeAbilityCatalogExecutionPin,
  isExecutableAbilityCatalogReleaseStatus,
  type AbilityCatalogExecutionPin,
} from "@mplus/contracts";
import type { PrismaClient } from "@mplus/database";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type ResolvedAbilityCatalogExecution = {
  pin: AbilityCatalogExecutionPin;
  context: AbilityCatalogContext;
  /** Stamp used on capability packages / digests. */
  catalogVersionStamp: string;
};

type CacheEntry = {
  contentDigest: string;
  context: AbilityCatalogContext;
  loadedAtMs: number;
};

const releaseContextCache = new Map<string, CacheEntry>();
const CACHE_MAX = 8;

function cacheKey(releaseId: string, contentDigest: string): string {
  return `${releaseId}:${contentDigest}`;
}

function putCache(releaseId: string, contentDigest: string, context: AbilityCatalogContext): void {
  if (releaseContextCache.size >= CACHE_MAX) {
    const first = releaseContextCache.keys().next().value;
    if (first) releaseContextCache.delete(first);
  }
  releaseContextCache.set(cacheKey(releaseId, contentDigest), {
    contentDigest,
    context,
    loadedAtMs: Date.now(),
  });
}

export function clearAbilityCatalogReleaseContextCache(): void {
  releaseContextCache.clear();
}

export function getAbilityCatalogReleaseContextCacheSize(): number {
  return releaseContextCache.size;
}

/**
 * Decode job payload pin (absent → STATIC). Does not load RELEASE artifacts.
 */
export function decodeJobAbilityCatalogPin(
  raw: unknown,
  fallbackCatalogVersionId: string = CURRENT_CATALOG_VERSION_ID,
): AbilityCatalogExecutionPin {
  return decodeAbilityCatalogExecutionPin(raw, fallbackCatalogVersionId);
}

export async function resolveAbilityCatalogExecution(input: {
  prisma: PrismaClient;
  pin: AbilityCatalogExecutionPin;
}): Promise<ResolvedAbilityCatalogExecution> {
  if (input.pin.kind === "STATIC") {
    return {
      pin: input.pin,
      context: createStaticAbilityCatalogContext(),
      catalogVersionStamp: input.pin.catalogVersionId,
    };
  }

  const cached = releaseContextCache.get(
    cacheKey(input.pin.releaseId, input.pin.contentDigest),
  );
  if (cached && cached.contentDigest === input.pin.contentDigest) {
    return {
      pin: input.pin,
      context: cached.context,
      catalogVersionStamp: input.pin.releaseKey,
    };
  }

  const { artifact, releaseKey, contentDigest, schemaVersion } =
    await loadAndVerifyPinnedRelease(input.prisma, input.pin);

  const context = createReleaseAbilityCatalogContext({
    artifact,
    releaseId: input.pin.releaseId,
  });
  putCache(input.pin.releaseId, contentDigest, context);

  return {
    pin: {
      kind: "RELEASE",
      releaseId: input.pin.releaseId,
      releaseKey,
      contentDigest,
      schemaVersion,
    },
    context,
    catalogVersionStamp: releaseKey,
  };
}

async function loadAndVerifyPinnedRelease(
  prisma: PrismaClient,
  pin: Extract<AbilityCatalogExecutionPin, { kind: "RELEASE" }>,
): Promise<{
  artifact: AbilityCatalogReleaseArtifact;
  releaseKey: string;
  contentDigest: string;
  schemaVersion: string;
}> {
  const row = await prisma.abilityCatalogRelease.findUnique({
    where: { id: pin.releaseId },
  });
  if (!row) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_NOT_FOUND",
      `Ability catalog release ${pin.releaseId} was not found`,
    );
  }
  if (!isExecutableAbilityCatalogReleaseStatus(row.status)) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE",
      `Release status ${row.status} is not executable (VALIDATED required)`,
    );
  }
  if (row.contentDigest !== pin.contentDigest) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_DIGEST_MISMATCH",
      "Pinned contentDigest does not match stored release metadata",
    );
  }
  if (row.releaseKey !== pin.releaseKey) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_INVALID",
      "Pinned releaseKey does not match stored release metadata",
    );
  }
  if (row.schemaVersion !== pin.schemaVersion) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_SCHEMA_UNSUPPORTED",
      "Pinned schemaVersion does not match stored release metadata",
    );
  }
  if (row.schemaVersion !== ABILITY_CATALOG_RELEASE_SCHEMA_V1) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_SCHEMA_UNSUPPORTED",
      `Unsupported release schema ${row.schemaVersion}`,
    );
  }

  const payload = await prisma.rawArtifactPayload.findUnique({
    where: { contentHash: row.casContentHash },
  });
  if (!payload) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_INVALID",
      "Release CAS payload missing (fail closed)",
    );
  }
  const casBytes = Buffer.from(payload.payload);
  if (sha256Hex(casBytes) !== row.casContentHash) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_INVALID",
      "CAS payload corrupt vs casContentHash",
    );
  }

  const artifact = artifactFromSemanticContentBytes(casBytes, row.generatedAt.toISOString());
  if (artifact.contentDigest !== row.contentDigest) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_DIGEST_MISMATCH",
      "Recomputed contentDigest mismatch",
    );
  }
  if (artifact.releaseKey !== row.releaseKey) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_INVALID",
      "Recomputed releaseKey mismatch",
    );
  }

  const validation = validateAbilityCatalogReleaseArtifact(artifact);
  if (!validation.valid) {
    throw new AbilityCatalogPinError(
      "ABILITY_CATALOG_RELEASE_INVALID",
      `Pinned release artifact failed validation (${validation.errors.length} errors)`,
    );
  }

  return {
    artifact,
    releaseKey: row.releaseKey,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion,
  };
}

/** Cold/warm timing helper for acceptance reporting. */
export async function measureReleaseContextLoad(
  prisma: PrismaClient,
  pin: Extract<AbilityCatalogExecutionPin, { kind: "RELEASE" }>,
): Promise<{ coldMs: number; warmMs: number }> {
  clearAbilityCatalogReleaseContextCache();
  const t0 = Date.now();
  await resolveAbilityCatalogExecution({ prisma, pin });
  const coldMs = Date.now() - t0;
  const t1 = Date.now();
  await resolveAbilityCatalogExecution({ prisma, pin });
  const warmMs = Date.now() - t1;
  return { coldMs, warmMs };
}
