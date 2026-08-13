/**
 * Season-scoped scoring identity — distinct from the character's current
 * Blizzard/Raider.IO profile identity.
 *
 * Current profile (UI / Character.activeSpec) must not be rewritten from
 * historical M+ evidence. Authoritative scoring uses this resolver instead.
 *
 * Evidence precedence (strongest → weakest):
 * 1. active-pool dungeonAggregates[].specialization
 * 2. global.specRanks[].spec (only when active dungeon specs are absent)
 * 3. current Blizzard / Raider.IO profile identity
 */
import {
  canonicalRoleForClassSpec,
  findSpecDefinition,
  normalizeRetailClassSlug,
} from "@mplus/abilities";
import {
  normalizePerformanceSpecToken,
  type EvidenceRole,
  type PersistedCharacterPerformanceAggregateV2,
} from "@mplus/contracts";
import { canonicalDungeonKey } from "../run-fusion.js";

export type SeasonScoringIdentitySource =
  | "WCL_ACTIVE_DUNGEONS"
  | "WCL_SPEC_RANKS"
  | "WCL_SEASON"
  | "PROFILE"
  | "WCL_SEASON_ROLE_AMBIGUOUS"
  | "WCL_SEASON_SPEC_AMBIGUOUS";

export interface SeasonScoringProfileIdentity {
  classSlug: string | null;
  specSlug: string | null;
  role: EvidenceRole;
}

export interface WclSeasonDungeonEvidence {
  dungeonSlug?: string | null;
  specialization?: string | null;
}

export interface WclSeasonSpecRankEvidence {
  spec?: string | null;
}

export interface WclSeasonPerformanceEvidence {
  specRanks?: ReadonlyArray<WclSeasonSpecRankEvidence | null | undefined> | null;
  dungeonAggregates?: ReadonlyArray<WclSeasonDungeonEvidence | null | undefined> | null;
}

export interface SeasonScoringIdentity {
  classSlug: string | null;
  specSlug: string | null;
  role: EvidenceRole;
  source: SeasonScoringIdentitySource;
  observedWclSpecs: string[];
  limitations: string[];
}

export interface ResolveSeasonScoringIdentityInput {
  profileIdentity: SeasonScoringProfileIdentity;
  wclPerformanceEvidence?: WclSeasonPerformanceEvidence | null;
  activeDungeonSlugs: readonly string[];
}

const PLAYABLE_ROLES = new Set<EvidenceRole>(["DPS", "TANK", "HEALER"]);

function toPlayableRole(raw: string | null | undefined): EvidenceRole | null {
  if (raw == null) return null;
  const upper = raw.toString().trim().toUpperCase();
  if (upper === "DPS" || upper === "TANK" || upper === "HEALER") return upper;
  return null;
}

function catalogSpecForClass(
  classSlug: string,
  rawSpec: string | null | undefined,
): string | null {
  const token = normalizePerformanceSpecToken(rawSpec);
  if (token == null) return null;
  return findSpecDefinition(classSlug, token) ? token : null;
}

function activeDungeonKeySet(slugs: readonly string[]): Set<string> | null {
  if (slugs.length === 0) return null;
  return new Set(slugs.map((slug) => canonicalDungeonKey(slug)));
}

function dungeonInActiveSet(
  dungeonSlug: string | null | undefined,
  activeKeys: Set<string> | null,
): boolean {
  if (dungeonSlug == null || dungeonSlug.trim() === "") return false;
  if (activeKeys == null) return true;
  return activeKeys.has(canonicalDungeonKey(dungeonSlug));
}

/** Active-pool dungeon specialization tokens only (primary evidence). */
export function collectActiveDungeonSeasonSpecs(input: {
  classSlug: string;
  wclPerformanceEvidence?: WclSeasonPerformanceEvidence | null;
  activeDungeonSlugs: readonly string[];
}): string[] {
  const observed = new Set<string>();
  const evidence = input.wclPerformanceEvidence;
  if (!evidence) return [];

  const activeKeys = activeDungeonKeySet(input.activeDungeonSlugs);
  for (const dungeon of evidence.dungeonAggregates ?? []) {
    if (!dungeonInActiveSet(dungeon?.dungeonSlug ?? null, activeKeys)) continue;
    const spec = catalogSpecForClass(input.classSlug, dungeon?.specialization ?? null);
    if (spec) observed.add(spec);
  }
  return [...observed].sort();
}

