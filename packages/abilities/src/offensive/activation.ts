import { dimensionTagsForRule } from "../catalog/rule.js";
import { getAllRegisteredRules, ruleResolvableSpellIds } from "../registry.js";
import type {
  AbilityRule,
  ActivationEventType,
  ActivationSource,
} from "../types.js";

/** Minimal event shape for activation projection (digest-compatible). */
export interface OffensiveActivationEvent {
  eventId: string;
  timestampMs: number;
  eventType: string | null;
  spellId: number;
  canonicalKey: string | null;
  sourceOwnerPlayerActorId: number | null;
  sourceActorId: number | null;
  targetPlayerActorId?: number | null;
  sourceKind?: string | null;
  /** Optional WCL duration (ms) when present on the event. */
  durationMs?: number | null;
  /** Optional aura stack count when present. */
  stack?: number | null;
  /** Evidence dataset when known (Casts / Buffs). */
  dataset?: "Casts" | "Buffs" | null;
}

export interface CanonicalOffensiveActivation {
  activationId: string;
  canonicalKey: string;
  primarySpellId: number;
  timestampMs: number;
  sourceOwnerPlayerActorId: number | null;
  /** For EXTERNAL_OFFENSIVE — recipient player when known. */
  targetPlayerActorId: number | null;
  contributingEventIds: string[];
  contributingSpellIds: number[];
}

export type ActivationSignalDisposition = "OPEN" | "CORRELATE" | "DISCARD";

export interface OffensiveActivationProjection {
  rawRetainedEventCount: number;
  deduplicatedActivationCount: number;
  canonicalCooldownCount: number;
  activations: CanonicalOffensiveActivation[];
  byCanonicalKey: Record<string, number>;
}

/** Correlate related cast/buff/empower/trigger signals to an open activation. */
const DEFAULT_CORRELATE_WINDOW_MS = 1500;

const CORRELATE_EVENT_TYPES = new Set<string>([
  "begincast",
  "cast",
  "applybuff",
  "refreshbuff",
  "removebuff",
  "applydebuff",
  "refreshdebuff",
  "summon",
  "empowerstart",
  "empowerend",
]);

function ruleByKey(rules: AbilityRule[]): Map<string, AbilityRule> {
  return new Map(rules.map((r) => [r.canonicalKey, r]));
}

function spellIdsForRule(rule: AbilityRule): Set<number> {
  return new Set(ruleResolvableSpellIds(rule));
}

function activationSpellSet(rule: AbilityRule): Set<number> {
  return new Set([
    ...rule.spellIds,
    ...(rule.aliases ?? []),
    ...(rule.activationSpellIds ?? rule.spellIds),
    ...(rule.activationBuffIds ?? []),
  ]);
}

function normalizeType(eventType: string | null): string {
  return (eventType ?? "").toLowerCase();
}

function defaultOpeningTypes(source: ActivationSource): Set<string> {
  switch (source) {
    case "PLAYER_BUFF":
      return new Set(["applybuff"]);
    case "PLAYER_EMPOWERED_CAST":
      // Buff/empowerstart may precede the resolved cast by 1–2ms; refreshbuff never opens.
      // begincast correlates only — interrupted empowers must not count as uses.
      return new Set(["empowerstart", "cast", "empowerend", "applybuff"]);
    case "OWNED_ACTOR_CAST":
    case "ITEM_CAST":
    case "PLAYER_CAST":
    default:
      // Cast-primary: only the resolved cast (or near-simultaneous applybuff) opens.
      // begincast correlates when a cast follows; interrupted begincasts do not count.
      return new Set(["cast", "applybuff"]);
  }
}

/**
 * Event types that may open a new activation for this rule.
 * Explicit `activationEventTypes` further restrict the source defaults when set.
 */
export function openingEventTypesForRule(rule: AbilityRule): Set<string> {
  const source = rule.activationSource ?? "PLAYER_CAST";
  const defaults = defaultOpeningTypes(source);
  if (!rule.activationEventTypes || rule.activationEventTypes.length === 0) {
    return defaults;
  }
  const explicit = new Set(
    rule.activationEventTypes.map((t) => t.toLowerCase()),
  );
  const intersected = new Set(
    [...defaults].filter((t) => explicit.has(t)),
  );
  // If author listed only correlating types by mistake, fall back to defaults.
  return intersected.size > 0 ? intersected : defaults;
}

function resolvedTimestampRank(eventType: string): number {
  switch (eventType) {
    case "empowerend":
      return 40;
    case "cast":
      return 30;
    case "applybuff":
    case "summon":
      return 20;
    case "begincast":
    case "empowerstart":
      return 10;
    default:
      return 0;
  }
}

/**
 * Classify whether an event opens, correlates to, or is discarded for a rule.
 * Triggered child IDs never open. refresh/remove never open.
 */
