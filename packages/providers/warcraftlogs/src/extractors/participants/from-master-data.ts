/**
 * Resolve fight-scoped friendly players + owned pets from shared masterData / CombatantInfo.
 * Production helper — not part of the obsolete combat-digest prototype.
 */
import { normalizeWclEventFields } from "../../normalize/wcl-event-normalizer.js";
import type { WclRunEvidenceBundle } from "../../evidence/wcl-run-evidence-types.js";

export interface MasterDataParticipant {
  playerActorId: number;
  characterName: string;
  realmSlug: string;
  regionCode: string;
  classSlug: string | null;
  /** Raw Blizzard specialization ID when present on CombatantInfo. */
  blizzardSpecId: number | null;
  ownedPetActorIds: number[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function participantsFromBundleMasterData(
  bundle: Pick<WclRunEvidenceBundle, "masterData" | "eventDatasets">,
  regionCode: string,
): MasterDataParticipant[] {
  const root = asRecord(bundle.masterData);
  const actors = Array.isArray(root?.actors) ? root!.actors : [];
  const combatantEvents = bundle.eventDatasets.CombatantInfo?.events ?? [];
  const combatantByActor = new Map<number, Record<string, unknown>>();
  for (const raw of combatantEvents) {
    const fields = normalizeWclEventFields(raw);
    const actorId =
      fields.sourceActorId.value ??
      (typeof (raw as { sourceID?: unknown }).sourceID === "number"
        ? (raw as { sourceID: number }).sourceID
        : null);
    if (actorId == null) continue;
    combatantByActor.set(actorId, asRecord(raw) ?? {});
  }

  // masterData.actors is report-wide; CombatantInfo scopes the players in this fight.
  const fightPlayerIds =
    combatantByActor.size > 0 ? new Set(combatantByActor.keys()) : null;

  const out: MasterDataParticipant[] = [];
  for (const raw of actors) {
    const actor = asRecord(raw);
    if (!actor || actor.type !== "Player") continue;
    const id = typeof actor.id === "number" ? actor.id : null;
    const name = typeof actor.name === "string" ? actor.name.trim() : "";
    if (id == null || !name) continue;
    if (fightPlayerIds && !fightPlayerIds.has(id)) continue;
    const serverRaw =
      typeof actor.server === "string" && actor.server.trim()
        ? slugify(actor.server)
        : "unknown";
    const classSlug =
      typeof actor.subType === "string" && actor.subType.toLowerCase() !== "unknown"
        ? slugify(actor.subType)
        : typeof actor.className === "string"
          ? slugify(actor.className)
          : null;
    const ownedPetActorIds = actors
      .map((p) => asRecord(p))
      .filter(
        (p) =>
          p &&
          (p.type === "Pet" || p.type === "Guardian") &&
          typeof p.petOwner === "number" &&
          p.petOwner === id &&
          typeof p.id === "number",
      )
      .map((p) => (p as { id: number }).id);

    const combatant = combatantByActor.get(id);
    const blizzardSpecId =
      combatant && typeof combatant.specID === "number"
        ? combatant.specID
        : combatant && typeof combatant.specId === "number"
          ? combatant.specId
          : null;

    out.push({
      playerActorId: id,
      characterName: name,
      realmSlug: serverRaw.length > 0 ? serverRaw : "unknown",
      regionCode: regionCode.toUpperCase(),
      classSlug,
      blizzardSpecId,
      ownedPetActorIds,
    });
  }

  if (out.length === 0) {
    throw new Error("capability_acquisition_requires_fight_scoped_friendly_players");
  }
  if (out.length > 5) {
    out.sort((a, b) => a.playerActorId - b.playerActorId);
    return out.slice(0, 5);
  }
  return out;
}