/** Global specRanks tokens only (secondary / fallback evidence). */
export function collectSpecRankSeasonSpecs(input: {
  classSlug: string;
  wclPerformanceEvidence?: WclSeasonPerformanceEvidence | null;
}): string[] {
  const observed = new Set<string>();
  for (const rank of input.wclPerformanceEvidence?.specRanks ?? []) {
    const spec = catalogSpecForClass(input.classSlug, rank?.spec ?? null);
    if (spec) observed.add(spec);
  }
  return [...observed].sort();
}

/**
 * Specs that influenced the final decision, for diagnostics.
 * Prefer active-dungeon set when present; otherwise global ranks.
 */
export function collectObservedWclSeasonSpecs(input: {
  classSlug: string;
  wclPerformanceEvidence?: WclSeasonPerformanceEvidence | null;
  activeDungeonSlugs: readonly string[];
}): string[] {
  const active = collectActiveDungeonSeasonSpecs(input);
  if (active.length > 0) return active;
  return collectSpecRankSeasonSpecs(input);
}

export function wclSeasonEvidenceFromPersistedAggregate(
  compact: Pick<PersistedCharacterPerformanceAggregateV2, "damage" | "healing">,
): WclSeasonPerformanceEvidence {
  const dungeonAggregates: WclSeasonDungeonEvidence[] = [
    ...compact.damage.dungeonAggregates.map((row) => ({
      dungeonSlug: row.dungeonSlug,
      specialization: row.specialization,
    })),
    ...(compact.healing?.dungeonAggregates ?? []).map((row) => ({
      dungeonSlug: row.dungeonSlug,
      specialization: row.specialization,
    })),
  ];
  const specRanks: WclSeasonSpecRankEvidence[] = [
    ...compact.damage.observedSpecs,
    ...(compact.healing?.observedSpecs ?? []),
  ].map((spec) => ({ spec }));
  return { specRanks, dungeonAggregates };
}

function profileFallback(
  profile: SeasonScoringProfileIdentity,
  classSlug: string | null,
  observedWclSpecs: string[],
  extraLimitations: string[] = [],
): SeasonScoringIdentity {
  return {
    classSlug,
    specSlug: normalizePerformanceSpecToken(profile.specSlug),
    role: PLAYABLE_ROLES.has(profile.role) ? profile.role : "UNKNOWN",
    source: "PROFILE",
    observedWclSpecs,
    limitations: ["season_scoring_identity_wcl_spec_absent", ...extraLimitations],
  };
}

function resolveFromObservedSpecs(input: {
  classSlug: string;
  observedSpecs: string[];
  unambiguousSource: "WCL_ACTIVE_DUNGEONS" | "WCL_SPEC_RANKS";
  profileIdentity: SeasonScoringProfileIdentity;
}): SeasonScoringIdentity {
  const { classSlug, observedSpecs, unambiguousSource, profileIdentity } = input;

  if (observedSpecs.length === 1) {
    const specSlug = observedSpecs[0]!;
    const catalogRole = toPlayableRole(canonicalRoleForClassSpec(classSlug, specSlug));
    if (catalogRole == null) {
      return profileFallback(profileIdentity, classSlug, observedSpecs, [
        "season_scoring_identity_catalog_role_missing",
      ]);
    }
    return {
      classSlug,
      specSlug,
      role: catalogRole,
      // Keep WCL_SEASON as a stable alias for unambiguous WCL season evidence.
      source: unambiguousSource === "WCL_ACTIVE_DUNGEONS" ? "WCL_ACTIVE_DUNGEONS" : "WCL_SPEC_RANKS",
      observedWclSpecs: observedSpecs,
      limitations: [],
    };
  }

  const roles = new Set<EvidenceRole>();
  for (const specSlug of observedSpecs) {
    const role = toPlayableRole(canonicalRoleForClassSpec(classSlug, specSlug));
    if (role != null) roles.add(role);
  }

  if (roles.size > 1) {
    return {
      classSlug,
      specSlug: null,
      role: "UNKNOWN",
      source: "WCL_SEASON_ROLE_AMBIGUOUS",
      observedWclSpecs: observedSpecs,
      limitations: [
        "season_scoring_identity_role_ambiguous",
        `observed_specs:${observedSpecs.join(",")}`,
        `observed_roles:${[...roles].sort().join(",")}`,
      ],
    };
  }

  const sharedRole = [...roles][0] ?? "UNKNOWN";
  return {
    classSlug,
    specSlug: null,
    role: sharedRole,
    source: "WCL_SEASON_SPEC_AMBIGUOUS",
    observedWclSpecs: observedSpecs,
    limitations: [
      "season_scoring_identity_spec_ambiguous",
      `observed_specs:${observedSpecs.join(",")}`,
      `observed_role:${sharedRole}`,
    ],
  };
}

