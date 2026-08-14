/**
 * Scoring-neutral Survival active-heal events from compact HEALING evidence.
 */
import {
  getAllRegisteredRules,
  isSurvivalActiveHealRule,
  ruleResolvableSpellIds,
  type AbilityRule,
} from "@mplus/abilities";
import type {
  CapabilityCompactEvent,
  ParticipantSurvivalActiveHealingEventV1,
} from "@mplus/contracts";

function buildIndex(rules: AbilityRule[]): Map<number, AbilityRule[]> {
  const map = new Map<number, AbilityRule[]>();
  for (const rule of rules) {
    for (const id of ruleResolvableSpellIds(rule)) {
      const list = map.get(id) ?? [];
      list.push(rule);
      map.set(id, list);
    }
  }
  return map;
}

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * WCL Healing `amount` is the effective heal; `overheal` is stored separately.
 * Do not compute amount - overheal.
 */
export function effectiveHealAmount(amount: number | null): number | null {
  if (amount == null || amount < 0) return null;
  return amount;
}

export function extractSurvivalActiveHealingEvents(input: {
  compactEvents: readonly CapabilityCompactEvent[];
  participantActorId: number;
  friendlyPlayerActorIds: readonly number[];
  classSlug: string | null;
  specSlug: string | null;
}): ParticipantSurvivalActiveHealingEventV1[] {
  const index = buildIndex(getAllRegisteredRules());
  const party = new Set(input.friendlyPlayerActorIds);
  const out: ParticipantSurvivalActiveHealingEventV1[] = [];

  for (const event of input.compactEvents) {
    if (event.dataset !== "Healing") continue;
    const source = event.sourceOwnerPlayerActorId ?? event.sourceActorId;
    if (source !== input.participantActorId) continue;
    const spellId = event.spellId;
    if (spellId == null) continue;
    const rules = (index.get(spellId) ?? []).filter((rule) =>
      isSurvivalActiveHealRule(rule, input.classSlug, input.specSlug),
    );
    if (rules.length === 0) continue;

    const amount = asFinite(event.amount);
    const overheal = asFinite(event.overheal);
    const targetMaxHp = asFinite(event.maxHitPoints);
    const effectiveAmount = effectiveHealAmount(amount);
    const targetActorId = event.targetActorId;
    let targetRelation: ParticipantSurvivalActiveHealingEventV1["targetRelation"] = "EXCLUDED";
    if (targetActorId === input.participantActorId) {
      targetRelation = "SELF";
    } else if (targetActorId != null && party.has(targetActorId)) {
      targetRelation = "ALLY";
    }

    let evidenceQuality: ParticipantSurvivalActiveHealingEventV1["evidenceQuality"] = "EXCLUDED";
    let effectiveHealPctMaxHp: number | null = null;
    if (targetRelation !== "EXCLUDED" && effectiveAmount != null) {
      if (targetMaxHp != null && targetMaxHp > 0) {
        effectiveHealPctMaxHp = effectiveAmount / targetMaxHp;
        evidenceQuality = overheal == null ? "OVERHEAL_UNOBSERVABLE" : "FULL";
      } else {
        evidenceQuality = "MAX_HP_UNAVAILABLE";
      }
    }

    out.push({
      canonicalEventId: event.eventId,
      timestampMs: event.timestampMs,
      primarySpellId: spellId,
      canonicalKey: rules[0]?.canonicalKey ?? null,
      sourceActorId: source,
      targetActorId,
      targetRelation,
      amount,
      overheal,
      effectiveAmount,
      targetMaxHp,
      effectiveHealPctMaxHp,
      evidenceQuality,
    });
  }

  return out.sort(
    (a, b) => a.timestampMs - b.timestampMs || a.canonicalEventId.localeCompare(b.canonicalEventId),
  );
}
