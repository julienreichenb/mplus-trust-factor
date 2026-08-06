/**
 * Survival V2 Phase 2 — contextual defensive / recovery classification
 * and catalogue-backed cooldown availability (provider-free).
 */

import {
  getAbilityCatalog,
  rulesForCategory,
  type AbilityRule,
} from "@mplus/abilities";
import {
  SURVIVAL_V2_PHASE2,
  type SurvivalV2DefensiveResponseClass,
  type SurvivalV2RecoveryResponseClass,
} from "./constants.js";
import type {
  SurvivalV2DefensiveCategory,
  SurvivalV2ToolkitAvailabilityState,
  SurvivalV2ToolkitEntry,
} from "./types.js";

export interface SurvivalV2TimedActivation {
  id: string;
  timestampMs: number;
  abilityGameId: number;
  category: SurvivalV2DefensiveCategory | "SELF_HEAL" | "CONSUMABLE";
}

export interface SurvivalV2CatalogTool {
  spellId: number;
  category: SurvivalV2DefensiveCategory | "SELF_HEAL" | "CONSUMABLE";
  cooldownMs: number | null;
  charges: number;
  availability: "BASELINE" | "TALENT" | "OTHER";
  canonicalKey: string;
}

const DEFENSIVE_CATEGORIES = [
  "DEFENSIVE_MAJOR",
  "DEFENSIVE_MINOR",
  "IMMUNITY",
] as const satisfies readonly SurvivalV2DefensiveCategory[];

function ruleAvailability(
  rule: AbilityRule,
): SurvivalV2CatalogTool["availability"] {
  if (rule.availability === "BASELINE") return "BASELINE";
  if (rule.availability === "TALENT") return "TALENT";
  return "OTHER";
}