export function classifyActivationSignal(input: {
  rule: AbilityRule;
  eventType: string | null;
  spellId: number;
}): ActivationSignalDisposition {
  const type = normalizeType(input.eventType);
  if (!type || !CORRELATE_EVENT_TYPES.has(type)) return "DISCARD";

  const activationIds = activationSpellSet(input.rule);
  const triggeredOnly =
    (input.rule.triggeredEffectIds ?? []).includes(input.spellId) &&
    !activationIds.has(input.spellId);

  if (triggeredOnly) return "CORRELATE";

  if (
    type === "refreshbuff" ||
    type === "removebuff" ||
    type === "refreshdebuff"
  ) {
    return "CORRELATE";
  }

  if (type === "empowerstart") return "CORRELATE";

  if (!activationIds.has(input.spellId)) {
    // Summon / owned-actor noise for IDs not on the rule — discard.
    return "DISCARD";
  }

  const opening = openingEventTypesForRule(input.rule);
  if (opening.has(type)) return "OPEN";

  // Participating non-opening signals (begincast, applybuff under cast-primary, etc.).
  const allowed: ActivationEventType[] =
    input.rule.activationEventTypes ??
    ([
      "begincast",
      "cast",
      "applybuff",
      "summon",
      "empowerstart",
      "empowerend",
    ] as ActivationEventType[]);
  if (allowed.map((t) => t.toLowerCase()).includes(type)) return "CORRELATE";
  if (CORRELATE_EVENT_TYPES.has(type)) return "CORRELATE";
  return "DISCARD";
}

export type ActivationGroupKeyMode = "OWNER" | "OWNER_OR_TARGET";

/**
 * Project retained timeline events into canonical activations for the given rules.
 *
 * Modes (from AbilityRule.activationSource + metadata):
 * - Cast-primary: player cast opens; begincast/buff/trigger correlate.
 * - Buff-primary: initial applybuff opens; refresh/remove correlate only.
 * - Empowered-cast: cast/empowerend open; empowerstart + buffs correlate;
 *   resolved timestamp prefers empowerend when present.
 * - Trigger-parent: triggeredEffectIds never open; attribute to parent window.
 * - activationEffectDurationMs: same-spell OPEN signals inside the effect
 *   window correlate as ticks (e.g. Abomination Limb pulse casts).
 *
 * `groupKeyMode`:
 * - OWNER — one open window per (owner, canonicalKey) (Performance default).
 * - OWNER_OR_TARGET — personal uses owner; external-style uses recipient target
 *   when present so two rapid externals on different allies do not merge.
 */
