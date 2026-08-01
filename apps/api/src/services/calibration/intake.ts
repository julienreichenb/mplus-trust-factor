/**
 * Agent 11 cohort intake validation (immutable user selections).
 * Pure — does not enrich or mutate intake.
 */
export const INTAKE_SCHEMA_VERSION = "agent11-cohort-intake-v1" as const;

export const EXPECTED_TIER_MAPPING = {
  S: "excellent",
  A: "good",
  B: "average",
  C: "weak",
  D: "overrated",
} as const;

export type ExpectedTier = keyof typeof EXPECTED_TIER_MAPPING;
export type ExpectedLabel = (typeof EXPECTED_TIER_MAPPING)[ExpectedTier];
export type ProvidedRole = "DPS" | "TANK" | "HEALER" | null;

export interface IntakeMember {
  id: string;
  region: string;
  realm: string;
  character: string;
  providedRole: ProvidedRole;
  expectedTier: ExpectedTier;
  expectedLabel: ExpectedLabel;
  classSlug: string | null;
  specSlug: string | null;
  meta: boolean | null;
  rationale: string;
  suspectedBoost: boolean | null;
  source: "user-selected";
  seasonSlug: string | null;
  snapshotIds: string[];
  resolution: {
    characterId: string | null;
    identityStatus: string;
    evidenceStatus: string;
    notes: string[];
  };
}

export interface CohortIntakeV1 {
  schemaVersion: string;
  cohortId: string;
  description: string;
  createdAt: string;
  expectedTierMapping: typeof EXPECTED_TIER_MAPPING;
  summary: {
    memberCount: number;
    uniqueCharacterIdentityCount: number;
    tierCounts: Record<ExpectedTier, number>;
    providedRoleCounts: Record<string, number>;
    missingRoleMemberIds: string[];
    duplicateIdentities: Array<{
      region: string;
      realm: string;
      characterCasefold: string;
      memberIds: string[];
      providedRoles: string[];
      expectedTiers: string[];
      requiresRoleSpecificEvidence: boolean;
    }>;
  };
  members: IntakeMember[];
}

export interface IntakeValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  intake: CohortIntakeV1 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function identityKey(region: string, realm: string, character: string): string {
  return `${region.toUpperCase()}|${realm.toLowerCase()}|${character.toLowerCase()}`;
}

/**
 * Validate intake structure and exact expected counts without mutating input.
 */