function toolsFromRules(
  rules: AbilityRule[],
  categories: ReadonlyArray<SurvivalV2DefensiveCategory | "SELF_HEAL" | "CONSUMABLE">,
): SurvivalV2CatalogTool[] {
  const out: SurvivalV2CatalogTool[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!categories.includes(rule.category as SurvivalV2CatalogTool["category"])) {
      continue;
    }
    const primary = rule.spellIds[0];
    if (primary == null) continue;
    const key = `${rule.canonicalKey}:${primary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      spellId: primary,
      category: rule.category as SurvivalV2CatalogTool["category"],
      cooldownMs:
        typeof rule.cooldownSeconds === "number" && rule.cooldownSeconds > 0
          ? rule.cooldownSeconds * 1000
          : null,
      charges:
        typeof rule.charges === "number" && rule.charges > 0 ? rule.charges : 1,
      availability: ruleAvailability(rule),
      canonicalKey: rule.canonicalKey,
    });
  }
  return out;
}

/** Resolve defensive + self-heal catalogue tools for a class/spec (fail closed). */
export function resolveSurvivalCatalogTools(input: {
  classSlug: string | null;
  specSlug: string | null;
}): {
  supported: boolean;
  defensiveTools: SurvivalV2CatalogTool[];
  selfHealTools: SurvivalV2CatalogTool[];
  toolkit: SurvivalV2ToolkitEntry[];
  unsupportedReason: string | null;
} {
  const catalog = getAbilityCatalog({
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    includeRacials: true,
  });
  if (!catalog.supported) {
    return {
      supported: false,
      defensiveTools: [],
      selfHealTools: [],
      toolkit: [],
      unsupportedReason: catalog.unsupportedReason ?? "ABILITY_CATALOG_UNSUPPORTED",
    };
  }

  const opts = { classSlug: input.classSlug, specSlug: input.specSlug };
  const defensiveRules = [
    ...rulesForCategory(catalog, "DEFENSIVE_MAJOR", opts),
    ...rulesForCategory(catalog, "DEFENSIVE_MINOR", opts),
    ...rulesForCategory(catalog, "IMMUNITY", opts),
  ];
  const selfHealRules = [
    ...rulesForCategory(catalog, "SELF_HEAL", opts),
    ...rulesForCategory(catalog, "CONSUMABLE", opts),
  ];

  const defensiveTools = toolsFromRules(defensiveRules, DEFENSIVE_CATEGORIES);
  const selfHealTools = toolsFromRules(selfHealRules, ["SELF_HEAL", "CONSUMABLE"]);

  const toolkit: SurvivalV2ToolkitEntry[] = [];
  const byCategory = new Map<
    SurvivalV2ToolkitEntry["category"],
    SurvivalV2ToolkitAvailabilityState
  >();

  for (const tool of [...defensiveTools, ...selfHealTools]) {
    let state: SurvivalV2ToolkitAvailabilityState;
    if (tool.availability === "TALENT" || tool.availability === "OTHER") {
      state = "UNKNOWN";
    } else {
      state = "AVAILABLE_CONFIRMED";
    }
    const prev = byCategory.get(tool.category);
    if (prev === "AVAILABLE_CONFIRMED") continue;
    if (prev === "UNKNOWN" && state === "AVAILABLE_CONFIRMED") {
      byCategory.set(tool.category, state);
    } else if (prev == null) {
      byCategory.set(tool.category, state);
    }
  }

  for (const [category, state] of byCategory) {
    toolkit.push({
      category,
      state,
      reason:
        state === "UNKNOWN"
          ? "talent_or_conditional_availability_unconfirmed"
          : null,
      spellIds: [...defensiveTools, ...selfHealTools]
        .filter((t) => t.category === category)
        .map((t) => t.spellId),
    });
  }

  return {
    supported: true,
    defensiveTools,
    selfHealTools,
    toolkit,
    unsupportedReason: null,
  };
}

/**
 * Whether a catalogue tool has a free charge at `atMs`.
 * Exact boundary: cooldown ending exactly at danger timestamp is AVAILABLE.
 */
export function toolAvailabilityAt(
  tool: SurvivalV2CatalogTool,
  activations: ReadonlyArray<Pick<SurvivalV2TimedActivation, "abilityGameId" | "timestampMs">>,
  atMs: number,
): "AVAILABLE" | "ON_COOLDOWN" | "UNKNOWN" {
  if (tool.availability === "TALENT" || tool.availability === "OTHER") {
    return "UNKNOWN";
  }
  if (tool.cooldownMs == null) return "UNKNOWN";

  const prior = activations
    .filter((a) => a.abilityGameId === tool.spellId && a.timestampMs <= atMs)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  let chargesOnCooldown = 0;
  for (const a of prior) {
    // Cooldown ending exactly at `atMs` is available again.
    if (a.timestampMs + tool.cooldownMs > atMs) {
      chargesOnCooldown += 1;
    }
  }
  return chargesOnCooldown >= tool.charges ? "ON_COOLDOWN" : "AVAILABLE";
}

export function anyPenalizableToolAvailable(input: {
  tools: SurvivalV2CatalogTool[];
  activations: ReadonlyArray<Pick<SurvivalV2TimedActivation, "abilityGameId" | "timestampMs">>;
  atMs: number;
}): {
  available: boolean;
  allUnknown: boolean;
  anyTool: boolean;
} {
  const baseline = input.tools.filter((t) => t.availability === "BASELINE");
  if (baseline.length === 0) {
    return { available: false, allUnknown: input.tools.length > 0, anyTool: false };
  }
  let anyAvailable = false;
  let allUnknown = true;
  for (const tool of baseline) {
    const state = toolAvailabilityAt(tool, input.activations, input.atMs);
    if (state !== "UNKNOWN") allUnknown = false;
    if (state === "AVAILABLE") anyAvailable = true;
  }
  return {
    available: anyAvailable,
    allUnknown,
    anyTool: true,
  };
}

export function classifyDefensiveResponse(input: {
  defensivesBefore: readonly string[];
  defensivesDuring: readonly string[];
  timingObservable: boolean;
  tools: SurvivalV2CatalogTool[];
  activations: ReadonlyArray<Pick<SurvivalV2TimedActivation, "abilityGameId" | "timestampMs">>;
  dangerStartMs: number;
}): SurvivalV2DefensiveResponseClass {
  if (!input.timingObservable) return "NOT_OBSERVABLE";
  if (input.defensivesBefore.length > 0) return "ANTICIPATED";
  if (input.defensivesDuring.length > 0) return "REACTIVE";

  const avail = anyPenalizableToolAvailable({
    tools: input.tools,
    activations: input.activations,
    atMs: input.dangerStartMs,
  });
  if (!avail.anyTool || avail.allUnknown) {
    return avail.anyTool ? "NOT_OBSERVABLE" : "NO_TOOL_AVAILABLE";
  }
  if (!avail.available) return "NO_TOOL_AVAILABLE";
  return "NO_RESPONSE_AVAILABLE";
}

export function classifyRecoveryResponse(input: {
  recoveryActivationIds: readonly string[];
  recoveryById: ReadonlyMap<string, SurvivalV2TimedActivation>;
  dangerEndMs: number;
  timingObservable: boolean;
  tools: SurvivalV2CatalogTool[];
  activations: ReadonlyArray<Pick<SurvivalV2TimedActivation, "abilityGameId" | "timestampMs">>;
}): SurvivalV2RecoveryResponseClass {
  if (!input.timingObservable) return "NOT_OBSERVABLE";

  if (input.recoveryActivationIds.length > 0) {
    let timely = false;
    let late = false;
    for (const id of input.recoveryActivationIds) {
      const act = input.recoveryById.get(id);
      if (!act) {
        timely = true;
        continue;
      }
      if (
        act.timestampMs <=
        input.dangerEndMs + SURVIVAL_V2_PHASE2.timelyRecoverySlackMs
      ) {
        timely = true;
      } else {
        late = true;
      }
    }
    if (timely) return "TIMELY_RECOVERY";
    if (late) return "LATE_RECOVERY";
    return "TIMELY_RECOVERY";
  }

  const avail = anyPenalizableToolAvailable({
    tools: input.tools,
    activations: input.activations,
    atMs: input.dangerEndMs,
  });
  if (!avail.anyTool || avail.allUnknown) {
    return avail.anyTool ? "NOT_OBSERVABLE" : "NO_SELF_HEAL_AVAILABLE";
  }
  if (!avail.available) return "NO_SELF_HEAL_AVAILABLE";
  return "NO_RECOVERY_AVAILABLE";
}

export function scoreDefensiveResponseClass(
  classification: SurvivalV2DefensiveResponseClass,
): number | null {
  const scores = SURVIVAL_V2_PHASE2.defensiveClassScores;
  switch (classification) {
    case "ANTICIPATED":
      return scores.ANTICIPATED;
    case "REACTIVE":
      return scores.REACTIVE;
    case "NO_RESPONSE_AVAILABLE":
      return scores.NO_RESPONSE_AVAILABLE;
    case "NO_TOOL_AVAILABLE":
    case "NOT_OBSERVABLE":
      return null;
    default:
      return null;
  }
}

export function scoreRecoveryResponseClass(
  classification: SurvivalV2RecoveryResponseClass,
): number | null {
  const scores = SURVIVAL_V2_PHASE2.recoveryClassScores;
  switch (classification) {
    case "TIMELY_RECOVERY":
      return scores.TIMELY_RECOVERY;
    case "LATE_RECOVERY":
      return scores.LATE_RECOVERY;
    case "NO_RECOVERY_AVAILABLE":
      return scores.NO_RECOVERY_AVAILABLE;
    case "NO_SELF_HEAL_AVAILABLE":
    case "NOT_OBSERVABLE":
      return null;
    default:
      return null;
  }
}
