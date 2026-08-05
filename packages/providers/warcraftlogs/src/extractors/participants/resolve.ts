/**
 * Shared participant class / spec / role resolution for canonical extractors.
 * Merges digest participant rows with CombatantInfo (Blizzard specID).
 */
import {
  findRetailSpecIdentityByBlizzardSpecId,
  normalizeRetailClassSlug,
  type AbilityRole,
} from "@mplus/abilities";
import { normalizeWclEventFields } from "../../normalize/wcl-event-normalizer.js";

export interface DigestParticipantLike {
  playerActorId: number;
  characterName: string;
  classSlug?: string | null;
  specSlug?: string | null;
  role?: AbilityRole | string | null;
  ownedPetActorIds?: number[] | readonly number[] | null;
}

export interface ResolvedFightParticipant {
  playerActorId: number;
  characterName: string;
  classSlug: string | null;
  specSlug: string | null;
  role: AbilityRole | null;
  blizzardSpecId: number | null;
  ownedPetActorIds: number[];
}

function parseOwnedPetActorIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is number => typeof id === "number");
}

/**
 * Resolve class slug, specialization slug/role, and pet ownership for fight participants.
 */
export function resolveFightParticipants(input: {
  participants: readonly DigestParticipantLike[];
  combatantInfoEvents: readonly Record<string, unknown>[];
}): ResolvedFightParticipant[] {
  const specByActor = new Map<
    number,
    NonNullable<ReturnType<typeof findRetailSpecIdentityByBlizzardSpecId>>
  >();
  const blizzardSpecIdByActor = new Map<number, number>();

  for (const row of input.combatantInfoEvents) {
    const fields = normalizeWclEventFields(row);
    const sourceId =
      fields.sourceActorId.value ??
      (typeof (row as { sourceID?: unknown }).sourceID === "number"
        ? (row as { sourceID: number }).sourceID
        : typeof (row as { source?: { id?: unknown } }).source?.id === "number"
          ? ((row as { source: { id: number } }).source.id)
          : null);
    const specId =
      typeof (row as { specID?: unknown }).specID === "number"
        ? (row as { specID: number }).specID
        : typeof (row as { specId?: unknown }).specId === "number"
          ? (row as { specId: number }).specId
          : null;
    if (sourceId == null || specId == null) continue;
    blizzardSpecIdByActor.set(sourceId, specId);
    const identity = findRetailSpecIdentityByBlizzardSpecId(specId);
    if (identity) specByActor.set(sourceId, identity);
  }

  return input.participants.map((participant) => {
    const fromCombatant = specByActor.get(participant.playerActorId) ?? null;
    const classSlug =
      normalizeRetailClassSlug(participant.classSlug) ??
      fromCombatant?.classSlug ??
      null;
    const specSlug = participant.specSlug ?? fromCombatant?.specSlug ?? null;
    const role =
      (participant.role as AbilityRole | null | undefined) ??
      fromCombatant?.role ??
      null;
    return {
      playerActorId: participant.playerActorId,
      characterName: participant.characterName,
      classSlug,
      specSlug,
      role,
      blizzardSpecId: blizzardSpecIdByActor.get(participant.playerActorId) ?? null,
      ownedPetActorIds: parseOwnedPetActorIds(participant.ownedPetActorIds),
    };
  });
}
