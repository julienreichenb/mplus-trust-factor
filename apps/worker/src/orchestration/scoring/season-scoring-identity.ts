/**
 * Season-scoped scoring identity — distinct from the character's current
 * Blizzard/Raider.IO profile identity.
 *
 * Current profile (UI / Character.activeSpec) must not be rewritten from
 * historical M+ evidence. Authoritative scoring uses this resolver instead.
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

/**
 * Valid current-season WCL specs for the profile class, normalized + deduped.
 * Ignores null/empty/unresolvable tokens and dungeon rows outside the active pool.
 */
export function collectObservedWclSeasonSpecs(input: {
  classSlug: string;
  wclPerformanceEvidence?: WclSeasonPerformanceEvidence | null;
  activeDungeonSlugs: readonly string[];
}): string[] {
  const observed = new Set<string>();
  const evidence = input.wclPerformanceEvidence;
  if (!evidence) return [];

  const activeKeys = activeDungeonKeySet(input.activeDungeonSlugs);

  for (const rank of evidence.specRanks ?? []) {
    const spec = catalogSpecForClass(input.classSlug, rank?.spec ?? null);
    if (spec) observed.add(spec);
  }

  for (const dungeon of evidence.dungeonAggregates ?? []) {
    if (!dungeonInActiveSet(dungeon?.dungeonSlug ?? null, activeKeys)) continue;
    const spec = catalogSpecForClass(input.classSlug, dungeon?.specialization ?? null);
    if (spec) observed.add(spec);
  }

  return [...observed].sort();
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

/**
 * Resolve the class/spec/role used by authoritative scoring for the effective
 * M+ season. Does not mutate current profile identity.
 *
 * A — exactly one valid observed season spec → use it + catalog role (WCL_SEASON)
 * B — no usable WCL spec → existing profile identity
 * C — multiple specs, different catalog roles → fail closed (role UNKNOWN)
 * D — multiple specs, same catalog role → keep role, do not invent a spec
 */
export function resolveSeasonScoringIdentity(
  input: ResolveSeasonScoringIdentityInput,
): SeasonScoringIdentity {
  const classSlug = normalizeRetailClassSlug(input.profileIdentity.classSlug);
  const observedWclSpecs =
    classSlug != null
      ? collectObservedWclSeasonSpecs({
          classSlug,
          wclPerformanceEvidence: input.wclPerformanceEvidence,
          activeDungeonSlugs: input.activeDungeonSlugs,
        })
      : [];

  if (classSlug == null || observedWclSpecs.length === 0) {
    return profileFallback(input.profileIdentity, classSlug, observedWclSpecs);
  }

  if (observedWclSpecs.length === 1) {
    const specSlug = observedWclSpecs[0]!;
    const catalogRole = toPlayableRole(canonicalRoleForClassSpec(classSlug, specSlug));
    if (catalogRole == null) {
      return profileFallback(input.profileIdentity, classSlug, observedWclSpecs, [
        "season_scoring_identity_catalog_role_missing",
      ]);
    }
    return {
      classSlug,
      specSlug,
      role: catalogRole,
      source: "WCL_SEASON",
      observedWclSpecs,
      limitations: [],
    };
  }

  const roles = new Set<EvidenceRole>();
  for (const specSlug of observedWclSpecs) {
    const role = toPlayableRole(canonicalRoleForClassSpec(classSlug, specSlug));
    if (role != null) roles.add(role);
  }

  if (roles.size > 1) {
    return {
      classSlug,
      specSlug: null,
      role: "UNKNOWN",
      source: "WCL_SEASON_ROLE_AMBIGUOUS",
      observedWclSpecs,
      limitations: [
        "season_scoring_identity_role_ambiguous",
        `observed_specs:${observedWclSpecs.join(",")}`,
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
    observedWclSpecs,
    limitations: [
      "season_scoring_identity_spec_ambiguous",
      `observed_specs:${observedWclSpecs.join(",")}`,
      `observed_role:${sharedRole}`,
    ],
  };
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
  return identity.source === "WCL_SEASON" || identity.source === "PROFILE";
}