export function projectCanonicalActivations(input: {
  events: OffensiveActivationEvent[];
  rules: AbilityRule[];
  windowMs?: number;
  groupKeyMode?: ActivationGroupKeyMode;
}): OffensiveActivationProjection {
  const byKey = ruleByKey(input.rules);
  const windowMs = input.windowMs ?? DEFAULT_CORRELATE_WINDOW_MS;
  const groupKeyMode = input.groupKeyMode ?? "OWNER";

  const raw = [...input.events].sort((a, b) => a.timestampMs - b.timestampMs);
  const activations: CanonicalOffensiveActivation[] = [];

  type Open = {
    activation: CanonicalOffensiveActivation;
    /** Immutable window origin (first opening signal). */
    openedAtMs: number;
    resolvedEventType: string;
    relatedIds: Set<number>;
  };
  const openByOwnerKey = new Map<string, Open>();
  /** Orphan correlate signals (e.g. begincast) waiting for a following OPEN. */
  const pendingByOwnerKey = new Map<string, OffensiveActivationEvent[]>();

  const groupKeyFor = (event: OffensiveActivationEvent, rule: AbilityRule): string => {
    const ownerId = event.sourceOwnerPlayerActorId;
    if (groupKeyMode === "OWNER_OR_TARGET") {
      const tags = dimensionTagsForRule(rule);
      const external =
        rule.category === "EXTERNAL_DEFENSIVE" || tags.includes("UTILITY_EXTERNAL");
      if (external && event.targetPlayerActorId != null) {
        return `target:${event.targetPlayerActorId}:${event.canonicalKey}`;
      }
    }
    return `owner:${ownerId ?? "none"}:${event.canonicalKey}`;
  };

  for (const event of raw) {
    if (!event.canonicalKey) continue;
    const rule = byKey.get(event.canonicalKey);
    if (!rule) continue;

    const disposition = classifyActivationSignal({
      rule,
      eventType: event.eventType,
      spellId: event.spellId,
    });
    if (disposition === "DISCARD") continue;

    const type = normalizeType(event.eventType);
    const ownerId = event.sourceOwnerPlayerActorId;
    const groupKey = groupKeyFor(event, rule);
    const open = openByOwnerKey.get(groupKey);
    const relatedIds = spellIdsForRule(rule);
    const effectDurationMs = rule.activationEffectDurationMs ?? 0;
    const source = rule.activationSource ?? "PLAYER_CAST";
    // Empowered casts may resolve up to ~2.5s after cast/empowerstart; keep
    // that bound source-specific rather than raising the global correlate window.
    const effectiveCorrelateMs =
      source === "PLAYER_EMPOWERED_CAST" ? Math.max(windowMs, 3000) : windowMs;

    const withinCorrelateWindow =
      open != null &&
      event.timestampMs - open.openedAtMs <= effectiveCorrelateMs &&
      relatedIds.has(event.spellId);

    const withinEffectDuration =
      open != null &&
      effectDurationMs > 0 &&
      event.timestampMs - open.openedAtMs <= effectDurationMs &&
      relatedIds.has(event.spellId);

    const attachEvent = (target: Open, ev: OffensiveActivationEvent): void => {
      const evType = normalizeType(ev.eventType);
      target.activation.contributingEventIds.push(ev.eventId);
      target.activation.contributingSpellIds.push(ev.spellId);
      if (
        ev.targetPlayerActorId != null &&
        target.activation.targetPlayerActorId == null
      ) {
        target.activation.targetPlayerActorId = ev.targetPlayerActorId;
      }
      if (resolvedTimestampRank(evType) > resolvedTimestampRank(target.resolvedEventType)) {
        target.activation.timestampMs = ev.timestampMs;
        target.resolvedEventType = evType;
      }
    };

    if (disposition === "CORRELATE") {
      if (open && (withinCorrelateWindow || withinEffectDuration)) {
        attachEvent(open, event);
      } else if (relatedIds.has(event.spellId)) {
        const pending = pendingByOwnerKey.get(groupKey) ?? [];
        pending.push(event);
        pendingByOwnerKey.set(
          groupKey,
          pending.filter((p) => event.timestampMs - p.timestampMs <= effectiveCorrelateMs),
        );
      }
      continue;
    }

    // disposition === OPEN
    if (open && (withinCorrelateWindow || withinEffectDuration)) {
      // Same use: cast→buff, empower chain, or effect tick casts.
      attachEvent(open, event);
      continue;
    }

    const activation: CanonicalOffensiveActivation = {
      activationId: `${event.canonicalKey}:${event.timestampMs}:${event.eventId}`,
      canonicalKey: event.canonicalKey,
      primarySpellId: rule.spellIds[0] ?? event.spellId,
      timestampMs: event.timestampMs,
      sourceOwnerPlayerActorId: ownerId,
      targetPlayerActorId: event.targetPlayerActorId ?? null,
      contributingEventIds: [event.eventId],
      contributingSpellIds: [event.spellId],
    };
    const created: Open = {
      activation,
      openedAtMs: event.timestampMs,
      resolvedEventType: type,
      relatedIds,
    };
    // Attach preceding begincast / soft signals within the correlate window.
    const pending = pendingByOwnerKey.get(groupKey) ?? [];
    for (const prior of pending) {
      if (
        event.timestampMs - prior.timestampMs <= effectiveCorrelateMs &&
        relatedIds.has(prior.spellId)
      ) {
        // Prepend chronologically: rebuild contributing with prior first.
        activation.contributingEventIds.unshift(prior.eventId);
        activation.contributingSpellIds.unshift(prior.spellId);
        created.openedAtMs = Math.min(created.openedAtMs, prior.timestampMs);
        if (prior.targetPlayerActorId != null && activation.targetPlayerActorId == null) {
          activation.targetPlayerActorId = prior.targetPlayerActorId;
        }
      }
    }
    pendingByOwnerKey.delete(groupKey);
    activations.push(activation);
    openByOwnerKey.set(groupKey, created);
  }

  const byCanonicalKey: Record<string, number> = {};
  for (const a of activations) {
    byCanonicalKey[a.canonicalKey] = (byCanonicalKey[a.canonicalKey] ?? 0) + 1;
  }

  return {
    rawRetainedEventCount: raw.length,
    deduplicatedActivationCount: activations.length,
    canonicalCooldownCount: Object.keys(byCanonicalKey).length,
    activations,
    byCanonicalKey,
  };
}

/**
 * Project retained offensive timeline events into canonical cooldown activations.
 */
export function projectOffensiveActivations(input: {
  events: OffensiveActivationEvent[];
  rules?: AbilityRule[];
  windowMs?: number;
}): OffensiveActivationProjection {
  const rules = (input.rules ?? getAllRegisteredRules()).filter((r) =>
    dimensionTagsForRule(r).includes("PERFORMANCE_OFFENSIVE_COOLDOWN"),
  );
  return projectCanonicalActivations({
    events: input.events,
    rules,
    windowMs: input.windowMs,
    groupKeyMode: "OWNER",
  });
}
