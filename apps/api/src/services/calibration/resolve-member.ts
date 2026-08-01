/**
 * Resolve intake members into enriched calibration records + exclusions.
 * Pure transformation — provider/DB results are injected.
 */
import { findSpecDefinition } from "@mplus/abilities";
import type { IntakeMember, ProvidedRole } from "./intake.js";
import {
  classifyMetaMembership,
  type MetaClassification,
  type SeasonMetaPolicyV1,
} from "./meta-policy.js";

export type CalibrationRole = "DPS" | "TANK" | "HEALER";

export type ExclusionReason =
  | "ROLE_CONTEXT_CONFLICT"
  | "ROLE_CONTEXT_MISMATCH"
  | "MISSING_ROLE_UNRESOLVED"
  | "MYZOUTH_BOOTSTRAP_DEFERRED"
  | "IDENTITY_UNRESOLVED"
  | "CLASS_SPEC_UNRESOLVED"
  | "META_UNRESOLVED"
  | "SEASON_BINDING_FAILED"
  | "EVIDENCE_MISSING"
  | "DATA_QUALITY";

/** Expected Character ID for Myzouth on remote test (must be preserved). */
export const MYZOUTH_EXPECTED_CHARACTER_ID = "4e2e51ee-9e77-44a0-ba82-4d24a68b4486";

export type BoostLabelStatus = "NOT_USER_LABELED";

export interface PersistedCharacterLookup {
  characterId: string;
  blizzardCharacterId: string | null;
  role: CalibrationRole | null;
  classSlug: string | null;
  specSlug: string | null;
  level: number | null;
  faction: string | null;
  lastPublicRefreshAt: string | null;
  snapshotIds: string[];
  incompleteBootstrap: boolean;
}

export interface BlizzardProfileEnrichment {
  blizzardCharacterId: string | null;
  classSlug: string | null;
  specSlug: string | null;
  role: CalibrationRole | null;
  level: number | null;
  faction: string | null;
  displayName: string | null;
  realmSlug: string | null;
}

export interface ResolvedMember {
  /** Original intake fields preserved. */
  id: string;
  region: string;
  realm: string;
  character: string;
  providedRole: ProvidedRole;
  expectedTier: string;
  expectedLabel: string;
  rationale: string;
  source: "user-selected";
  /** Enrichment */
  characterId: string | null;
  resolvedRole: CalibrationRole | null;
  classSlug: string | null;
  specSlug: string | null;
  blizzardCharacterId: string | null;
  seasonSlug: string | null;
  meta: MetaClassification;
  metaPolicyId: string;
  metaPolicyEvaluatedAt: string;
  suspectedBoost: false;
  boostLabelStatus: BoostLabelStatus;
  identityResolutionSource: "persisted" | "blizzard-profile" | "persisted+blizzard" | "unresolved";
  identityResolvedAt: string | null;
  snapshotIds: string[];
  evidenceStatus: string;
  exclusionReason: ExclusionReason | null;
  roleMismatch: boolean;
  provenance: Record<string, unknown>;
}

export interface ExclusionRecord {
  memberId: string;
  identity: string;
  reason: ExclusionReason;
  detail: string;
  deferred: boolean;
}

function upperRole(role: string | null | undefined): CalibrationRole | null {
  if (!role) return null;
  const u = role.toUpperCase();
  if (u === "DPS" || u === "TANK" || u === "HEALER") return u;
  return null;
}

/**
 * Derive role from class+spec via canonical matrix. Never defaults to DPS.
 */
export function resolveRoleFromClassSpec(
  classSlug: string | null | undefined,
  specSlug: string | null | undefined,
): CalibrationRole | null {
  if (!classSlug || !specSlug) return null;
  const spec = findSpecDefinition(classSlug, specSlug);
  return upperRole(spec?.role ?? null);
}

export function isMyzouthMember(member: Pick<IntakeMember, "region" | "realm" | "character" | "id">): boolean {
  return (
    member.id === "user-s-eu-burning-legion-myzouth-dps" ||
    (member.region.toUpperCase() === "EU" &&
      member.realm.toLowerCase() === "burning-legion" &&
      member.character.toLowerCase() === "myzouth")
  );
}

export function isPetbearIdentity(member: Pick<IntakeMember, "region" | "realm" | "character">): boolean {
  return (
    member.region.toUpperCase() === "EU" &&
    member.realm.toLowerCase() === "outland" &&
    member.character.toLowerCase() === "petbear"
  );
}

