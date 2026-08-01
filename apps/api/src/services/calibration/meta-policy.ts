/**
 * Season meta-policy helpers for Agent 11 calibration.
 * Pure — no Prisma, no providers.
 */
import { findClassDefinition, findSpecDefinition } from "@mplus/abilities";

export const META_POLICY_SCHEMA_VERSION = "1.0.0" as const;

export type MetaPolicyRole = "DPS" | "TANK" | "HEALER";

export interface MetaSpecialization {
  classSlug: string;
  specSlug: string;
  role?: MetaPolicyRole;
}

export interface AuthoritativeSeasonBinding {
  provider: "BLIZZARD";
  providerSeasonId: number;
  catalogSlug: string;
}

export interface SeasonMetaPolicyV1 {
  schemaVersion: string;
  policyId: string;
  seasonSlug: string;
  evaluatedAt: string;
  unlistedStatus: "NON_META";
  authoritativeSeasonBindings: AuthoritativeSeasonBinding[];
  metaSpecializations: MetaSpecialization[];
  source: {
    type: string;
    description?: string;
  };
}

export type MetaClassification = true | false | "unresolved";

export interface MetaPolicyValidationResult {
  ok: boolean;
  errors: string[];
  policy: SeasonMetaPolicyV1 | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Validate meta-policy JSON and every class/spec pair against the canonical matrix.
 */
export function validateSeasonMetaPolicy(input: unknown): MetaPolicyValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["meta policy must be an object"], policy: null };
  }

  const schemaVersion = asNonEmptyString(input.schemaVersion);
  if (!schemaVersion) errors.push("schemaVersion is required");
  else if (schemaVersion !== META_POLICY_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion "${schemaVersion}"`);
  }

  const policyId = asNonEmptyString(input.policyId);
  if (!policyId) errors.push("policyId is required");

  const seasonSlug = asNonEmptyString(input.seasonSlug);
  if (!seasonSlug) errors.push("seasonSlug is required");

  const evaluatedAt = asNonEmptyString(input.evaluatedAt);
  if (!evaluatedAt) errors.push("evaluatedAt is required");

  if (input.unlistedStatus !== "NON_META") {
    errors.push('unlistedStatus must be "NON_META"');
  }

  if (!isRecord(input.source) || !asNonEmptyString(input.source.type)) {
    errors.push("source.type is required");
  }

  if (!Array.isArray(input.authoritativeSeasonBindings) || input.authoritativeSeasonBindings.length === 0) {
    errors.push("authoritativeSeasonBindings must be a non-empty array");
  }

  const bindings: AuthoritativeSeasonBinding[] = [];
  if (Array.isArray(input.authoritativeSeasonBindings)) {
    for (let i = 0; i < input.authoritativeSeasonBindings.length; i++) {
      const raw = input.authoritativeSeasonBindings[i];
      const prefix = `authoritativeSeasonBindings[${i}]`;
      if (!isRecord(raw)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      if (raw.provider !== "BLIZZARD") {
        errors.push(`${prefix}.provider must be "BLIZZARD"`);
      }
      if (typeof raw.providerSeasonId !== "number" || !Number.isInteger(raw.providerSeasonId)) {
        errors.push(`${prefix}.providerSeasonId must be an integer`);
      }
      const catalogSlug = asNonEmptyString(raw.catalogSlug);
      if (!catalogSlug) errors.push(`${prefix}.catalogSlug is required`);
      if (
        raw.provider === "BLIZZARD" &&
        typeof raw.providerSeasonId === "number" &&
        catalogSlug
      ) {
        const expected = `blizzard-season-${raw.providerSeasonId}`;
        if (catalogSlug !== expected) {
          errors.push(
            `${prefix}.catalogSlug "${catalogSlug}" must equal "${expected}" for providerSeasonId ${raw.providerSeasonId}`,
          );
        }
        bindings.push({
          provider: "BLIZZARD",
          providerSeasonId: raw.providerSeasonId,
          catalogSlug,
        });
      }
    }
  }

  if (!Array.isArray(input.metaSpecializations) || input.metaSpecializations.length === 0) {
    errors.push("metaSpecializations must be a non-empty array");
  }

  const metaSpecializations: MetaSpecialization[] = [];
  if (Array.isArray(input.metaSpecializations)) {
    for (let i = 0; i < input.metaSpecializations.length; i++) {
      const raw = input.metaSpecializations[i];
      const prefix = `metaSpecializations[${i}]`;
      if (!isRecord(raw)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      const classSlug = asNonEmptyString(raw.classSlug);
      const specSlug = asNonEmptyString(raw.specSlug);
      if (!classSlug) errors.push(`${prefix}.classSlug is required`);
      if (!specSlug) errors.push(`${prefix}.specSlug is required`);
      if (!classSlug || !specSlug) continue;

      if (!findClassDefinition(classSlug)) {
        errors.push(`${prefix}: unknown classSlug "${classSlug}"`);
      }
      const spec = findSpecDefinition(classSlug, specSlug);
      if (!spec) {
        errors.push(`${prefix}: unknown specSlug "${specSlug}" for class "${classSlug}"`);
      }

      let role: MetaPolicyRole | undefined;
      if (raw.role != null) {
        if (raw.role !== "DPS" && raw.role !== "TANK" && raw.role !== "HEALER") {
          errors.push(`${prefix}.role must be DPS|TANK|HEALER when present`);
        } else {
          role = raw.role;
          if (spec && spec.role !== role) {
            errors.push(
              `${prefix}.role "${role}" disagrees with canonical matrix role "${spec.role}"`,
            );
          }
        }
      }

      metaSpecializations.push({ classSlug, specSlug, role });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, policy: null };
  }

  return {
    ok: true,
    errors: [],
    policy: {
      schemaVersion: schemaVersion!,
      policyId: policyId!,
      seasonSlug: seasonSlug!,
      evaluatedAt: evaluatedAt!,
      unlistedStatus: "NON_META",
      authoritativeSeasonBindings: bindings,
      metaSpecializations,
      source: {
        type: asNonEmptyString((input.source as Record<string, unknown>).type)!,
        description: asNonEmptyString((input.source as Record<string, unknown>).description) ?? undefined,
      },
    },
  };
}

/**
 * Classify meta membership. Never coerces unresolved class/spec to non-meta.
 */
export function classifyMetaMembership(
  policy: SeasonMetaPolicyV1,
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): MetaClassification {
  if (!classSlug || !specSlug) return "unresolved";
  const hit = policy.metaSpecializations.some(
    (m) => m.classSlug === classSlug && m.specSlug === specSlug,
  );
  return hit;
}

export interface AuthoritativeSeasonRow {
  id: string;
  slug: string;
  isCurrent: boolean;
  blizzardSeasonId?: number | null;
}

/**
 * Fail closed unless the authoritative Season row matches an explicit binding.
 * Does not equate midnight-season-1 with blizzard-season-17 implicitly.
 */
export function validateAuthoritativeSeasonBinding(
  policy: SeasonMetaPolicyV1,
  authoritativeSeason: AuthoritativeSeasonRow | null,
): { ok: true; binding: AuthoritativeSeasonBinding } | { ok: false; errors: string[] } {
  if (!authoritativeSeason) {
    return { ok: false, errors: ["authoritative season row is missing"] };
  }
  if (!authoritativeSeason.isCurrent) {
    return {
      ok: false,
      errors: [`season row ${authoritativeSeason.id} is not marked isCurrent`],
    };
  }

  const binding = policy.authoritativeSeasonBindings.find((b) => b.provider === "BLIZZARD");
  if (!binding) {
    return { ok: false, errors: ["no BLIZZARD authoritativeSeasonBinding in policy"] };
  }

  const errors: string[] = [];
  if (authoritativeSeason.slug !== binding.catalogSlug) {
    errors.push(
      `authoritative season slug "${authoritativeSeason.slug}" !== binding catalogSlug "${binding.catalogSlug}"`,
    );
  }
  if (
    authoritativeSeason.blizzardSeasonId != null &&
    authoritativeSeason.blizzardSeasonId !== binding.providerSeasonId
  ) {
    errors.push(
      `authoritative blizzardSeasonId ${authoritativeSeason.blizzardSeasonId} !== binding providerSeasonId ${binding.providerSeasonId}`,
    );
  }
  // When blizzardSeasonId is absent on the row, require slug match only (already checked)
  // but still fail if slug does not encode the expected id.
  const slugExpectedId = Number(binding.catalogSlug.replace(/^blizzard-season-/, ""));
  if (Number.isFinite(slugExpectedId) && slugExpectedId !== binding.providerSeasonId) {
    errors.push("internal binding inconsistency between catalogSlug and providerSeasonId");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, binding };
}
