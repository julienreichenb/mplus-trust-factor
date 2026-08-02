/**
 * Load + dedupe Agent 11 resolved cohort identities for bootstrap planning.
 */
import { createHash } from "node:crypto";
import { normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import { isMyzouthMember } from "./resolve-member.js";
import type {
  BootstrapIdentity,
  CohortBootstrapDoc,
  CohortBootstrapMemberInput,
} from "./cohort-bootstrap-types.js";

export function hashFileContents(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

export function buildIdentityKey(region: string, realmSlug: string, name: string): string {
  const r = normalizeRegion(region);
  const realm = normalizeRealmSlug(realmSlug);
  const n = normalizeName(name);
  return `${r}/${realm}/${n}`;
}

export function buildBootstrapJobKey(cohortId: string, identityKey: string): string {
  return createHash("sha256")
    .update(`calibration-bootstrap|v1|${cohortId}|${identityKey}|resolve-refresh`, "utf8")
    .digest("hex");
}

export function parseCohortBootstrapDoc(raw: unknown): CohortBootstrapDoc {
  if (!raw || typeof raw !== "object") {
    throw new Error("COHORT_INVALID: root must be an object");
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.cohortId !== "string" || !doc.cohortId.trim()) {
    throw new Error("COHORT_INVALID: cohortId required");
  }
  if (!Array.isArray(doc.members)) {
    throw new Error("COHORT_INVALID: members must be an array");
  }
  const members: CohortBootstrapMemberInput[] = [];
  for (const m of doc.members) {
    if (!m || typeof m !== "object") {
      throw new Error("COHORT_INVALID: member must be an object");
    }
    const row = m as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) {
      throw new Error("COHORT_INVALID: member.id required");
    }
    if (typeof row.region !== "string" || typeof row.realm !== "string" || typeof row.character !== "string") {
      throw new Error(`COHORT_INVALID: member ${row.id} missing region/realm/character`);
    }
    members.push({
      id: row.id,
      region: row.region,
      realm: row.realm,
      character: row.character,
      expectedTier: typeof row.expectedTier === "string" ? row.expectedTier : undefined,
      expectedLabel: typeof row.expectedLabel === "string" ? row.expectedLabel : undefined,
      exclusionReason:
        row.exclusionReason === null || row.exclusionReason === undefined
          ? null
          : typeof row.exclusionReason === "string"
            ? row.exclusionReason
            : String(row.exclusionReason),
      blizzardCharacterId:
        row.blizzardCharacterId === null || row.blizzardCharacterId === undefined
          ? null
          : String(row.blizzardCharacterId),
      characterId:
        row.characterId === null || row.characterId === undefined ? null : String(row.characterId),
      evidenceStatus: typeof row.evidenceStatus === "string" ? row.evidenceStatus : undefined,
    });
  }
  return {
    schemaVersion: typeof doc.schemaVersion === "string" ? doc.schemaVersion : "unknown",
    cohortId: doc.cohortId.trim(),
    members,
    generatedAt: typeof doc.generatedAt === "string" ? doc.generatedAt : undefined,
  };
}

/**
 * Collapse duplicate cohort rows / dual role labels onto one identity.
 * Preserves 41-member / 40-identity relationship for Agent 11.
 */
export function dedupeCohortIdentities(members: CohortBootstrapMemberInput[]): BootstrapIdentity[] {
  const map = new Map<string, BootstrapIdentity>();

  for (const member of members) {
    let region: string;
    let realmSlug: string;
    let normalizedName: string;
    try {
      region = normalizeRegion(member.region);
      realmSlug = normalizeRealmSlug(member.realm);
      normalizedName = normalizeName(member.character);
    } catch {
      region = String(member.region ?? "").toUpperCase();
      realmSlug = String(member.realm ?? "").toLowerCase();
      normalizedName = String(member.character ?? "").toLowerCase();
    }
    const name = member.character.trim() || member.character;
    const identityKey = `${region}/${realmSlug}/${normalizedName}`;
    const existing = map.get(identityKey);
    const isMyzouth = isMyzouthMember({
      id: member.id,
      region: member.region,
      realm: member.realm,
      character: member.character,
    });

    if (!existing) {
      map.set(identityKey, {
        identityKey,
        region,
        realmSlug,
        name,
        normalizedName,
        blizzardCharacterId: member.blizzardCharacterId ?? null,
        memberIds: [member.id],
        expectedLabels: member.expectedLabel ? [member.expectedLabel] : [],
        expectedTiers: member.expectedTier ? [member.expectedTier] : [],
        exclusionReasons: [member.exclusionReason ?? null],
        fullyExcluded: member.exclusionReason != null && member.exclusionReason !== "",
        isMyzouth,
      });
      continue;
    }

    if (!existing.memberIds.includes(member.id)) {
      existing.memberIds.push(member.id);
    }
    if (member.expectedLabel && !existing.expectedLabels.includes(member.expectedLabel)) {
      existing.expectedLabels.push(member.expectedLabel);
    }
    if (member.expectedTier && !existing.expectedTiers.includes(member.expectedTier)) {
      existing.expectedTiers.push(member.expectedTier);
    }
    existing.exclusionReasons.push(member.exclusionReason ?? null);
    existing.fullyExcluded = existing.exclusionReasons.every((r) => r != null && r !== "");
    existing.isMyzouth = existing.isMyzouth || isMyzouth;
    if (!existing.blizzardCharacterId && member.blizzardCharacterId) {
      existing.blizzardCharacterId = member.blizzardCharacterId;
    }
    // Prefer intake display casing from the first member; keep stable.
  }

  return [...map.values()].sort((a, b) => a.identityKey.localeCompare(b.identityKey));
}

export function filterIdentitiesByMemberSelection(
  identities: BootstrapIdentity[],
  opts: { includeMemberIds: Set<string>; excludeMemberIds: Set<string> },
): BootstrapIdentity[] {
  return identities
    .map((identity) => {
      const memberIds = identity.memberIds.filter((id) => !opts.excludeMemberIds.has(id));
      if (memberIds.length === 0) return null;
      if (opts.includeMemberIds.size > 0) {
        const included = memberIds.filter((id) => opts.includeMemberIds.has(id));
        if (included.length === 0) return null;
        return { ...identity, memberIds: included };
      }
      return { ...identity, memberIds };
    })
    .filter((x): x is BootstrapIdentity => x != null);
}