export interface ResolveMemberInput {
  member: IntakeMember;
  policy: SeasonMetaPolicyV1;
  persisted: PersistedCharacterLookup | null;
  blizzard: BlizzardProfileEnrichment | null;
  nowIso: string;
  /** When true, Myzouth bootstrap recovery is validated on remote test. */
  myzouthRecoveryComplete: boolean;
  /** Distinct role/spec evidence for Petbear dual observations at the evaluation cutoff. */
  petbearRoleContextsProvenDistinct: boolean;
  /**
   * Immutable cutoff evidence proves class/spec/role matches the user-provided role context.
   * Current Blizzard active specialization alone is never sufficient.
   */
  roleContextProvenAtCutoff?: boolean;
}

export function resolveIntakeMember(input: ResolveMemberInput): {
  resolved: ResolvedMember;
  exclusion: ExclusionRecord | null;
} {
  const { member, policy, persisted, blizzard, nowIso } = input;
  const identity = `${member.region}/${member.realm}/${member.character}`;

  const classSlug = blizzard?.classSlug ?? persisted?.classSlug ?? null;
  const specSlug = blizzard?.specSlug ?? persisted?.specSlug ?? null;
  const blizzardRole = upperRole(blizzard?.role ?? null);
  const matrixRole = resolveRoleFromClassSpec(classSlug, specSlug);
  const persistedRole = upperRole(persisted?.role ?? null);

  // Active-profile role (diagnostic). Never reinterpret user-labelled role from current active spec alone.
  const activeProfileRole = blizzardRole ?? matrixRole ?? persistedRole ?? null;
  const roleContextProven = input.roleContextProvenAtCutoff === true;
  const roleMismatch =
    member.providedRole != null &&
    activeProfileRole != null &&
    member.providedRole !== activeProfileRole;

  // Manifest/calibration role: keep providedRole when labelled; otherwise use derived active role.
  // Mismatched provided roles are excluded below — never silently adopt Windwalker/etc.
  const resolvedRole: CalibrationRole | null = member.providedRole ?? activeProfileRole;

  const meta = classifyMetaMembership(policy, classSlug, specSlug);

  let identityResolutionSource: ResolvedMember["identityResolutionSource"] = "unresolved";
  if (persisted && blizzard) identityResolutionSource = "persisted+blizzard";
  else if (persisted) identityResolutionSource = "persisted";
  else if (blizzard) identityResolutionSource = "blizzard-profile";

  let exclusionReason: ExclusionReason | null = null;
  let exclusionDetail = "";
  let deferred = false;
  let evidenceStatus = "PENDING";

  // Petbear duplicate identity — both observations excluded until distinct cutoff evidence exists.
  if (isPetbearIdentity(member) && !input.petbearRoleContextsProvenDistinct) {
    exclusionReason = "ROLE_CONTEXT_CONFLICT";
    exclusionDetail =
      "Same identity appears as TANK/C and DPS/D without immutable distinct role/spec evidence for the evaluation cutoff. Current active specialization is not enough to reinterpret either labelled role context.";
  }

  // User-labelled role context vs current active profile — exclude unless cutoff evidence proves the label.
  if (
    !exclusionReason &&
    member.providedRole != null &&
    activeProfileRole != null &&
    member.providedRole !== activeProfileRole &&
    !roleContextProven
  ) {
    exclusionReason = "ROLE_CONTEXT_MISMATCH";
    exclusionDetail =
      `providedRole ${member.providedRole} does not match current active profile role ${activeProfileRole}` +
      ` (${classSlug ?? "?"}/${specSlug ?? "?"}). Current Blizzard active specialization is not enough to reinterpret the user-labelled role context.`;
    deferred = true;
  }

  // Missing provided role — must resolve from authoritative evidence, never DPS default
  if (!exclusionReason && member.providedRole == null && activeProfileRole == null) {
    exclusionReason = "MISSING_ROLE_UNRESOLVED";
    exclusionDetail = "providedRole is null and role could not be derived from class/spec evidence.";
  }

  // Myzouth recovery path — keep deferred until recovery is merged/deployed and validated on test.
  if (!exclusionReason && isMyzouthMember(member) && !input.myzouthRecoveryComplete) {
    exclusionReason = "MYZOUTH_BOOTSTRAP_DEFERRED";
    exclusionDetail =
      `Myzouth deferred until bootstrap recovery is merged and deployed to test; preserve Character ID ${MYZOUTH_EXPECTED_CHARACTER_ID}.`;
    deferred = true;
  }

  if (!exclusionReason && !classSlug && !specSlug) {
    exclusionReason = "CLASS_SPEC_UNRESOLVED";
    exclusionDetail = "classSlug/specSlug unavailable from persisted Character and Blizzard profile.";
  }

  if (!exclusionReason && meta === "unresolved") {
    exclusionReason = "META_UNRESOLVED";
    exclusionDetail = "meta cannot be classified without classSlug+specSlug; not coerced to non-meta.";
  }

  if (!exclusionReason && !persisted?.characterId && !blizzard) {
    exclusionReason = "IDENTITY_UNRESOLVED";
    exclusionDetail = "No persisted Character and no Blizzard profile enrichment.";
  }

  if (exclusionReason) {
    evidenceStatus = deferred ? "DEFERRED" : "EXCLUDED";
  } else if (persisted?.snapshotIds?.length) {
    evidenceStatus = "SNAPSHOTS_PRESENT";
  } else {
    evidenceStatus = "RESOLVED_METADATA_ONLY";
  }

  const resolved: ResolvedMember = {
    id: member.id,
    region: member.region,
    realm: member.realm,
    character: member.character,
    providedRole: member.providedRole,
    expectedTier: member.expectedTier,
    expectedLabel: member.expectedLabel,
    rationale: member.rationale,
    source: "user-selected",
    characterId: persisted?.characterId ?? null,
    resolvedRole,
    classSlug,
    specSlug,
    blizzardCharacterId:
      blizzard?.blizzardCharacterId ??
      (persisted?.blizzardCharacterId != null ? String(persisted.blizzardCharacterId) : null),
    seasonSlug: policy.seasonSlug,
    meta,
    metaPolicyId: policy.policyId,
    metaPolicyEvaluatedAt: policy.evaluatedAt,
    suspectedBoost: false,
    boostLabelStatus: "NOT_USER_LABELED",
    identityResolutionSource,
    identityResolvedAt: identityResolutionSource === "unresolved" ? null : nowIso,
    snapshotIds: persisted?.snapshotIds ?? [],
    evidenceStatus,
    exclusionReason,
    roleMismatch,
    provenance: {
      intakeId: member.id,
      intakeNotes: member.resolution.notes,
      persistedIncompleteBootstrap: persisted?.incompleteBootstrap ?? null,
      blizzardLevel: blizzard?.level ?? null,
      blizzardFaction: blizzard?.faction ?? null,
      policySeasonSlug: policy.seasonSlug,
      activeProfileRole,
      roleContextProvenAtCutoff: roleContextProven,
      classSlugActive: classSlug,
      specSlugActive: specSlug,
    },
  };

  const exclusion: ExclusionRecord | null = exclusionReason
    ? {
        memberId: member.id,
        identity,
        reason: exclusionReason,
        detail: exclusionDetail,
        deferred,
      }
    : null;

  return { resolved, exclusion };
}

