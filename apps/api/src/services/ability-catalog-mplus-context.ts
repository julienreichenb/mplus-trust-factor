import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import {
  collectStableIdentities,
  stableAbilityIdentity,
  type MplusRelevanceContext,
} from "@mplus/abilities";
import type { AbilityCatalogExclusionDTO } from "@mplus/contracts";
import { AbilityCatalogReleaseService } from "./ability-catalog-release-service.js";
import { HttpError } from "../errors.js";

export async function loadMplusRelevanceContext(
  prisma: PrismaClient,
): Promise<MplusRelevanceContext> {
  const rows = await prisma.abilityCatalogExclusion.findMany({
    select: { stableAbilityIdentity: true },
  });
  const excludedIdentities = new Set(rows.map((row) => row.stableAbilityIdentity));
  const activeCanonicalKeys = new Set<string>();
  const activeSpellIds = new Set<number>();
  const active = await prisma.abilityCatalogRelease.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true },
  });
  if (active) {
    const releases = new AbilityCatalogReleaseService(prisma);
    const { artifact } = await releases.loadReleaseArtifact(active.id);
    for (const rule of artifact.rules) {
      activeCanonicalKeys.add(rule.canonicalKey);
      for (const spellId of rule.spellIds) {
        activeSpellIds.add(spellId);
      }
    }
  }
  return { activeCanonicalKeys, activeSpellIds, excludedIdentities };
}

export function parseExclusionIdentity(input: {
  canonicalKey?: string | null;
  primarySpellId?: number | null;
}): string {
  try {
    return stableAbilityIdentity({
      canonicalKey: input.canonicalKey,
      primarySpellId: input.primarySpellId,
    });
  } catch {
    throw HttpError.badRequest(
      "EXCLUSION_IDENTITY_INVALID",
      "canonicalKey or primarySpellId is required to identify an exclusion",
    );
  }
}

export async function upsertAbilityCatalogExclusion(
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    canonicalKey?: string | null;
    primarySpellId?: number | null;
    userId?: string | null;
  },
): Promise<string> {
  const stableId = parseExclusionIdentity(input);
  const identities = collectStableIdentities({
    canonicalKey: input.canonicalKey,
    primarySpellId: input.primarySpellId,
  });
  for (const identity of identities) {
    await tx.abilityCatalogExclusion.upsert({
      where: { stableAbilityIdentity: identity },
      create: {
        id: randomUUID(),
        stableAbilityIdentity: identity,
        excludedByUserId: input.userId ?? null,
      },
      update: { excludedByUserId: input.userId ?? null },
    });
  }
  return stableId;
}

export async function clearAbilityCatalogExclusion(
  tx: Prisma.TransactionClient | PrismaClient,
  input: { canonicalKey?: string | null; primarySpellId?: number | null },
): Promise<number> {
  const identities = collectStableIdentities({
    canonicalKey: input.canonicalKey,
    primarySpellId: input.primarySpellId,
  });
  if (identities.length === 0) {
    throw HttpError.badRequest(
      "EXCLUSION_IDENTITY_INVALID",
      "canonicalKey or primarySpellId is required to clear an exclusion",
    );
  }
  const result = await tx.abilityCatalogExclusion.deleteMany({
    where: { stableAbilityIdentity: { in: identities } },
  });
  return result.count;
}

function parseIdentityParts(stableAbilityIdentity: string): {
  canonicalKey: string | null;
  primarySpellId: number | null;
} {
  if (stableAbilityIdentity.startsWith("canonical:")) {
    return { canonicalKey: stableAbilityIdentity.slice("canonical:".length), primarySpellId: null };
  }
  if (stableAbilityIdentity.startsWith("spell:")) {
    const id = Number(stableAbilityIdentity.slice("spell:".length));
    return {
      canonicalKey: null,
      primarySpellId: Number.isInteger(id) && id > 0 ? id : null,
    };
  }
  return { canonicalKey: null, primarySpellId: null };
}

export function toExclusionDto(row: {
  id: string;
  stableAbilityIdentity: string;
  excludedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AbilityCatalogExclusionDTO {
  const parts = parseIdentityParts(row.stableAbilityIdentity);
  return {
    id: row.id,
    stableAbilityIdentity: row.stableAbilityIdentity,
    canonicalKey: parts.canonicalKey,
    primarySpellId: parts.primarySpellId,
    excludedByUserId: row.excludedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCanonicalKeysPendingExclusionTombstone(
  prisma: PrismaClient,
  baseCanonicalKeys: readonly string[],
): Promise<string[]> {
  const rows = await prisma.abilityCatalogExclusion.findMany({
    where: {
      stableAbilityIdentity: {
        startsWith: "canonical:",
      },
    },
    select: { stableAbilityIdentity: true },
  });
  const excluded = new Set(
    rows
      .map((row) => row.stableAbilityIdentity.slice("canonical:".length))
      .filter((key) => key.length > 0),
  );
  return baseCanonicalKeys.filter((key) => excluded.has(key));
}
