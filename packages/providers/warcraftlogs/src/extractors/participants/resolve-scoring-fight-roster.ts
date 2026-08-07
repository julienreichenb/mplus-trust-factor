/**
 * Shared production fight-roster resolution for Scoring.
 *
 * Pure: CapabilityEvidencePackageV1 (+ persisted masterData) → participant inputs.
 * Does not call WCL. Used by cold acquisition follow-up, warm cache, and replay.
 */
import { findRetailSpecIdentityByBlizzardSpecId } from "@mplus/abilities";
import type { CapabilityEvidencePackageV1 } from "@mplus/contracts";
import {
  nameRealmMatches,
  normalizeWclRealmSlug,
} from "../../discovery/fight-ownership.js";

export type ScoringFightRosterFailureCode =
  | "RAW_PACKAGE_MISSING_FIGHT_ROSTER"
  | "FRIENDLY_ACTOR_ABSENT_FROM_MASTER_DATA"
  | "DUPLICATE_FRIENDLY_ACTOR_IDS"
  | "INVALID_PARTICIPANT_ACTOR_ID"
  | "TARGET_PARTICIPANT_NOT_FOUND"
  | "TARGET_IDENTITY_CONFLICT"
  | "RAW_PACKAGE_SCHEMA_INCOMPATIBLE"
  | "RAW_PACKAGE_SOURCE_MISMATCH";

export class ScoringFightRosterError extends Error {
  readonly code: ScoringFightRosterFailureCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ScoringFightRosterFailureCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScoringFightRosterError";
    this.code = code;
    this.details = details;
  }
}

export interface ScoringFightRosterTargetIdentity {
  characterId: string;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: string | null;
  /** Report-local actor for this fight when already established. */
  targetActorId?: number | null;
}

export interface ScoringFightRosterParticipant {
  participantActorId: number;
  characterId: string | null;
  characterName: string;
  realmSlug: string | null;
  regionCode: string | null;
  classSlug: string | null;
  specSlug: string | null;
  role: string | null;
  ownedPetActorIds: number[];
}

export interface ResolveScoringFightRosterInput {
  capabilityPackage: CapabilityEvidencePackageV1;
  /** Report masterData.actors table persisted with WclRunRaw. */
  masterData: unknown;
  /** Default region when actors lack an explicit region. */
  regionCode?: string | null;
  /** Optional CombatantInfo rows for spec/role enrichment. */
  combatantInfoEvents?: ReadonlyArray<Record<string, unknown>> | null;
  target?: ScoringFightRosterTargetIdentity | null;
  /**
   * When true (default), fail if target is provided but not found on the roster.
   * When false, still resolve other participants.
   */
  requireTarget?: boolean;
  /**
   * When set, capability package sourceKey must match this fight identity.
   */
  expectedSourceFight?: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
  } | null;
}

export interface ResolveScoringFightRosterSuccess {
  ok: true;
  participants: ScoringFightRosterParticipant[];
  skipped: Array<{ actorId: number; reason: string }>;
  targetActorId: number | null;
}