export function validateCohortIntake(input: unknown): IntakeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["intake must be an object"], warnings, intake: null };
  }

  if (input.schemaVersion !== INTAKE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be "${INTAKE_SCHEMA_VERSION}"`);
  }
  if (!asString(input.cohortId)) errors.push("cohortId is required");
  if (!asString(input.description)) errors.push("description is required");
  if (!asString(input.createdAt)) errors.push("createdAt is required");

  if (!Array.isArray(input.members)) {
    errors.push("members must be an array");
    return { ok: false, errors, warnings, intake: null };
  }

  const members: IntakeMember[] = [];
  const seenIds = new Set<string>();
  const tierCounts: Record<ExpectedTier, number> = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  const providedRoleCounts: Record<string, number> = { TANK: 0, DPS: 0, HEALER: 0 };
  const missingRoleMemberIds: string[] = [];
  const identityMap = new Map<string, string[]>();

  for (let i = 0; i < input.members.length; i++) {
    const raw = input.members[i];
    const prefix = `members[${i}]`;
    if (!isRecord(raw)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    const id = asString(raw.id);
    const region = asString(raw.region);
    const realm = asString(raw.realm);
    const character = asString(raw.character);
    const rationale = asString(raw.rationale);
    const expectedTier = asString(raw.expectedTier) as ExpectedTier | null;
    const expectedLabel = asString(raw.expectedLabel) as ExpectedLabel | null;

    if (!id) errors.push(`${prefix}.id is required`);
    if (id) {
      if (seenIds.has(id)) errors.push(`${prefix}.id duplicate: ${id}`);
      seenIds.add(id);
    }
    if (!region) errors.push(`${prefix}.region is required`);
    if (!realm) errors.push(`${prefix}.realm is required`);
    if (!character) errors.push(`${prefix}.character is required`);
    if (!rationale) errors.push(`${prefix}.rationale is required`);
    if (!expectedTier || !(expectedTier in EXPECTED_TIER_MAPPING)) {
      errors.push(`${prefix}.expectedTier must be S|A|B|C|D`);
    }
    if (!expectedLabel) errors.push(`${prefix}.expectedLabel is required`);
    if (
      expectedTier &&
      expectedLabel &&
      EXPECTED_TIER_MAPPING[expectedTier] !== expectedLabel
    ) {
      errors.push(
        `${prefix}.expectedLabel "${expectedLabel}" does not match tier ${expectedTier}`,
      );
    }
    if (raw.source !== "user-selected") {
      errors.push(`${prefix}.source must be "user-selected"`);
    }

    let providedRole: ProvidedRole = null;
    if (raw.providedRole == null) {
      if (id) missingRoleMemberIds.push(id);
    } else if (raw.providedRole === "DPS" || raw.providedRole === "TANK" || raw.providedRole === "HEALER") {
      providedRole = raw.providedRole;
      providedRoleCounts[providedRole] = (providedRoleCounts[providedRole] ?? 0) + 1;
    } else {
      errors.push(`${prefix}.providedRole must be DPS|TANK|HEALER|null`);
    }

    // Intake enrichment fields must remain null / empty — never silently rewritten here.
    if (raw.classSlug != null) warnings.push(`${prefix}.classSlug is set on immutable intake`);
    if (raw.specSlug != null) warnings.push(`${prefix}.specSlug is set on immutable intake`);
    if (raw.meta != null) warnings.push(`${prefix}.meta is set on immutable intake`);

    if (id && region && realm && character && expectedTier && expectedLabel && rationale) {
      const key = identityKey(region, realm, character);
      const list = identityMap.get(key) ?? [];
      list.push(id);
      identityMap.set(key, list);
      tierCounts[expectedTier] += 1;

      members.push({
        id,
        region: region.toUpperCase(),
        realm: realm.toLowerCase(),
        character,
        providedRole,
        expectedTier,
        expectedLabel,
        classSlug: null,
        specSlug: null,
        meta: null,
        rationale,
        suspectedBoost: typeof raw.suspectedBoost === "boolean" ? raw.suspectedBoost : null,
        source: "user-selected",
        seasonSlug: asString(raw.seasonSlug),
        snapshotIds: Array.isArray(raw.snapshotIds)
          ? raw.snapshotIds.filter((x): x is string => typeof x === "string")
          : [],
        resolution: {
          characterId: null,
          identityStatus: "PENDING",
          evidenceStatus: "PENDING",
          notes: isRecord(raw.resolution) && Array.isArray(raw.resolution.notes)
            ? raw.resolution.notes.filter((n): n is string => typeof n === "string")
            : [],
        },
      });
    }
  }

  if (members.length !== 41) {
    errors.push(`expected memberCount 41, got ${members.length}`);
  }
  if (identityMap.size !== 40) {
    errors.push(`expected uniqueCharacterIdentityCount 40, got ${identityMap.size}`);
  }
  for (const tier of Object.keys(EXPECTED_TIER_MAPPING) as ExpectedTier[]) {
    const expected = tier === "A" ? 9 : 8;
    if (tierCounts[tier] !== expected) {
      errors.push(`expected tier ${tier} count ${expected}, got ${tierCounts[tier]}`);
    }
  }

  // Petbear duplicate must be present
  const petbear = [...identityMap.entries()].find(([k]) => k.endsWith("|outland|petbear"));
  if (!petbear || petbear[1].length !== 2) {
    errors.push("EU/outland/Petbear must appear exactly twice with distinct member ids");
  }

  if (missingRoleMemberIds.length !== 3) {
    warnings.push(
      `expected 3 missing-role members (Xatihr/Lightreport/Reyou); found ${missingRoleMemberIds.length}`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, intake: null };
  }

  const duplicateIdentities = [...identityMap.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, memberIds]) => {
      const [region, realm, characterCasefold] = key.split("|");
      const dupMembers = members.filter((m) => memberIds.includes(m.id));
      return {
        region: region!,
        realm: realm!,
        characterCasefold: characterCasefold!,
        memberIds,
        providedRoles: dupMembers.map((m) => m.providedRole ?? "null"),
        expectedTiers: dupMembers.map((m) => m.expectedTier),
        requiresRoleSpecificEvidence: true,
      };
    });

  return {
    ok: true,
    errors: [],
    warnings,
    intake: {
      schemaVersion: INTAKE_SCHEMA_VERSION,
      cohortId: asString(input.cohortId)!,
      description: asString(input.description)!,
      createdAt: asString(input.createdAt)!,
      expectedTierMapping: EXPECTED_TIER_MAPPING,
      summary: {
        memberCount: members.length,
        uniqueCharacterIdentityCount: identityMap.size,
        tierCounts,
        providedRoleCounts,
        missingRoleMemberIds,
        duplicateIdentities,
      },
      members,
    },
  };
}

/** Deep-freeze helper for tests asserting intake immutability. */
export function freezeIntake<T>(value: T): T {
  return Object.freeze(value) as T;
}
