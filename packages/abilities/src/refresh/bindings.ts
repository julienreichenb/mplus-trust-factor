import type { AbilityRule } from "../types.js";
import type { AbilitySpellBindingCandidate, AbilitySpellBindingRole } from "./types.js";

const ROLE_ORDER: AbilitySpellBindingRole[] = [
  "PRIMARY_ACTIVATION",
  "CAST_ALIAS",
  "ACTIVATION_AURA",
  "STACK_AURA",
  "TRIGGERED_EFFECT",
  "SUMMON",
];

export function bindingRoleRank(role: AbilitySpellBindingRole): number {
  return ROLE_ORDER.indexOf(role);
}

/** Project current AbilityRule ID bags into typed bindings without mutating the rule. */
export function projectCurrentRuleBindings(rule: AbilityRule): AbilitySpellBindingCandidate[] {
  const out: AbilitySpellBindingCandidate[] = [];
  const push = (spellId: number, role: AbilitySpellBindingRole, evidence: string) => {
    if (!Number.isInteger(spellId) || spellId <= 0) return;
    out.push({
      spellId,
      role,
      source: "BLIZZARD",
      certainty: "supported",
      evidence: `current-catalog:${evidence}`,
    });
  };

  const primary = rule.spellIds[0];
  if (primary != null) push(primary, "PRIMARY_ACTIVATION", "spellIds[0]");
  for (const id of rule.spellIds.slice(1)) push(id, "CAST_ALIAS", "spellIds");
  for (const id of rule.aliases ?? []) push(id, "CAST_ALIAS", "aliases");
  for (const id of rule.activationSpellIds ?? []) {
    if (id !== primary) push(id, "CAST_ALIAS", "activationSpellIds");
  }
  for (const id of rule.activationBuffIds ?? []) push(id, "ACTIVATION_AURA", "activationBuffIds");
  for (const id of rule.triggeredEffectIds ?? []) push(id, "TRIGGERED_EFFECT", "triggeredEffectIds");
  return dedupeBindings(out);
}

export function dedupeBindings(
  bindings: AbilitySpellBindingCandidate[],
): AbilitySpellBindingCandidate[] {
  const seen = new Set<string>();
  const out: AbilitySpellBindingCandidate[] = [];
  for (const b of bindings) {
    const key = `${b.spellId}:${b.role}:${b.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out.sort((a, b) => a.spellId - b.spellId || bindingRoleRank(a.role) - bindingRoleRank(b.role));
}

export function rolesBySpellId(
  bindings: AbilitySpellBindingCandidate[],
): Map<number, AbilitySpellBindingRole[]> {
  const map = new Map<number, AbilitySpellBindingRole[]>();
  for (const b of bindings) {
    const list = map.get(b.spellId) ?? [];
    if (!list.includes(b.role)) list.push(b.role);
    map.set(b.spellId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => bindingRoleRank(a) - bindingRoleRank(b));
  }
  return map;
}

export function bindingIdSet(bindings: AbilitySpellBindingCandidate[]): Set<number> {
  return new Set(bindings.map((b) => b.spellId));
}

export function compareBindingRoles(
  current: AbilitySpellBindingCandidate[],
  candidate: AbilitySpellBindingCandidate[],
): Array<{
  spellId: number;
  currentRoles: AbilitySpellBindingRole[];
  candidateRoles: AbilitySpellBindingRole[];
}> {
  const a = rolesBySpellId(current);
  const b = rolesBySpellId(candidate);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const changes: Array<{
    spellId: number;
    currentRoles: AbilitySpellBindingRole[];
    candidateRoles: AbilitySpellBindingRole[];
  }> = [];
  for (const id of [...ids].sort((x, y) => x - y)) {
    const left = a.get(id) ?? [];
    const right = b.get(id) ?? [];
    if (left.join(",") !== right.join(",")) {
      changes.push({ spellId: id, currentRoles: left, candidateRoles: right });
    }
  }
  return changes;
}