export interface ResolveScoringFightRosterFailure {
  ok: false;
  code: ScoringFightRosterFailureCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ResolveScoringFightRosterResult =
  | ResolveScoringFightRosterSuccess
  | ResolveScoringFightRosterFailure;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function slugifyClassOrSpec(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function durableSlug(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function normalizeRole(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "TANK" || normalized === "HEALER" || normalized === "DPS") {
    return normalized;
  }
  return null;
}

interface MasterActorRow {
  id: number;
  type: string;
  name: string;
  server: string | null;
  classSlug: string | null;
  petOwner: number | null;
}

function parseMasterActors(masterData: unknown): Map<number, MasterActorRow> {
  const root = asRecord(masterData);
  const actors = Array.isArray(root?.actors) ? root!.actors : [];
  const byId = new Map<number, MasterActorRow>();
  for (const raw of actors) {
    const actor = asRecord(raw);
    if (!actor) continue;
    const id = typeof actor.id === "number" ? actor.id : null;
    if (id == null || !Number.isFinite(id) || id <= 0) continue;
    const type = typeof actor.type === "string" ? actor.type : "";
    const name = typeof actor.name === "string" ? actor.name.trim() : "";
    const server =
      typeof actor.server === "string" && actor.server.trim()
        ? normalizeWclRealmSlug(actor.server)
        : null;
    const classRaw =
      typeof actor.subType === "string" && actor.subType.trim()
        ? actor.subType
        : typeof actor.className === "string" && actor.className.trim()
          ? actor.className
          : null;
    const classSlug =
      classRaw && classRaw.toLowerCase() !== "unknown"
        ? slugifyClassOrSpec(classRaw)
        : null;
    const petOwner =
      typeof actor.petOwner === "number" && actor.petOwner > 0
        ? actor.petOwner
        : null;
    byId.set(id, {
      id,
      type,
      name,
      server: durableSlug(server),
      classSlug: durableSlug(classSlug),
      petOwner,
    });
  }
  return byId;
}

function combatantEnrichment(
  events: ReadonlyArray<Record<string, unknown>> | null | undefined,
): Map<number, { specSlug: string | null; role: string | null }> {
  const out = new Map<number, { specSlug: string | null; role: string | null }>();
  for (const raw of events ?? []) {
    const source =
      typeof raw.sourceID === "number"
        ? raw.sourceID
        : typeof asRecord(raw.source)?.id === "number"
          ? (asRecord(raw.source)!.id as number)
          : null;
    if (source == null || source <= 0) continue;

    let specSlug: string | null = null;
    const specId =
      typeof raw.specID === "number"
        ? raw.specID
        : typeof raw.specId === "number"
          ? raw.specId
          : null;
    if (specId != null) {
      const identity = findRetailSpecIdentityByBlizzardSpecId(specId);
      specSlug = identity?.specSlug ?? null;
    } else if (typeof raw.spec === "string" && raw.spec.trim()) {
      specSlug = slugifyClassOrSpec(raw.spec);
    } else {
      const nested = asRecord(raw.spec);
      if (typeof nested?.name === "string" && nested.name.trim()) {
        specSlug = slugifyClassOrSpec(nested.name);
      }
    }

    const role = normalizeRole(
      typeof raw.role === "string"
        ? raw.role
        : typeof asRecord(raw.gear)?.role === "string"
          ? (asRecord(raw.gear)!.role as string)
          : null,
    );

    const existing = out.get(source);
    out.set(source, {
      specSlug: durableSlug(specSlug) ?? existing?.specSlug ?? null,
      role: role ?? existing?.role ?? null,
    });
  }
  return out;
}

function petsForOwner(
  actors: Map<number, MasterActorRow>,
  ownerId: number,
  packageOwnedPetIds: ReadonlySet<number>,
): number[] {
  const pets = new Set<number>();
  for (const actor of actors.values()) {
    if (actor.type !== "Pet" && actor.type !== "Guardian") continue;
    if (actor.petOwner !== ownerId) continue;
    // Prefer package-owned set when present; otherwise accept masterData ownership.
    if (packageOwnedPetIds.size > 0 && !packageOwnedPetIds.has(actor.id)) {
      continue;
    }
    pets.add(actor.id);
  }
  return [...pets].sort((a, b) => a - b);
}

function participantMatchesTargetIdentity(
  participant: ScoringFightRosterParticipant,
  target: ScoringFightRosterTargetIdentity,
): boolean {
  const regionOk =
    !participant.regionCode ||
    normalizeName(participant.regionCode) === normalizeName(target.regionCode);
  if (!regionOk) return false;
  // Never name-only: missing digest/actor realm cannot match a known target realm.
  if (participant.realmSlug == null || participant.realmSlug.length === 0) {
    return false;
  }
  return nameRealmMatches(
    participant.characterName,
    participant.realmSlug,
    target.characterName,
    target.realmSlug,
  );
}

function resolveTargetActorId(input: {
  players: ScoringFightRosterParticipant[];
  target: ScoringFightRosterTargetIdentity;
}): {
  actorId: number | null;
  matchCount: number;
  reason: "RESOLVED" | "NOT_FOUND" | "AMBIGUOUS" | "CONFLICT";
} {
  const byNameRealm = input.players.filter((p) =>
    participantMatchesTargetIdentity(p, input.target),
  );

  if (
    input.target.targetActorId != null &&
    Number.isFinite(input.target.targetActorId) &&
    input.target.targetActorId > 0
  ) {
    const byId = input.players.find(
      (p) => p.participantActorId === input.target.targetActorId,
    );
    if (!byId) {
      // Stale fight-local actor hint — fall through to name+realm when possible.
    } else if (!participantMatchesTargetIdentity(byId, input.target)) {
      // Actor ID present in this fight but identity contradicts name+realm+region.
      return {
        actorId: null,
        matchCount: byNameRealm.length,
        reason: "CONFLICT",
      };
    } else {
      return {
        actorId: byId.participantActorId,
        matchCount: 1,
        reason: "RESOLVED",
      };
    }
  }

  if (byNameRealm.length === 0) {
    return { actorId: null, matchCount: 0, reason: "NOT_FOUND" };
  }
  const unique = new Set(byNameRealm.map((m) => m.participantActorId));
  if (unique.size > 1) {
    return { actorId: null, matchCount: byNameRealm.length, reason: "AMBIGUOUS" };
  }
  return {
    actorId: byNameRealm[0]!.participantActorId,
    matchCount: byNameRealm.length,
    reason: "RESOLVED",
  };
}

/**
 * Resolve one validated participant input per real friendly player in the fight.
 */
export function resolveScoringFightRoster(
  input: ResolveScoringFightRosterInput,
): ResolveScoringFightRosterResult {
  const pkg = input.capabilityPackage;
  if (input.expectedSourceFight) {
    const expected = input.expectedSourceFight;
    if (
      pkg.sourceKey.reportCode !== expected.reportCode ||
      pkg.sourceKey.fightId !== expected.fightId ||
      pkg.sourceKey.reportRevision !== expected.reportRevision
    ) {
      return {
        ok: false,
        code: "RAW_PACKAGE_SOURCE_MISMATCH",
        message: "capability_package_source_key_mismatch",
        details: {
          packageSourceKey: pkg.sourceKey,
          expectedSourceFight: expected,
        },
      };
    }
  }

  const friendlyIds = pkg.friendlyPlayerActorIds;

  if (!Array.isArray(friendlyIds) || friendlyIds.length === 0) {
    return {
      ok: false,
      code: "RAW_PACKAGE_MISSING_FIGHT_ROSTER",
      message: "capability_package_missing_friendly_player_actor_ids",
    };
  }

  const seen = new Set<number>();
  for (const id of friendlyIds) {
    if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) {
      return {
        ok: false,
        code: "INVALID_PARTICIPANT_ACTOR_ID",
        message: `invalid_participant_actor_id:${String(id)}`,
        details: { actorId: id },
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        code: "DUPLICATE_FRIENDLY_ACTOR_IDS",
        message: `duplicate_friendly_actor_id:${id}`,
        details: { actorId: id },
      };
    }
    seen.add(id);
  }

  const actors = parseMasterActors(input.masterData);
  if (actors.size === 0) {
    return {
      ok: false,
      code: "RAW_PACKAGE_MISSING_FIGHT_ROSTER",
      message: "raw_payload_missing_master_data_actors",
    };
  }

  const combatantByActor = combatantEnrichment(input.combatantInfoEvents);
  const packagePetIds = new Set(
    (pkg.ownedPetActorIds ?? []).filter(
      (id): id is number => typeof id === "number" && id > 0,
    ),
  );
  const defaultRegion = durableSlug(input.regionCode)?.toUpperCase() ?? null;

  const skipped: Array<{ actorId: number; reason: string }> = [];
  const participants: ScoringFightRosterParticipant[] = [];

  const sortedFriendly = [...friendlyIds].sort((a, b) => a - b);
  for (const actorId of sortedFriendly) {
    const actor = actors.get(actorId);
    if (!actor) {
      return {
        ok: false,
        code: "FRIENDLY_ACTOR_ABSENT_FROM_MASTER_DATA",
        message: `friendly_actor_absent_from_master_data:${actorId}`,
        details: { actorId },
      };
    }
    if (actor.type !== "Player") {
      // friendlyPlayers must be players — pets/NPCs are malformed roster evidence.
      return {
        ok: false,
        code: "INVALID_PARTICIPANT_ACTOR_ID",
        message: `friendly_actor_not_player:${actorId}:${actor.type || "unknown"}`,
        details: { actorId, actorType: actor.type },
      };
    }
    if (!actor.name) {
      return {
        ok: false,
        code: "INVALID_PARTICIPANT_ACTOR_ID",
        message: `friendly_actor_missing_player_name:${actorId}`,
        details: { actorId },
      };
    }

    const combatant = combatantByActor.get(actorId);
    participants.push({
      participantActorId: actorId,
      characterId: null,
      characterName: actor.name,
      realmSlug: actor.server,
      regionCode: defaultRegion,
      classSlug: actor.classSlug,
      specSlug: combatant?.specSlug ?? null,
      role: combatant?.role ?? null,
      ownedPetActorIds: petsForOwner(actors, actorId, packagePetIds),
    });
  }

  if (participants.length === 0) {
    return {
      ok: false,
      code: "RAW_PACKAGE_MISSING_FIGHT_ROSTER",
      message: "no_usable_friendly_player_participants",
      details: { skipped },
    };
  }

  let targetActorId: number | null = null;
  if (input.target) {
    const resolved = resolveTargetActorId({
      players: participants,
      target: input.target,
    });
    if (resolved.reason === "CONFLICT") {
      if (input.requireTarget !== false) {
        return {
          ok: false,
          code: "TARGET_IDENTITY_CONFLICT",
          message: "target_actor_id_conflicts_with_name_realm_region",
          details: {
            targetActorId: input.target.targetActorId ?? null,
            matchCount: resolved.matchCount,
          },
        };
      }
      // requireTarget=false: never link on contradiction; still persist other participants.
    } else if (resolved.reason === "RESOLVED" && resolved.actorId != null) {
      targetActorId = resolved.actorId;
      for (const p of participants) {
        if (p.participantActorId !== targetActorId) continue;
        p.characterId = input.target.characterId;
        // Target context may fill optional blanks only for the matched participant.
        if (p.classSlug == null && input.target.classSlug) {
          p.classSlug = durableSlug(input.target.classSlug);
        }
        if (p.specSlug == null && input.target.specSlug) {
          p.specSlug = durableSlug(input.target.specSlug);
        }
        if (p.role == null && input.target.role) {
          p.role = normalizeRole(input.target.role);
        }
        if (p.realmSlug == null && input.target.realmSlug) {
          p.realmSlug = normalizeWclRealmSlug(input.target.realmSlug);
        }
        if (p.regionCode == null && input.target.regionCode) {
          p.regionCode = input.target.regionCode.toUpperCase();
        }
        // Prefer canonical display name from the requested Character.
        p.characterName = input.target.characterName;
      }
    } else if (input.requireTarget !== false) {
      return {
        ok: false,
        code: "TARGET_PARTICIPANT_NOT_FOUND",
        message: `target_participant_not_found:${resolved.reason.toLowerCase()}`,
        details: {
          matchCount: resolved.matchCount,
          reason: resolved.reason,
        },
      };
    }
  }

  return {
    ok: true,
    participants,
    skipped,
    targetActorId,
  };
}

/** Throw on failure; return participants on success. */
export function resolveScoringFightRosterOrThrow(
  input: ResolveScoringFightRosterInput,
): ResolveScoringFightRosterSuccess {
  const result = resolveScoringFightRoster(input);
  if (!result.ok) {
    throw new ScoringFightRosterError(result.code, result.message, result.details);
  }
  return result;
}

/** Map roster participants to orchestration participant shape. */
export function toOrchestrationParticipants(
  participants: readonly ScoringFightRosterParticipant[],
): Array<{
  playerActorId: number;
  characterName: string;
  realmSlug?: string;
  regionCode?: string;
  classSlug: string | null;
  specSlug: string | null;
  role?: string | null;
  ownedPetActorIds: number[];
  characterId?: string | null;
}> {
  return participants.map((p) => ({
    playerActorId: p.participantActorId,
    characterName: p.characterName,
    realmSlug: p.realmSlug ?? undefined,
    regionCode: p.regionCode ?? undefined,
    classSlug: p.classSlug,
    specSlug: p.specSlug,
    role: p.role,
    ownedPetActorIds: p.ownedPetActorIds,
    characterId: p.characterId,
  }));
}
