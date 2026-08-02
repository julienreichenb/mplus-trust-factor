import {
  findSpecDefinition,
  normalizeCatalogSlug,
} from "@mplus/abilities";
import type { EvidenceRole } from "@mplus/contracts";

/**
 * Explicit class/spec identity states for Scoring V2 slot acquisition.
 * STALE is reserved for contracts that surface freshness; not emitted by the
 * current freeze path (batch plan is authoritative for the batch lifetime).
 */
export type ClassSpecIdentityState = "KNOWN" | "UNKNOWN" | "INCOMPATIBLE" | "STALE";

export interface FrozenClassSpecIdentity {
  state: ClassSpecIdentityState;
  classSlug: string | null;
  specSlug: string | null;
  /** Bounded limitation tokens for extractors / explanations. */
  limitations: string[];
  /** True when Survival/Utility catalog binding must fail closed. */
  catalogDependentFailClosed: boolean;
}

/**
 * Coherent frozen class + spec + role for Scoring V2 plan creation.
 * Role is never invented as DPS when unresolved.
 */
export interface FrozenCharacterIdentity extends FrozenClassSpecIdentity {
  role: EvidenceRole;
  /** How role was resolved for this freeze. */
  roleSource:
    | "canonical_spec"
    | "provider_profile"
    | "plan"
    | "unknown"
    | "incompatible";
}

export interface ProviderIdentityProfile {
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
}

export interface ResolveFrozenClassSpecIdentityInput {
  /** Immutable planner/batch acquisition-plan identity (authoritative). */
  planClassSlug?: string | null;
  planSpecSlug?: string | null;
  /**
   * Optional persisted character class/spec for conflict detection only.
   * Never used to invent identity when the plan already froze null, and never
   * overrides a known frozen plan value.
   */
  persistedClassSlug?: string | null;
  persistedSpecSlug?: string | null;
}

export interface ResolveFrozenCharacterIdentityInput extends ResolveFrozenClassSpecIdentityInput {
  /**
   * Already-frozen plan role (retries). When present with plan class/spec,
   * the plan is authoritative for the batch lifetime.
   */
  planRole?: EvidenceRole | string | null;
  /**
   * Authoritative provider profiles — Blizzard preferred, then Raider.IO.
   * All three fields are taken from one coherent profile when possible.
   * Mutable Character.role must not be passed here.
   */
  blizzard?: ProviderIdentityProfile | null;
  raiderIo?: ProviderIdentityProfile | null;
}

const PLAYABLE_ROLES = new Set<EvidenceRole>(["DPS", "TANK", "HEALER"]);

function normalizeRole(raw: string | null | undefined): EvidenceRole | null {
  if (raw == null) return null;
  const upper = raw.toString().trim().toUpperCase();
  if (upper === "DPS" || upper === "TANK" || upper === "HEALER") return upper;
  if (upper === "UNKNOWN") return "UNKNOWN";
  // Provider may emit lowercase "dps" / "tank" / "healer" / "damage"
  if (upper === "DAMAGE" || upper === "DAMAGER") return "DPS";
  if (upper === "HEAL" || upper === "HEALING") return "HEALER";
  return null;
}

function canonicalRoleForSpec(
  classSlug: string | null,
  specSlug: string | null,
): EvidenceRole | null {
  if (classSlug == null || specSlug == null) return null;
  const spec = findSpecDefinition(classSlug, specSlug);
  if (!spec) return null;
  const role = normalizeRole(spec.role);
  return role != null && PLAYABLE_ROLES.has(role) ? role : null;
}

function pickAuthoritativeProfile(input: {
  blizzard?: ProviderIdentityProfile | null;
  raiderIo?: ProviderIdentityProfile | null;
}): { profile: ProviderIdentityProfile; source: "blizzard" | "raiderio" } | null {
  const blizzardClass = normalizeCatalogSlug(input.blizzard?.classSlug);
  const blizzardSpec = normalizeCatalogSlug(input.blizzard?.specSlug);
  if (blizzardClass != null && blizzardSpec != null) {
    return { profile: input.blizzard!, source: "blizzard" };
  }
  const rioClass = normalizeCatalogSlug(input.raiderIo?.classSlug);
  const rioSpec = normalizeCatalogSlug(input.raiderIo?.specSlug);
  if (rioClass != null && rioSpec != null) {
    return { profile: input.raiderIo!, source: "raiderio" };
  }
  // Partial Blizzard still preferred over Raider.IO when either field is present.
  if (blizzardClass != null || blizzardSpec != null || normalizeRole(input.blizzard?.role) != null) {
    return { profile: input.blizzard ?? {}, source: "blizzard" };
  }
  if (rioClass != null || rioSpec != null || normalizeRole(input.raiderIo?.role) != null) {
    return { profile: input.raiderIo ?? {}, source: "raiderio" };
  }
  return null;
}

/**
 * Resolve frozen class/spec identity for one analysis batch slot.
 *
 * Precedence:
 * 1. Immutable planner/batch metadata (acquisition plan)
 * 2. Persisted character only for conflict detection when both sides are known
 *
 * Does not infer specialization from spell usage or fabricate defaults.
 */