/**
 * Build a strict CohortManifest 1.0.0 member subset — only fully resolved rows.
 */
export function toStrictManifestMember(resolved: ResolvedMember): {
  ok: true;
  member: {
    id: string;
    region: string;
    realm: string;
    character: string;
    role: CalibrationRole;
    classSlug: string;
    specSlug: string;
    expectedLabel: string;
    meta: boolean;
    rationale: string;
    suspectedBoost: boolean;
    source: "user-selected";
    snapshotIds?: string[];
    seasonSlug?: string;
  };
} | { ok: false; reason: string } {
  if (resolved.exclusionReason) {
    return { ok: false, reason: resolved.exclusionReason };
  }
  if (!resolved.resolvedRole) return { ok: false, reason: "resolvedRole missing" };
  if (!resolved.classSlug || !resolved.specSlug) {
    return { ok: false, reason: "class/spec missing" };
  }
  if (resolved.meta === "unresolved") return { ok: false, reason: "meta unresolved" };
  if (!resolved.characterId) return { ok: false, reason: "characterId missing" };
  // Refuse current-active class/spec when it conflicts with a user-labelled role.
  if (resolved.roleMismatch && resolved.provenance.roleContextProvenAtCutoff !== true) {
    return { ok: false, reason: "ROLE_CONTEXT_MISMATCH" };
  }

  return {
    ok: true,
    member: {
      id: resolved.id,
      region: resolved.region,
      realm: resolved.realm,
      character: resolved.character,
      role: resolved.resolvedRole,
      classSlug: resolved.classSlug,
      specSlug: resolved.specSlug,
      expectedLabel: resolved.expectedLabel,
      meta: resolved.meta === true,
      rationale: resolved.rationale,
      suspectedBoost: false,
      source: "user-selected",
      snapshotIds: resolved.snapshotIds.length > 0 ? resolved.snapshotIds : undefined,
      seasonSlug: resolved.seasonSlug ?? undefined,
    },
  };
}
