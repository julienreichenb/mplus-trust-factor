import { normalizeCatalogSlug } from "@mplus/abilities";

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