export function resolveFrozenClassSpecIdentity(
  input: ResolveFrozenClassSpecIdentityInput,
): FrozenClassSpecIdentity {
  const planClass = normalizeCatalogSlug(input.planClassSlug);
  const planSpec = normalizeCatalogSlug(input.planSpecSlug);
  const persistedClass = normalizeCatalogSlug(input.persistedClassSlug);
  const persistedSpec = normalizeCatalogSlug(input.persistedSpecSlug);

  const planKnown = planClass != null && planSpec != null;
  const persistedKnown = persistedClass != null && persistedSpec != null;

  if (planKnown && persistedKnown) {
    if (planClass !== persistedClass || planSpec !== persistedSpec) {
      return {
        state: "INCOMPATIBLE",
        // Preserve frozen plan identity — do not silently switch.
        classSlug: planClass,
        specSlug: planSpec,
        limitations: [
          "class_spec_identity_incompatible",
          `frozen_class:${planClass}`,
          `frozen_spec:${planSpec}`,
          `persisted_class:${persistedClass}`,
          `persisted_spec:${persistedSpec}`,
        ],
        catalogDependentFailClosed: true,
      };
    }
  }

  if (planKnown) {
    return {
      state: "KNOWN",
      classSlug: planClass,
      specSlug: planSpec,
      limitations: [],
      catalogDependentFailClosed: false,
    };
  }

  // Partial plan identity is still unknown for catalog binding.
  if (planClass != null || planSpec != null) {
    return {
      state: "UNKNOWN",
      classSlug: planClass,
      specSlug: planSpec,
      limitations: ["class_spec_identity_unknown", "class_spec_identity_incomplete"],
      catalogDependentFailClosed: false,
    };
  }

  return {
    state: "UNKNOWN",
    classSlug: null,
    specSlug: null,
    limitations: ["class_spec_identity_unknown"],
    catalogDependentFailClosed: false,
  };
}

/**
 * Resolve coherent frozen class + spec + role for Scoring V2 plan creation.
 *
 * Precedence:
 * 1. Already-frozen plan identity (retries) — reused as-is when complete
 * 2. Single authoritative provider profile (Blizzard → Raider.IO)
 * 3. Canonical retail spec→role mapping when class+spec are known
 *
 * Never reads mutable Character.role. Never silently defaults role to DPS.
 * Conflicting provider role vs canonical spec role fails closed (INCOMPATIBLE).
 */
export function resolveFrozenCharacterIdentity(
  input: ResolveFrozenCharacterIdentityInput,
): FrozenCharacterIdentity {
  const planClass = normalizeCatalogSlug(input.planClassSlug);
  const planSpec = normalizeCatalogSlug(input.planSpecSlug);
  const planRole = normalizeRole(input.planRole ?? null);

  // Retries: reuse frozen plan identity. Align role via canonical mapping when
  // plan role is missing/UNKNOWN but class+spec are known.
  if (planClass != null || planSpec != null || planRole != null) {
    const classSpec = resolveFrozenClassSpecIdentity(input);
    const canonical = canonicalRoleForSpec(classSpec.classSlug, classSpec.specSlug);

    if (planRole != null && PLAYABLE_ROLES.has(planRole)) {
      if (canonical != null && canonical !== planRole) {
        return {
          ...classSpec,
          state: "INCOMPATIBLE",
          role: "UNKNOWN",
          roleSource: "incompatible",
          limitations: [
            ...classSpec.limitations,
            "role_identity_incompatible",
            `frozen_role:${planRole}`,
            `canonical_role:${canonical}`,
          ],
          catalogDependentFailClosed: true,
        };
      }
      return {
        ...classSpec,
        role: planRole,
        roleSource: "plan",
      };
    }

    if (canonical != null) {
      return {
        ...classSpec,
        role: canonical,
        roleSource: "canonical_spec",
      };
    }

    return {
      ...classSpec,
      role: "UNKNOWN",
      roleSource: "unknown",
      limitations: [...classSpec.limitations, "role_identity_unknown"],
    };
  }

  const picked = pickAuthoritativeProfile({
    blizzard: input.blizzard,
    raiderIo: input.raiderIo,
  });

  if (!picked) {
    return {
      state: "UNKNOWN",
      classSlug: null,
      specSlug: null,
      role: "UNKNOWN",
      roleSource: "unknown",
      limitations: ["class_spec_identity_unknown", "role_identity_unknown"],
      catalogDependentFailClosed: false,
    };
  }

  const classSlug = normalizeCatalogSlug(picked.profile.classSlug);
  const specSlug = normalizeCatalogSlug(picked.profile.specSlug);
  const providerRole = normalizeRole(picked.profile.role);
  const canonical = canonicalRoleForSpec(classSlug, specSlug);
  const classSpec = resolveFrozenClassSpecIdentity({
    planClassSlug: classSlug,
    planSpecSlug: specSlug,
    persistedClassSlug: input.persistedClassSlug,
    persistedSpecSlug: input.persistedSpecSlug,
  });

  if (canonical != null && providerRole != null && PLAYABLE_ROLES.has(providerRole) && canonical !== providerRole) {
    return {
      ...classSpec,
      state: "INCOMPATIBLE",
      role: "UNKNOWN",
      roleSource: "incompatible",
      limitations: [
        ...classSpec.limitations,
        "role_identity_incompatible",
        `provider_role:${providerRole}`,
        `canonical_role:${canonical}`,
        `identity_source:${picked.source}`,
      ],
      catalogDependentFailClosed: true,
    };
  }

  if (canonical != null) {
    return {
      ...classSpec,
      role: canonical,
      roleSource: "canonical_spec",
    };
  }

  if (providerRole != null && PLAYABLE_ROLES.has(providerRole)) {
    return {
      ...classSpec,
      role: providerRole,
      roleSource: "provider_profile",
      limitations: [
        ...classSpec.limitations,
        "role_from_provider_without_canonical_spec",
        `identity_source:${picked.source}`,
      ],
    };
  }

  return {
    ...classSpec,
    role: "UNKNOWN",
    roleSource: "unknown",
    limitations: [
      ...classSpec.limitations,
      "role_identity_unknown",
      `identity_source:${picked.source}`,
    ],
  };
}