/**
 * Resolve the class/spec/role used by authoritative scoring for the effective
 * M+ season. Does not mutate current profile identity.
 *
 * Stage A — exactly one active-dungeon spec → use it; ignore global specRanks
 * Stage B — multiple active-dungeon specs → ambiguity rules on those rows only
 * Stage C — no active-dungeon specs → unambiguous global specRanks, else fail closed
 * Stage D — no usable WCL evidence → profile identity
 */
export function resolveSeasonScoringIdentity(
  input: ResolveSeasonScoringIdentityInput,
): SeasonScoringIdentity {
  const classSlug = normalizeRetailClassSlug(input.profileIdentity.classSlug);
  if (classSlug == null) {
    return profileFallback(input.profileIdentity, null, []);
  }

  const activeDungeonSpecs = collectActiveDungeonSeasonSpecs({
    classSlug,
    wclPerformanceEvidence: input.wclPerformanceEvidence,
    activeDungeonSlugs: input.activeDungeonSlugs,
  });

  // Stage A / B — active dungeon specialization is primary.
  if (activeDungeonSpecs.length > 0) {
    return resolveFromObservedSpecs({
      classSlug,
      observedSpecs: activeDungeonSpecs,
      unambiguousSource: "WCL_ACTIVE_DUNGEONS",
      profileIdentity: input.profileIdentity,
    });
  }

  // Stage C — only when active dungeon rows have no usable specialization.
  const specRankSpecs = collectSpecRankSeasonSpecs({
    classSlug,
    wclPerformanceEvidence: input.wclPerformanceEvidence,
  });
  if (specRankSpecs.length > 0) {
    return resolveFromObservedSpecs({
      classSlug,
      observedSpecs: specRankSpecs,
      unambiguousSource: "WCL_SPEC_RANKS",
      profileIdentity: input.profileIdentity,
    });
  }

  // Stage D — profile fallback.
  return profileFallback(input.profileIdentity, classSlug, []);
}

export function seasonScoringIdentityLogFields(input: {
  profileIdentity: SeasonScoringProfileIdentity;
  seasonIdentity: SeasonScoringIdentity;
}): Record<string, unknown> {
  return {
    event: "season_scoring_identity_resolved",
    profileClassSlug: input.profileIdentity.classSlug,
    profileSpecSlug: input.profileIdentity.specSlug,
    profileRole: input.profileIdentity.role,
    seasonScoringClassSlug: input.seasonIdentity.classSlug,
    seasonScoringSpecSlug: input.seasonIdentity.specSlug,
    seasonScoringRole: input.seasonIdentity.role,
    seasonScoringIdentitySource: input.seasonIdentity.source,
    observedWclSpecs: input.seasonIdentity.observedWclSpecs,
    identityLimitations: input.seasonIdentity.limitations,
  };
}

export function seasonIdentityAllowsDamageWarmHit(
  identity: SeasonScoringIdentity,
): boolean {
  if (identity.role !== "DPS" && identity.role !== "TANK") return false;
  return (
    identity.source === "WCL_ACTIVE_DUNGEONS" ||
    identity.source === "WCL_SPEC_RANKS" ||
    identity.source === "WCL_SEASON" ||
    identity.source === "PROFILE"
  );
}
