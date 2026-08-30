import type { AbilityAvailability, ProvenanceSource, SourceOwnership } from "../../types.js";
import {
  deriveAvailabilityFromSimcMembership,
  parseSimcMembership,
  type SimcSpellMembership,
} from "../extract/simc-availability.js";
import type {
  AbilitySpellBindingRole,
  CatalogRefreshSourceKind,
  InventoryScopeClassification,
  SourceObservation,
} from "../types.js";
import { bindingRoleRank } from "../bindings.js";
import { getAllRegisteredRules } from "../../registry.js";
import type { CuratedDraftRuleInput, DraftBinding } from "./draft-validation.js";
import { suggestCuratedCanonicalKey } from "./import-plan.js";

export interface ReviewItemDraftPrefillInput {
  kind?: string | null;
  name: string;
  primarySpellId: number | null;
  matchedCanonicalKey: string | null;
  classSlug: string | null;
  specSlugs: string[];
  raceSlugs: string[];
  evidence: Record<string, unknown>;
  sourceProvenance: Record<string, unknown>;
  wowBuild?: string | null;
  generatedAt?: string | null;
  /** Extra reserved keys (other drafts, ACTIVE release) beyond static registry. */
  reservedCanonicalKeys?: ReadonlySet<string>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Project source binding evidence into unique curated spellId+role bindings. */
export function parseCandidateBindings(value: unknown): DraftBinding[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: DraftBinding[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const spellId = asNumber((row as { spellId?: unknown }).spellId);
    const role = (row as { role?: unknown }).role;
    if (spellId == null || spellId <= 0 || typeof role !== "string") continue;
    const key = `${spellId}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ spellId, role: role as AbilitySpellBindingRole });
  }
  return out.sort(
    (a, b) => a.spellId - b.spellId || bindingRoleRank(a.role) - bindingRoleRank(b.role),
  );
}

function parseSourceObservations(value: unknown): SourceObservation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is SourceObservation => {
    return row != null && typeof row === "object" && typeof (row as SourceObservation).source === "string";
  });
}

function presentObservation(state: SourceObservation["state"]): boolean {
  return state === "PRESENT" || state === "IDENTITY_ONLY";
}

export function inferSourceOwnershipFromOwnershipKind(
  ownershipKind: string | null,
): SourceOwnership | null {
  if (ownershipKind === "PET_TALENT_TREE") return "PET";
  if (ownershipKind === "PLAYABLE_PLAYER" || ownershipKind === "PLAYABLE_RACE") return "PLAYER";
  return null;
}

export function inferAvailabilityFromReviewContext(input: {
  classSlug: string | null;
  raceSlugs: string[];
  ownershipKind: InventoryScopeClassification | "PLAYABLE_PLAYER" | string | null;
  availability?: AbilityAvailability | null;
  simcMembership?: SimcSpellMembership | null;
}): AbilityAvailability | null {
  if (input.availability) return input.availability;
  const membership = input.simcMembership;
  if (membership) {
    return deriveAvailabilityFromSimcMembership(
      membership,
      input.ownershipKind as InventoryScopeClassification | "PLAYABLE_PLAYER" | null | undefined,
    );
  }
  if (input.raceSlugs.length > 0 && !input.classSlug) return "SHARED";
  if (input.ownershipKind === "PET_TALENT_TREE") return "PET_DEPENDENT";
  return null;
}

export function provenanceFromRefreshEvidence(input: {
  sourceProvenance: Record<string, unknown>;
  evidence: Record<string, unknown>;
  wowBuild?: string | null;
  generatedAt?: string | null;
}): Record<string, unknown> {
  const fromItem = parseSourceObservations(input.sourceProvenance.sourceObservations);
  const fromEvidence = parseSourceObservations(input.evidence.sourceObservations);
  const observations = fromItem.length > 0 ? fromItem : fromEvidence;

  const simcPresent = observations.some(
    (o) => o.source === "SIMULATIONCRAFT" && presentObservation(o.state),
  );
  const blizzardPresent = observations.some(
    (o) => o.source === "BLIZZARD" && presentObservation(o.state),
  );

  let source: ProvenanceSource = "SIMC_ADVISORY";
  if (!simcPresent && blizzardPresent) source = "BLIZZARD_API";

  const identity = observations.find((o) => o.identity)?.identity;
  const validFromBuild =
    asString(input.evidence.validFromBuild) ??
    identity?.validFromBuild ??
    asString(input.wowBuild) ??
    null;

  const verifiedAt =
    asString(input.generatedAt) ??
    asString(identity?.retrievedAt) ??
    null;

  const gameVersion =
    asString(input.wowBuild) ??
  asString(identity?.validFromBuild) ??
    validFromBuild ??
    "";

  const out: Record<string, unknown> = {
    source,
    verifiedAt: verifiedAt ?? new Date().toISOString(),
    gameVersion,
  };
  if (validFromBuild) out.validFromBuild = validFromBuild;
  const validToBuild = asString(input.evidence.validToBuild);
  if (validToBuild) out.validToBuild = validToBuild;
  return out;
}

/**
 * Deterministic draft defaults from review item columns + refresh evidence.
 * Does not set category or dimensionTags (human curation).
 */
export function prefillCuratedDraftDefaults(
  input: ReviewItemDraftPrefillInput,
): Omit<CuratedDraftRuleInput, "category" | "dimensionTags"> & {
  category: null;
  dimensionTags: [];
} {
  const evidence = input.evidence;
  const ownershipKind = asString(evidence.ownershipKind);
  const evidenceAvailability = asString(evidence.availability) as AbilityAvailability | null;
  const simcMembership = parseSimcMembership(evidence.simcMembership);
  const candidateBindings = parseCandidateBindings(evidence.candidateBindings);

  const bindings =
    candidateBindings.length > 0
      ? candidateBindings
      : input.primarySpellId != null
        ? [{ spellId: input.primarySpellId, role: "PRIMARY_ACTIVATION" as const }]
        : [];

  const spellIdSet = new Set<number>();
  for (const b of bindings) spellIdSet.add(b.spellId);
  if (input.primarySpellId != null) spellIdSet.add(input.primarySpellId);
  const spellIds = [...spellIdSet].sort((a, b) => a - b);

  const reservedKeys = new Set<string>([
    ...getAllRegisteredRules().map((rule) => rule.canonicalKey),
    ...(input.reservedCanonicalKeys ?? []),
  ]);

  const canonicalKey =
    input.matchedCanonicalKey ??
    suggestCuratedCanonicalKey(
      {
        classSlug: input.classSlug,
        specSlugs: input.specSlugs,
        raceSlugs: input.raceSlugs,
        name: input.name,
        primarySpellId: input.primarySpellId,
      },
      { reservedKeys },
    );

  const validFromBuild =
    asString(evidence.validFromBuild) ?? asString(input.wowBuild) ?? null;
  const validToBuild = asString(evidence.validToBuild);

  const provenance = provenanceFromRefreshEvidence({
    sourceProvenance: input.sourceProvenance,
    evidence,
    wowBuild: input.wowBuild,
    generatedAt: input.generatedAt,
  });

  return {
    canonicalKey,
    name: input.name,
    spellIds,
    bindings,
    classSlug: input.classSlug,
    specSlugs: input.specSlugs,
    raceSlugs: input.raceSlugs,
    category: null,
    dimensionTags: [],
    availability: inferAvailabilityFromReviewContext({
      classSlug: input.classSlug,
      raceSlugs: input.raceSlugs,
      ownershipKind,
      availability: evidenceAvailability,
      simcMembership,
    }),
    cooldownSeconds: asNumber(evidence.cooldownSeconds),
    charges: asNumber(evidence.charges),
    sourceOwnership: inferSourceOwnershipFromOwnershipKind(ownershipKind),
    provenance,
    validityBuild: validFromBuild,
    validFromBuild,
    validToBuild,
    notes: null,
  };
}

export type DraftPrefillMergeMode = "create" | "update";

/**
 * Merge a draft patch onto a base. On create, null/empty patch values do not
 * erase evidence-backed defaults (empty client forms must not wipe prefill).
 */
export function mergeCuratedDraftInput(
  base: CuratedDraftRuleInput,
  patch: Record<string, unknown>,
  mode: DraftPrefillMergeMode = "update",
): CuratedDraftRuleInput {
  const skipAbsent = mode === "create";
  const entries = Object.entries(patch).filter(([key, value]) => {
    if (key === "provenance") return false;
    if (value === undefined) return false;
    if (skipAbsent && value === null) return false;
    if (skipAbsent && typeof value === "string" && value.trim() === "") return false;
    if (skipAbsent && key === "spellIds" && Array.isArray(value) && value.length === 0) {
      return false;
    }
    if (skipAbsent && key === "bindings" && Array.isArray(value) && value.length === 0) {
      return false;
    }
    return true;
  });

  const provenancePatch =
    patch.provenance && typeof patch.provenance === "object"
      ? (patch.provenance as Record<string, unknown>)
      : undefined;

  const mergedProvenance = { ...(base.provenance ?? {}) };
  if (provenancePatch) {
    for (const [key, value] of Object.entries(provenancePatch)) {
      if (value === undefined) continue;
      if (skipAbsent && (value === null || (typeof value === "string" && value.trim() === ""))) {
        continue;
      }
      mergedProvenance[key] = value;
    }
  }

  const merged = {
    ...base,
    ...Object.fromEntries(entries),
    provenance: mergedProvenance,
    name: (patch.name as string | undefined) ?? base.name,
    spellIds: (patch.spellIds as number[] | undefined) ?? base.spellIds,
    bindings: (patch.bindings as DraftBinding[] | undefined) ?? base.bindings,
  };

  return merged as CuratedDraftRuleInput;
}

export type CatalogDiffCandidateMetadata = {
  cooldownSeconds?: number | null;
  charges?: number | null;
  isPassive?: boolean | null;
  ownershipKind?: InventoryScopeClassification | "PLAYABLE_PLAYER";
  simcMembership?: SimcSpellMembership;
  availability?: AbilityAvailability | null;
  validFromBuild?: string;
  validToBuild?: string;
  candidateBindings?: Array<{ spellId: number; role: AbilitySpellBindingRole }>;
};

/** Copy normalized candidate fields onto a catalog diff entry. */
export function candidateMetadataForDiff(
  candidate: {
    cooldownSeconds?: number | null;
    charges?: number | null;
    isPassive?: boolean | null;
    ownershipKind?: InventoryScopeClassification | "PLAYABLE_PLAYER";
    simcMembership?: SimcSpellMembership;
    availability?: AbilityAvailability | null;
    validFromBuild?: string;
    validToBuild?: string;
    bindings?: Array<{ spellId: number; role: AbilitySpellBindingRole }>;
  },
): CatalogDiffCandidateMetadata {
  return {
    cooldownSeconds: candidate.cooldownSeconds ?? null,
    charges: candidate.charges ?? null,
    isPassive: candidate.isPassive ?? null,
    ownershipKind: candidate.ownershipKind,
    simcMembership: candidate.simcMembership ?? undefined,
    availability: candidate.availability ?? null,
    validFromBuild: candidate.validFromBuild,
    validToBuild: candidate.validToBuild,
    candidateBindings: candidate.bindings?.map((b) => ({ spellId: b.spellId, role: b.role })),
  };
}

export function candidateEvidenceFromDiffEntry(entry: {
  candidateKey?: string;
  cooldownSeconds?: number | null;
  charges?: number | null;
  isPassive?: boolean | null;
  ownershipKind?: InventoryScopeClassification | "PLAYABLE_PLAYER";
  simcMembership?: SimcSpellMembership;
  availability?: AbilityAvailability | null;
  validFromBuild?: string;
  validToBuild?: string;
  candidateBindings?: Array<{ spellId: number; role: AbilitySpellBindingRole }>;
  sourceObservations?: SourceObservation[];
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.candidateKey) out.candidateKey = entry.candidateKey;
  if (entry.cooldownSeconds != null) out.cooldownSeconds = entry.cooldownSeconds;
  if (entry.charges != null) out.charges = entry.charges;
  if (entry.isPassive != null) out.isPassive = entry.isPassive;
  if (entry.ownershipKind) out.ownershipKind = entry.ownershipKind;
  if (entry.simcMembership) out.simcMembership = entry.simcMembership;
  if (entry.availability) out.availability = entry.availability;
  if (entry.validFromBuild) out.validFromBuild = entry.validFromBuild;
  if (entry.validToBuild) out.validToBuild = entry.validToBuild;
  if (entry.candidateBindings?.length) out.candidateBindings = entry.candidateBindings;
  if (entry.sourceObservations?.length) {
    out.sourceObservations = entry.sourceObservations;
  }
  return out;
}

export function primaryRefreshSourceKind(
  observations: SourceObservation[],
): CatalogRefreshSourceKind | null {
  if (observations.some((o) => o.source === "SIMULATIONCRAFT" && presentObservation(o.state))) {
    return "SIMULATIONCRAFT";
  }
  if (observations.some((o) => o.source === "BLIZZARD" && presentObservation(o.state))) {
    return "BLIZZARD";
  }
  return null;
}
