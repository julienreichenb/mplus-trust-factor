import type { AbilityCatalog, AbilityCategory, AbilityRule } from "@mplus/abilities";
import {
  rulesForCategory,
  rulesForSpell,
  spellIdsForCategory,
} from "@mplus/abilities";
import { equalWeightMean, median } from "./survival-calibration-logic.js";
import { asFiniteNumber } from "./survival-probe-logic.js";
import type {
  UtilityActorContext,
  UtilityCanonicalAbilityRef,
  UtilityCcEvent,
  UtilityDispelPurgeEvent,
  UtilityDispelPurgeOpportunity,
  UtilityDungeonAggregate,
  UtilityEventDataType,
  UtilityGlobalSummary,
  UtilityGroupUtilityEvent,
  UtilityInterruptEvent,
  UtilityInterruptOpportunity,
  UtilityNormalizedRun,
  UtilityPreservedEvent,
  UtilityRawEventDataset,
  UtilityRunSummary,
  UtilityUsefulnessClass,
} from "./utility-probe-types.js";

export { median, equalWeightMean } from "./survival-calibration-logic.js";

const GROUP_CATEGORIES = [
  "EXTERNAL_DEFENSIVE",
  "GROUP_UTILITY",
  "MOVEMENT_UTILITY",
  "BATTLE_REZ",
  "BLOODLUST",
] as const satisfies readonly AbilityCategory[];

const CLASS_SPECIFIC_KEY_FRAGMENTS = ["demonic-gateway", "soulstone"];

function asFinite(value: unknown): number | null {
  return asFiniteNumber(value);
}

export function preserveUtilityEvent(
  row: Record<string, unknown>,
  meta: { fightId: number; reportCode: string; actorCtx: UtilityActorContext },
): UtilityPreservedEvent {
  const ability = row.ability as Record<string, unknown> | undefined;
  const source = row.source as Record<string, unknown> | undefined;
  const target = row.target as Record<string, unknown> | undefined;
  const extraAbility = row.extraAbility as Record<string, unknown> | undefined;

  const abilityGameID =
    asFinite(row.abilityGameID) ??
    (ability ? asFinite(ability.guid) ?? asFinite(ability.abilityGameID) : null);

  const extraAbilityGameID =
    asFinite(row.extraAbilityGameID) ??
    (extraAbility
      ? asFinite(extraAbility.guid) ?? asFinite(extraAbility.abilityGameID)
      : null);

  const sourceID = asFinite(row.sourceID) ?? (source ? asFinite(source.id) : null);
  const targetID = asFinite(row.targetID) ?? (target ? asFinite(target.id) : null);

  const known = new Set([
    "timestamp",
    "sourceID",
    "targetID",
    "abilityGameID",
    "extraAbilityGameID",
    "type",
    "hitType",
    "ability",
    "source",
    "target",
    "extraAbility",
  ]);
  const additionalFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (known.has(key)) continue;
    additionalFields[key] = value;
  }
  if (ability) additionalFields.abilityExtras = { ...ability };
  if (source) additionalFields.sourceExtras = { ...source };
  if (target) additionalFields.targetExtras = { ...target };
  if (extraAbility) additionalFields.extraAbilityExtras = { ...extraAbility };

  return {
    timestamp: asFinite(row.timestamp),
    sourceID,
    targetID,
    abilityGameID,
    extraAbilityGameID,
    type: typeof row.type === "string" ? row.type : null,
    hitType: asFinite(row.hitType),
    fightId: meta.fightId,
    reportCode: meta.reportCode,
    actorOwnership: classifyActorOwnership(sourceID, meta.actorCtx),
    additionalFields,
    raw: { ...row },
  };
}

export function classifyActorOwnership(
  actorId: number | null,
  ctx: UtilityActorContext,
): UtilityPreservedEvent["actorOwnership"] {
  if (actorId == null) return "UNKNOWN";
  if (actorId === ctx.playerActorId) return "PLAYER";
  if (ctx.ownedPetActorIds.includes(actorId)) return "OWNED_PET";
  if (ctx.friendlyPlayerIds.includes(actorId)) return "OTHER_FRIENDLY";
  const actor = ctx.actorsById.get(actorId);
  if (!actor) return "UNKNOWN";
  if (actor.type === "Player") return "OTHER_FRIENDLY";
  if (actor.type === "Pet") {
    return actor.petOwner === ctx.playerActorId ? "OWNED_PET" : "UNKNOWN";
  }
  return "HOSTILE";
}

export function isHostileActor(actorId: number | null, ctx: UtilityActorContext): boolean {
  if (actorId == null) return false;
  if (ctx.hostileValidatedByDamage.has(actorId)) return true;
  if (classifyActorOwnership(actorId, ctx) === "HOSTILE") return true;
  const actor = ctx.actorsById.get(actorId);
  if (!actor) return true;
  return actor.type !== "Player" && actor.type !== "Pet";
}

export function isFriendlyActor(actorId: number | null, ctx: UtilityActorContext): boolean {
  if (actorId == null) return false;
  const ownership = classifyActorOwnership(actorId, ctx);
  return ownership === "PLAYER" || ownership === "OTHER_FRIENDLY" || ownership === "OWNED_PET";
}

export function isBossActor(actorId: number | null, ctx: UtilityActorContext): boolean | null {
  if (actorId == null) return null;
  const actor = ctx.actorsById.get(actorId);
  if (!actor) return null;
  const sub = (actor.subType ?? "").toLowerCase();
  if (sub.includes("boss")) return true;
  if (actor.type === "NPC" || actor.type === "Enemy") return false;
  return null;
}

export function attributedSourceIds(ctx: UtilityActorContext): Set<number> {
  return new Set([ctx.playerActorId, ...ctx.ownedPetActorIds]);
}

export function sourceKindFor(
  sourceId: number,
  ctx: UtilityActorContext,
): "PLAYER" | "OWNED_PET" {
  return sourceId === ctx.playerActorId ? "PLAYER" : "OWNED_PET";
}

export function resolveCanonicalAbility(
  catalog: AbilityCatalog,
  spellId: number,
  categories: AbilityCategory[],
  classSlug: string | null,
  specSlug: string | null,
): UtilityCanonicalAbilityRef | null {
  const rules = rulesForSpell(catalog, spellId).filter((r) => categories.includes(r.category));
  const filtered = rules.filter((r) => {
    if (r.classSlug != null && classSlug && r.classSlug !== classSlug) return false;
    if (r.specSlugs.length > 0 && specSlug && !r.specSlugs.includes(specSlug)) return false;
    return true;
  });
  const rule = filtered[0] ?? rules[0];
  if (!rule) return null;
  return {
    canonicalKey: rule.canonicalKey,
    name: rule.name,
    category: rule.category,
    spellId,
    sourceOwnership: rule.sourceOwnership,
    availability: rule.availability,
    cooldownSeconds: rule.cooldownSeconds ?? null,
    rule,
  };
}

function cooldownStateAt(
  timestamp: number,
  priorUses: number[],
  cooldownSeconds: number | null,
): "AVAILABLE" | "ON_COOLDOWN" | "UNKNOWN" {
  if (cooldownSeconds == null || cooldownSeconds <= 0) return "UNKNOWN";
  const cdMs = cooldownSeconds * 1000;
  const last = priorUses.filter((t) => t < timestamp).sort((a, b) => b - a)[0];
  if (last == null) return "AVAILABLE";
  return timestamp - last >= cdMs ? "AVAILABLE" : "ON_COOLDOWN";
}

export function utilityCooldownStateAt(
  timestamp: number,
  priorUses: number[],
  cooldownSeconds: number | null,
): "AVAILABLE" | "ON_COOLDOWN" | "UNKNOWN" {
  return cooldownStateAt(timestamp, priorUses, cooldownSeconds);
}

function eventType(row: Record<string, unknown>, preserved: UtilityPreservedEvent): string {
  if (preserved.type) return preserved.type.toLowerCase();
  const t = preserved.additionalFields.type;
  if (typeof t === "string") return t.toLowerCase();
  if (typeof row.type === "string") return row.type.toLowerCase();
  return "";
}

function interruptibleFlag(
  row: Record<string, unknown>,
  preserved: UtilityPreservedEvent,
): boolean | null {
  const candidates = [
    row.interruptible,
    preserved.additionalFields.interruptible,
    (preserved.additionalFields.abilityExtras as Record<string, unknown> | undefined)
      ?.interruptible,
  ];
  for (const c of candidates) {
    if (typeof c === "boolean") return c;
    if (c === 1 || c === "1" || c === "true") return true;
    if (c === 0 || c === "0" || c === "false") return false;
  }
  return null;
}

export function buildHostileValidatedByDamage(
  damageDoneEvents: Array<Record<string, unknown>>,
  ctx: Omit<UtilityActorContext, "hostileValidatedByDamage">,
  fightId: number,
  reportCode: string,
): Set<number> {
  const attributed = new Set([ctx.playerActorId, ...ctx.ownedPetActorIds]);
  const out = new Set<number>();
  const fullCtx: UtilityActorContext = { ...ctx, hostileValidatedByDamage: out };
  for (const row of damageDoneEvents) {
    const preserved = preserveUtilityEvent(row, { fightId, reportCode, actorCtx: fullCtx });
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (preserved.targetID == null) continue;
    if (isFriendlyActor(preserved.targetID, fullCtx)) continue;
    out.add(preserved.targetID);
  }
  return out;
}

export function analyzeInterrupts(input: {
  interrupts: Array<Record<string, unknown>>;
  casts: Array<Record<string, unknown>>;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  actorCtx: UtilityActorContext;
  fightId: number;
  reportCode: string;
}): {
  events: UtilityInterruptEvent[];
  opportunities: UtilityInterruptOpportunity[];
  unmatchedInterruptSpellIds: number[];
} {
  const interruptIds = spellIdsForCategory(input.catalog, "INTERRUPT", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const attributed = attributedSourceIds(input.actorCtx);
  const meta = {
    fightId: input.fightId,
    reportCode: input.reportCode,
    actorCtx: input.actorCtx,
  };

  const playerInterruptTimestamps: number[] = [];
  const events: UtilityInterruptEvent[] = [];
  const unmatchedInterruptSpellIds: number[] = [];
  const seenCastKeys = new Set<string>();

  const interruptRows = input.interrupts
    .map((row) => ({ preserved: preserveUtilityEvent(row, meta) }))
    .filter(({ preserved }) => preserved.sourceID != null && attributed.has(preserved.sourceID))
    .sort((a, b) => (a.preserved.timestamp ?? 0) - (b.preserved.timestamp ?? 0));

  for (const { preserved } of interruptRows) {
    if (preserved.timestamp == null || preserved.sourceID == null || preserved.abilityGameID == null) {
      continue;
    }
    const spellId = preserved.abilityGameID;
    const matched = interruptIds.has(spellId);
    if (!matched) unmatchedInterruptSpellIds.push(spellId);

    const canonical = matched
      ? resolveCanonicalAbility(
          input.catalog,
          spellId,
          ["INTERRUPT"],
          input.classSlug,
          input.specSlug,
        )
      : null;

    const castKey = `${preserved.targetID ?? "none"}:${preserved.extraAbilityGameID ?? "none"}:${Math.floor(preserved.timestamp / 500)}`;
    const repeatedOnSameCast = seenCastKeys.has(castKey);
    seenCastKeys.add(castKey);

    const cdState = cooldownStateAt(
      preserved.timestamp,
      playerInterruptTimestamps,
      canonical?.cooldownSeconds ?? null,
    );
    playerInterruptTimestamps.push(preserved.timestamp);

    events.push({
      timestamp: preserved.timestamp,
      sourceID: preserved.sourceID,
      targetID: preserved.targetID,
      abilityGameID: spellId,
      interruptedSpellId: preserved.extraAbilityGameID,
      sourceKind: sourceKindFor(preserved.sourceID, input.actorCtx),
      canonical,
      cooldownStateAtCast: cdState,
      repeatedOnSameCast,
      unmatchedSpellId: !matched,
      event: preserved,
    });
  }

  const allInterrupts = input.interrupts
    .map((row) => preserveUtilityEvent(row, meta))
    .filter((e) => e.timestamp != null)
    .sort((a, b) => a.timestamp! - b.timestamp!);

  const hostileCastWindows: Array<{
    start: number;
    end: number | null;
    sourceId: number;
    abilityGameId: number | null;
    interruptible: boolean | null;
    completed: boolean | null;
  }> = [];

  const beginByKey = new Map<
    string,
    {
      start: number;
      sourceId: number;
      abilityGameId: number | null;
      interruptible: boolean | null;
    }
  >();

  for (const row of input.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || preserved.timestamp == null) continue;
    if (!isHostileActor(preserved.sourceID, input.actorCtx)) continue;
    const typ = eventType(row, preserved);
    const key = `${preserved.sourceID}:${preserved.abilityGameID ?? "x"}`;
    const interruptible = interruptibleFlag(row, preserved);

    if (typ === "begincast" || typ === "caststart" || typ === "begin cast") {
      beginByKey.set(key, {
        start: preserved.timestamp,
        sourceId: preserved.sourceID,
        abilityGameId: preserved.abilityGameID,
        interruptible,
      });
      continue;
    }

    if (typ === "cast" || typ === "castsuccess" || typ === "") {
      const begin = beginByKey.get(key);
      if (begin) {
        hostileCastWindows.push({
          start: begin.start,
          end: preserved.timestamp,
          sourceId: begin.sourceId,
          abilityGameId: begin.abilityGameId,
          interruptible: begin.interruptible ?? interruptible,
          completed: true,
        });
        beginByKey.delete(key);
      } else if (interruptible === true) {
        hostileCastWindows.push({
          start: preserved.timestamp,
          end: preserved.timestamp,
          sourceId: preserved.sourceID,
          abilityGameId: preserved.abilityGameID,
          interruptible: true,
          completed: true,
        });
      }
      continue;
    }

    if (typ === "castfailed" || typ === "interrupted") {
      const begin = beginByKey.get(key);
      if (begin) {
        hostileCastWindows.push({
          start: begin.start,
          end: preserved.timestamp,
          sourceId: begin.sourceId,
          abilityGameId: begin.abilityGameId,
          interruptible: begin.interruptible ?? interruptible ?? true,
          completed: false,
        });
        beginByKey.delete(key);
      }
    }
  }

  for (const open of beginByKey.values()) {
    hostileCastWindows.push({
      start: open.start,
      end: null,
      sourceId: open.sourceId,
      abilityGameId: open.abilityGameId,
      interruptible: open.interruptible,
      completed: null,
    });
  }

  const kickRules = rulesForCategory(input.catalog, "INTERRUPT", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const kickCd = kickRules[0]?.cooldownSeconds ?? null;
  const opportunities: UtilityInterruptOpportunity[] = [];

  for (let i = 0; i < hostileCastWindows.length; i += 1) {
    const window = hostileCastWindows[i]!;
    const evidence: string[] = [];
    const unresolvedReasons: string[] = [];

    if (window.interruptible === null) {
      unresolvedReasons.push("interruptible_flag_absent");
    } else if (window.interruptible === false) {
      continue;
    } else {
      evidence.push("interruptible_flag_true");
    }

    if (window.end == null) unresolvedReasons.push("cast_end_unobserved");
    else evidence.push("cast_window_observed");

    const windowEnd = window.end ?? window.start + 3000;
    const interruptsInWindow = allInterrupts.filter(
      (ev) =>
        ev.timestamp != null &&
        ev.timestamp >= window.start &&
        ev.timestamp <= windowEnd + 50 &&
        (ev.targetID === window.sourceId || ev.targetID == null),
    );

    const playerInterrupt = interruptsInWindow.find(
      (ev) => ev.sourceID != null && attributed.has(ev.sourceID),
    );
    const otherInterrupt = interruptsInWindow.find(
      (ev) =>
        ev.sourceID != null &&
        !attributed.has(ev.sourceID) &&
        isFriendlyActor(ev.sourceID, input.actorCtx),
    );

    let playerAvailable: boolean | null = null;
    if (kickCd == null) {
      unresolvedReasons.push("kick_cooldown_unknown");
    } else {
      const priorPlayer = events.filter((e) => e.timestamp < window.start).map((e) => e.timestamp);
      const state = cooldownStateAt(window.start, priorPlayer, kickCd);
      playerAvailable = state === "AVAILABLE";
      evidence.push(`player_cooldown_state:${state}`);
    }

    let status: UtilityInterruptOpportunity["status"] = "CANDIDATE";
    if (
      otherInterrupt &&
      (!playerInterrupt || otherInterrupt.timestamp! < playerInterrupt.timestamp!)
    ) {
      status = "INVALIDATED_OTHER_INTERRUPTED_FIRST";
      evidence.push("other_party_member_interrupted_first");
    } else if (playerAvailable === false) {
      status = "PLAYER_ON_COOLDOWN";
    } else if (playerAvailable === true && (window.interruptible === true || playerInterrupt)) {
      status = "PLAYER_AVAILABLE";
    }

    if (window.interruptible !== true && !playerInterrupt) {
      unresolvedReasons.push("insufficient_hostile_cast_interruptibility_evidence");
      if (status === "CANDIDATE") status = "UNRESOLVED";
    }

    if (
      window.interruptible !== true &&
      !playerInterrupt &&
      !otherInterrupt &&
      unresolvedReasons.includes("interruptible_flag_absent")
    ) {
      if (window.completed !== false) continue;
    }

    opportunities.push({
      id: `${input.reportCode}:${input.fightId}:int-opp:${i}`,
      status,
      castStart: window.start,
      castEnd: window.end,
      castSourceId: window.sourceId,
      castAbilityGameId: window.abilityGameId,
      interruptibleEvidence: window.interruptible,
      successfulCastEvidence: window.completed,
      interruptedEvidence:
        Boolean(playerInterrupt || otherInterrupt) || window.completed === false,
      playerInterruptAvailable: playerAvailable,
      interruptedByOtherFirst:
        status === "INVALIDATED_OTHER_INTERRUPTED_FIRST" ? true : otherInterrupt ? false : null,
      playerInterruptTimestamp: playerInterrupt?.timestamp ?? null,
      otherInterruptTimestamp: otherInterrupt?.timestamp ?? null,
      unresolvedReasons,
      evidence,
    });
  }

  return {
    events,
    opportunities,
    unmatchedInterruptSpellIds: [...new Set(unmatchedInterruptSpellIds)].sort((a, b) => a - b),
  };
}

export function analyzeCrowdControl(input: {
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  debuffs: Array<Record<string, unknown>>;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  actorCtx: UtilityActorContext;
  fightId: number;
  reportCode: string;
  fightEndTime: number;
}): { events: UtilityCcEvent[]; unmatchedSpellIds: number[] } {
  const hardIds = spellIdsForCategory(input.catalog, "HARD_CC", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const softIds = spellIdsForCategory(input.catalog, "SOFT_CC", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const ccIds = new Set([...hardIds, ...softIds]);
  const attributed = attributedSourceIds(input.actorCtx);
  const meta = {
    fightId: input.fightId,
    reportCode: input.reportCode,
    actorCtx: input.actorCtx,
  };

  const auraRows = [...input.buffs, ...input.debuffs];
  const targetUseCounts = new Map<number, number>();
  const events: UtilityCcEvent[] = [];
  const unmatchedSpellIds: number[] = [];

  const castRows = input.casts
    .map((row) => ({ preserved: preserveUtilityEvent(row, meta) }))
    .filter(
      ({ preserved }) =>
        preserved.sourceID != null &&
        attributed.has(preserved.sourceID) &&
        preserved.abilityGameID != null &&
        preserved.timestamp != null,
    )
    .sort((a, b) => a.preserved.timestamp! - b.preserved.timestamp!);

  for (const { preserved } of castRows) {
    const spellId = preserved.abilityGameID!;
    const isHard = hardIds.has(spellId);
    const isSoft = softIds.has(spellId);
    if (!isHard && !isSoft) continue;

    const category: "HARD_CC" | "SOFT_CC" = isHard ? "HARD_CC" : "SOFT_CC";
    const canonical = resolveCanonicalAbility(
      input.catalog,
      spellId,
      [category],
      input.classSlug,
      input.specSlug,
    );
    const targetID = preserved.targetID;
    const hostile = isHostileActor(targetID, input.actorCtx);
    const boss = isBossActor(targetID, input.actorCtx);
    const nonBoss = boss === true ? false : boss === false ? true : null;

    const applyEvents = auraRows
      .map((r) => preserveUtilityEvent(r, meta))
      .filter(
        (a) =>
          a.abilityGameID === spellId &&
          a.targetID === targetID &&
          a.timestamp != null &&
          Math.abs(a.timestamp - preserved.timestamp!) < 2000 &&
          (eventType(a.raw, a).includes("apply") ||
            eventType(a.raw, a) === "" ||
            a.type == null),
      );
    const removeEvents = auraRows
      .map((r) => preserveUtilityEvent(r, meta))
      .filter(
        (a) =>
          a.abilityGameID === spellId &&
          a.targetID === targetID &&
          a.timestamp != null &&
          a.timestamp >= preserved.timestamp! &&
          eventType(a.raw, a).includes("remove"),
      )
      .sort((a, b) => a.timestamp! - b.timestamp!);

    const debuffApplied = applyEvents.length > 0 || hostile;
    const breakTs = removeEvents[0]?.timestamp ?? null;
    const durationMs =
      applyEvents[0]?.timestamp != null
        ? Math.max(0, (breakTs ?? input.fightEndTime) - applyEvents[0].timestamp)
        : null;

    const prior = targetID != null ? (targetUseCounts.get(targetID) ?? 0) : 0;
    if (targetID != null) targetUseCounts.set(targetID, prior + 1);

    events.push({
      timestamp: preserved.timestamp!,
      sourceID: preserved.sourceID!,
      targetID,
      abilityGameID: spellId,
      category,
      sourceKind: sourceKindFor(preserved.sourceID!, input.actorCtx),
      canonical,
      hostileTarget: hostile,
      nonBossTarget: nonBoss,
      debuffApplied,
      durationMs,
      breakOrRemovalTimestamp: breakTs,
      repeatedOnSameTarget: prior > 0,
      unmatchedSpellId: false,
      usefulnessClassification: null,
      usefulnessNote:
        "Usefulness left null — hostile-cast-stopped evidence is insufficient for standalone scoring.",
      event: preserved,
    });
  }

  for (const row of auraRows) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.abilityGameID == null) continue;
    if (ccIds.has(preserved.abilityGameID)) continue;
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (!isHostileActor(preserved.targetID, input.actorCtx)) continue;
    if (rulesForSpell(input.catalog, preserved.abilityGameID).length === 0) {
      unmatchedSpellIds.push(preserved.abilityGameID);
    }
  }

  return { events, unmatchedSpellIds: [...new Set(unmatchedSpellIds)].sort((a, b) => a - b) };
}

export function analyzeDispelsAndPurges(input: {
  dispels: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  debuffs: Array<Record<string, unknown>>;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  actorCtx: UtilityActorContext;
  fightId: number;
  reportCode: string;
}): {
  events: UtilityDispelPurgeEvent[];
  opportunities: UtilityDispelPurgeOpportunity[];
  unmatchedSpellIds: number[];
} {
  const dispelIds = spellIdsForCategory(input.catalog, "DISPEL", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const purgeIds = spellIdsForCategory(input.catalog, "PURGE", {
    classSlug: input.classSlug,
    specSlug: input.specSlug,
  });
  const attributed = attributedSourceIds(input.actorCtx);
  const meta = {
    fightId: input.fightId,
    reportCode: input.reportCode,
    actorCtx: input.actorCtx,
  };

  const priorBySpell = new Map<number, number[]>();
  const events: UtilityDispelPurgeEvent[] = [];
  const unmatchedSpellIds: number[] = [];

  const rows = input.dispels
    .map((row) => ({ preserved: preserveUtilityEvent(row, meta) }))
    .filter(({ preserved }) => preserved.sourceID != null && attributed.has(preserved.sourceID))
    .sort((a, b) => (a.preserved.timestamp ?? 0) - (b.preserved.timestamp ?? 0));

  for (const { preserved } of rows) {
    if (preserved.timestamp == null || preserved.sourceID == null || preserved.abilityGameID == null) {
      continue;
    }
    const spellId = preserved.abilityGameID;
    const isDispel = dispelIds.has(spellId);
    const isPurge = purgeIds.has(spellId);
    const matched = isDispel || isPurge;
    if (!matched) unmatchedSpellIds.push(spellId);

    const kind: "DISPEL" | "PURGE" = isPurge ? "PURGE" : "DISPEL";
    const canonical = matched
      ? resolveCanonicalAbility(input.catalog, spellId, [kind], input.classSlug, input.specSlug)
      : null;

    let targetSide: UtilityDispelPurgeEvent["targetSide"] = "UNKNOWN";
    if (isFriendlyActor(preserved.targetID, input.actorCtx)) targetSide = "FRIENDLY";
    else if (isHostileActor(preserved.targetID, input.actorCtx)) targetSide = "HOSTILE";

    const prior = priorBySpell.get(spellId) ?? [];
    const cdState = cooldownStateAt(preserved.timestamp, prior, canonical?.cooldownSeconds ?? null);
    prior.push(preserved.timestamp);
    priorBySpell.set(spellId, prior);

    events.push({
      timestamp: preserved.timestamp,
      sourceID: preserved.sourceID,
      targetID: preserved.targetID,
      abilityGameID: spellId,
      removedSpellId: preserved.extraAbilityGameID,
      kind,
      targetSide,
      sourceKind: sourceKindFor(preserved.sourceID, input.actorCtx),
      canonical,
      cooldownStateAtCast: cdState,
      unmatchedSpellId: !matched,
      event: preserved,
    });
  }

  const opportunities: UtilityDispelPurgeOpportunity[] = [];
  const auraEvents = [...input.debuffs, ...input.buffs].map((row) =>
    preserveUtilityEvent(row, meta),
  );

  for (let i = 0; i < input.debuffs.length; i += 1) {
    const aura = preserveUtilityEvent(input.debuffs[i]!, meta);
    if (aura.timestamp == null || aura.abilityGameID == null || aura.targetID == null) continue;
    const typ = eventType(aura.raw, aura);
    if (!typ.includes("apply") && typ !== "") continue;
    if (!isFriendlyActor(aura.targetID, input.actorCtx)) continue;

    const remove = auraEvents.find(
      (a) =>
        a.abilityGameID === aura.abilityGameID &&
        a.targetID === aura.targetID &&
        a.timestamp != null &&
        a.timestamp > aura.timestamp! &&
        eventType(a.raw, a).includes("remove"),
    );
    const reactionWindowMs = remove?.timestamp != null ? remove.timestamp - aura.timestamp : null;
    const playerDispel = events.find(
      (e) =>
        e.kind === "DISPEL" &&
        e.targetID === aura.targetID &&
        e.timestamp >= aura.timestamp! &&
        (remove?.timestamp == null || e.timestamp <= remove.timestamp + 50),
    );
    const unresolved: string[] = [];
    if (dispelIds.size === 0) unresolved.push("no_dispel_toolkit");
    if (reactionWindowMs != null && reactionWindowMs < 200) {
      unresolved.push("debuff_too_short_to_react");
    }
    if (!playerDispel && dispelIds.size > 0) {
      unresolved.push("player_dispel_not_observed_on_this_aura");
    }

    opportunities.push({
      id: `${input.reportCode}:${input.fightId}:dispel-opp:${i}`,
      kind: "DISPEL",
      status: "RAW_EVIDENCE_ONLY",
      auraAbilityGameId: aura.abilityGameID,
      auraTargetId: aura.targetID,
      auraApplyTimestamp: aura.timestamp,
      reactionWindowMs,
      playerAbilityAvailable: playerDispel
        ? playerDispel.cooldownStateAtCast === "AVAILABLE"
        : null,
      removedByPlayer: playerDispel != null,
      removedByOther: remove != null && !playerDispel,
      unresolvedReasons: unresolved,
      evidence: [
        "friendly_debuff_apply_observed",
        reactionWindowMs != null ? `reaction_window_ms:${reactionWindowMs}` : "removal_unobserved",
        playerDispel ? "player_dispel_matched" : "player_dispel_absent",
      ],
    });
  }

  for (let i = 0; i < input.buffs.length; i += 1) {
    const aura = preserveUtilityEvent(input.buffs[i]!, meta);
    if (aura.timestamp == null || aura.abilityGameID == null || aura.targetID == null) continue;
    if (!isHostileActor(aura.targetID, input.actorCtx)) continue;
    const typ = eventType(aura.raw, aura);
    if (!typ.includes("apply") && typ !== "") continue;

    const remove = auraEvents.find(
      (a) =>
        a.abilityGameID === aura.abilityGameID &&
        a.targetID === aura.targetID &&
        a.timestamp != null &&
        a.timestamp > aura.timestamp! &&
        eventType(a.raw, a).includes("remove"),
    );
    const playerPurge = events.find(
      (e) =>
        e.kind === "PURGE" &&
        e.targetID === aura.targetID &&
        e.timestamp >= aura.timestamp! &&
        (remove?.timestamp == null || e.timestamp <= remove.timestamp + 50),
    );

    opportunities.push({
      id: `${input.reportCode}:${input.fightId}:purge-opp:${i}`,
      kind: "PURGE",
      status: "RAW_EVIDENCE_ONLY",
      auraAbilityGameId: aura.abilityGameID,
      auraTargetId: aura.targetID,
      auraApplyTimestamp: aura.timestamp,
      reactionWindowMs: remove?.timestamp != null ? remove.timestamp - aura.timestamp : null,
      playerAbilityAvailable: playerPurge
        ? playerPurge.cooldownStateAtCast === "AVAILABLE"
        : null,
      removedByPlayer: playerPurge != null,
      removedByOther: remove != null && !playerPurge,
      unresolvedReasons:
        purgeIds.size === 0
          ? ["no_purge_toolkit"]
          : playerPurge
            ? []
            : ["purgeable_certainty_unvalidated", "player_purge_not_observed"],
      evidence: [
        "hostile_buff_apply_observed",
        playerPurge ? "player_purge_matched" : "player_purge_absent",
        "purgeable_flag_not_exposed_by_wcl",
      ],
    });
  }

  return {
    events,
    opportunities,
    unmatchedSpellIds: [...new Set(unmatchedSpellIds)].sort((a, b) => a - b),
  };
}

function classifyGroupUtilityUse(input: {
  category: AbilityCategory;
  targetID: number | null;
  successfulApplication: boolean | null;
  targetDeathNearby: boolean | null;
  battleRezResult: UtilityGroupUtilityEvent["battleRezResult"];
  actorCtx: UtilityActorContext;
}): { classification: UtilityUsefulnessClass; evidence: string[] } {
  const evidence: string[] = [];
  const { category } = input;

  if (category === "BATTLE_REZ") {
    if (input.battleRezResult === "REVIVED") {
      evidence.push("battle_rez_target_revived");
      return { classification: "CONFIRMED_USEFUL", evidence };
    }
    if (input.battleRezResult === "FAILED") {
      evidence.push("battle_rez_failed_or_no_revive_observed");
      return { classification: "RAW_USE_ONLY", evidence };
    }
    evidence.push("battle_rez_result_unknown");
    return { classification: "UNRESOLVED", evidence };
  }

  if (category === "EXTERNAL_DEFENSIVE") {
    if (
      input.targetID != null &&
      isFriendlyActor(input.targetID, input.actorCtx) &&
      input.targetID !== input.actorCtx.playerActorId
    ) {
      evidence.push("external_applied_to_ally");
      if (input.successfulApplication) evidence.push("buff_application_confirmed");
      if (input.targetDeathNearby) {
        evidence.push("target_death_nearby_pressure_context");
        return { classification: "POSSIBLY_USEFUL", evidence };
      }
      return {
        classification: input.successfulApplication ? "POSSIBLY_USEFUL" : "RAW_USE_ONLY",
        evidence,
      };
    }
    if (input.targetID === input.actorCtx.playerActorId) {
      evidence.push("self_cast_not_external");
      return { classification: "NOT_APPLICABLE", evidence };
    }
    evidence.push("external_target_unconfirmed");
    return { classification: "UNRESOLVED", evidence };
  }

  if (category === "GROUP_UTILITY" || category === "MOVEMENT_UTILITY" || category === "BLOODLUST") {
    evidence.push("cast_observed");
    if (input.successfulApplication) {
      evidence.push("buff_or_placeable_application_observed");
      return { classification: "POSSIBLY_USEFUL", evidence };
    }
    evidence.push("value_not_inferable_from_cast_alone");
    return { classification: "RAW_USE_ONLY", evidence };
  }

  evidence.push("category_not_classified");
  return { classification: "UNRESOLVED", evidence };
}

export function analyzeGroupUtility(input: {
  casts: Array<Record<string, unknown>>;
  buffs: Array<Record<string, unknown>>;
  deaths: Array<Record<string, unknown>>;
  catalog: AbilityCatalog;
  classSlug: string | null;
  specSlug: string | null;
  actorCtx: UtilityActorContext;
  fightId: number;
  reportCode: string;
}): {
  externalGroupEvents: UtilityGroupUtilityEvent[];
  classSpecificEvents: UtilityGroupUtilityEvent[];
  unmatchedSpellIds: number[];
} {
  const categorySets = {
    EXTERNAL_DEFENSIVE: spellIdsForCategory(input.catalog, "EXTERNAL_DEFENSIVE", {
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    }),
    GROUP_UTILITY: spellIdsForCategory(input.catalog, "GROUP_UTILITY", {
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    }),
    MOVEMENT_UTILITY: spellIdsForCategory(input.catalog, "MOVEMENT_UTILITY", {
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    }),
    BATTLE_REZ: spellIdsForCategory(input.catalog, "BATTLE_REZ", {
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    }),
    BLOODLUST: spellIdsForCategory(input.catalog, "BLOODLUST", {
      classSlug: input.classSlug,
      specSlug: input.specSlug,
    }),
  };

  const allIds = new Set(GROUP_CATEGORIES.flatMap((c) => [...categorySets[c]]));
  const attributed = attributedSourceIds(input.actorCtx);
  const meta = {
    fightId: input.fightId,
    reportCode: input.reportCode,
    actorCtx: input.actorCtx,
  };

  const deathTsByTarget = new Map<number, number[]>();
  for (const row of input.deaths) {
    const preserved = preserveUtilityEvent(row, meta);
    const died = preserved.targetID ?? preserved.sourceID;
    if (died == null || preserved.timestamp == null) continue;
    const list = deathTsByTarget.get(died) ?? [];
    list.push(preserved.timestamp);
    deathTsByTarget.set(died, list);
  }

  const events: UtilityGroupUtilityEvent[] = [];

  for (const row of input.casts) {
    const preserved = preserveUtilityEvent(row, meta);
    if (preserved.sourceID == null || !attributed.has(preserved.sourceID)) continue;
    if (preserved.abilityGameID == null || preserved.timestamp == null) continue;
    const spellId = preserved.abilityGameID;
    if (!allIds.has(spellId)) continue;

    let category: (typeof GROUP_CATEGORIES)[number] | null = null;
    for (const cat of GROUP_CATEGORIES) {
      if (categorySets[cat].has(spellId)) {
        category = cat;
        break;
      }
    }
    if (!category) continue;

    const canonical = resolveCanonicalAbility(
      input.catalog,
      spellId,
      [category],
      input.classSlug,
      input.specSlug,
    );

    const buffApply = input.buffs
      .map((r) => preserveUtilityEvent(r, meta))
      .find(
        (b) =>
          b.abilityGameID === spellId &&
          b.timestamp != null &&
          Math.abs(b.timestamp - preserved.timestamp!) < 2000 &&
          (b.targetID === preserved.targetID || preserved.targetID == null),
      );

    let battleRezResult: UtilityGroupUtilityEvent["battleRezResult"] = null;
    if (category === "BATTLE_REZ") {
      const target = preserved.targetID;
      if (target == null) battleRezResult = "UNKNOWN";
      else {
        const deaths = deathTsByTarget.get(target) ?? [];
        const diedBefore = deaths.some(
          (t) => t <= preserved.timestamp! && preserved.timestamp! - t < 120_000,
        );
        if (!diedBefore) battleRezResult = "UNKNOWN";
        else if (buffApply) battleRezResult = "REVIVED";
        else battleRezResult = "FAILED";
      }
    }

    const targetDeathNearby =
      preserved.targetID != null
        ? (deathTsByTarget.get(preserved.targetID) ?? []).some(
            (t) => Math.abs(t - preserved.timestamp!) < 15_000,
          )
        : null;

    const { classification, evidence } = classifyGroupUtilityUse({
      category,
      targetID: preserved.targetID,
      successfulApplication: buffApply != null ? true : null,
      targetDeathNearby,
      battleRezResult,
      actorCtx: input.actorCtx,
    });

    events.push({
      timestamp: preserved.timestamp,
      sourceID: preserved.sourceID,
      targetID: preserved.targetID,
      abilityGameID: spellId,
      category,
      sourceKind: sourceKindFor(preserved.sourceID, input.actorCtx),
      canonical,
      successfulApplication: buffApply != null ? true : null,
      targetDeathNearby,
      battleRezResult,
      classification,
      evidence,
      unmatchedSpellId: false,
      event: preserved,
    });
  }

  const classSpecificEvents = events.filter((e) =>
    CLASS_SPECIFIC_KEY_FRAGMENTS.some((k) => e.canonical?.canonicalKey.includes(k)),
  );
  const externalGroupEvents = events.filter(
    (e) => !CLASS_SPECIFIC_KEY_FRAGMENTS.some((k) => e.canonical?.canonicalKey.includes(k)),
  );

  return { externalGroupEvents, classSpecificEvents, unmatchedSpellIds: [] };
}

export function normalizeUtilityRun(input: {
  reportCode: string;
  fightId: number;
  dungeonSlug: string;
  keyLevel: number | null;
  durationMs: number;
  specialization: string | null;
  classSlug: string | null;
  specSlug: string | null;
  catalog: AbilityCatalog;
  actorCtx: UtilityActorContext;
  eventDatasets: Record<UtilityEventDataType, UtilityRawEventDataset>;
  fightEndTime: number;
}): UtilityNormalizedRun {
  const ds = input.eventDatasets;
  const incompleteDatasets = (Object.keys(ds) as UtilityEventDataType[]).filter(
    (t) => ds[t].state !== "OK",
  );
  const truncatedDatasets = (Object.keys(ds) as UtilityEventDataType[]).filter(
    (t) => ds[t].truncated,
  );
  const datasetStates = Object.fromEntries(
    (Object.keys(ds) as UtilityEventDataType[]).map((t) => [t, ds[t].state]),
  ) as Record<UtilityEventDataType, UtilityRawEventDataset["state"]>;

  const interrupts = analyzeInterrupts({
    interrupts: ds.Interrupts.events,
    casts: ds.Casts.events,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    actorCtx: input.actorCtx,
    fightId: input.fightId,
    reportCode: input.reportCode,
  });
  const cc = analyzeCrowdControl({
    casts: ds.Casts.events,
    buffs: ds.Buffs.events,
    debuffs: ds.Debuffs.events,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    actorCtx: input.actorCtx,
    fightId: input.fightId,
    reportCode: input.reportCode,
    fightEndTime: input.fightEndTime,
  });
  const dispels = analyzeDispelsAndPurges({
    dispels: ds.Dispels.events,
    buffs: ds.Buffs.events,
    debuffs: ds.Debuffs.events,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    actorCtx: input.actorCtx,
    fightId: input.fightId,
    reportCode: input.reportCode,
  });
  const group = analyzeGroupUtility({
    casts: ds.Casts.events,
    buffs: ds.Buffs.events,
    deaths: ds.Deaths.events,
    catalog: input.catalog,
    classSlug: input.classSlug,
    specSlug: input.specSlug,
    actorCtx: input.actorCtx,
    fightId: input.fightId,
    reportCode: input.reportCode,
  });

  const unmatchedAbilityIds = [
    ...new Set([
      ...interrupts.unmatchedInterruptSpellIds,
      ...cc.unmatchedSpellIds,
      ...dispels.unmatchedSpellIds,
      ...group.unmatchedSpellIds,
    ]),
  ].sort((a, b) => a - b);

  return {
    reportCode: input.reportCode,
    fightId: input.fightId,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    durationMs: input.durationMs,
    playerActorId: input.actorCtx.playerActorId,
    petActorIds: [...input.actorCtx.ownedPetActorIds],
    specialization: input.specialization,
    classSlug: input.classSlug,
    interruptEvents: interrupts.events,
    ccEvents: cc.events,
    dispelPurgeEvents: dispels.events,
    externalGroupUtilityEvents: group.externalGroupEvents,
    classSpecificEvents: group.classSpecificEvents,
    interruptOpportunities: interrupts.opportunities,
    dispelPurgeOpportunities: dispels.opportunities,
    unmatchedAbilityIds,
    incompleteDatasets,
    datasetStates,
    truncatedDatasets,
  };
}

export function summarizeUtilityRun(normalized: UtilityNormalizedRun): UtilityRunSummary {
  return {
    runId: `${normalized.reportCode}:${normalized.fightId}`,
    reportCode: normalized.reportCode,
    fightId: normalized.fightId,
    dungeonSlug: normalized.dungeonSlug,
    keyLevel: normalized.keyLevel,
    durationMs: normalized.durationMs,
    playerActorId: normalized.playerActorId,
    petActorIds: normalized.petActorIds,
    specialization: normalized.specialization,
    successfulInterrupts: normalized.interruptEvents.length,
    interruptOpportunityCandidates: normalized.interruptOpportunities.length,
    interruptOpportunitiesPlayerAvailable: normalized.interruptOpportunities.filter(
      (o) => o.status === "PLAYER_AVAILABLE",
    ).length,
    interruptOpportunitiesInvalidatedOtherFirst: normalized.interruptOpportunities.filter(
      (o) => o.status === "INVALIDATED_OTHER_INTERRUPTED_FIRST",
    ).length,
    interruptOpportunitiesUnresolved: normalized.interruptOpportunities.filter(
      (o) => o.status === "UNRESOLVED" || o.unresolvedReasons.length > 0,
    ).length,
    ccUses: normalized.ccEvents.length,
    hardCcUses: normalized.ccEvents.filter((e) => e.category === "HARD_CC").length,
    softCcUses: normalized.ccEvents.filter((e) => e.category === "SOFT_CC").length,
    dispels: normalized.dispelPurgeEvents.filter((e) => e.kind === "DISPEL").length,
    purges: normalized.dispelPurgeEvents.filter((e) => e.kind === "PURGE").length,
    externalGroupUtilityUses: normalized.externalGroupUtilityEvents.length,
    classSpecificUses: normalized.classSpecificEvents.length,
    unmatchedAbilityIds: normalized.unmatchedAbilityIds,
    incompleteDatasets: normalized.incompleteDatasets,
    normalized,
  };
}

export function aggregateUtilityDungeon(
  dungeonSlug: string,
  runs: UtilityRunSummary[],
): UtilityDungeonAggregate {
  return {
    dungeonSlug,
    runCount: runs.length,
    runIds: runs.map((r) => r.runId),
    successfulInterruptsMedian: median(runs.map((r) => r.successfulInterrupts)),
    interruptOpportunityCandidatesMedian: median(
      runs.map((r) => r.interruptOpportunityCandidates),
    ),
    ccUsesMedian: median(runs.map((r) => r.ccUses)),
    dispelsPurgesMedian: median(runs.map((r) => r.dispels + r.purges)),
    externalGroupUtilityMedian: median(runs.map((r) => r.externalGroupUtilityUses)),
    classSpecificMedian: median(runs.map((r) => r.classSpecificUses)),
    unmatchedAbilityIdCount: new Set(runs.flatMap((r) => r.unmatchedAbilityIds)).size,
  };
}

export function buildUtilityGlobalSummary(
  perDungeon: UtilityDungeonAggregate[],
  expectedDungeonSlugs: string[],
): UtilityGlobalSummary {
  const withRuns = perDungeon.filter((d) => d.runCount > 0);
  const sampleSizeByDungeon: Record<string, number> = {};
  for (const slug of expectedDungeonSlugs) {
    sampleSizeByDungeon[slug] = perDungeon.find((d) => d.dungeonSlug === slug)?.runCount ?? 0;
  }
  const missing = expectedDungeonSlugs.filter((s) => (sampleSizeByDungeon[s] ?? 0) === 0);

  return {
    dungeonCount: withRuns.length,
    totalRuns: withRuns.reduce((s, d) => s + d.runCount, 0),
    equalWeightAverages: {
      successfulInterruptsMedian: equalWeightMean(
        withRuns.map((d) => d.successfulInterruptsMedian),
      ),
      interruptOpportunityCandidatesMedian: equalWeightMean(
        withRuns.map((d) => d.interruptOpportunityCandidatesMedian),
      ),
      ccUsesMedian: equalWeightMean(withRuns.map((d) => d.ccUsesMedian)),
      dispelsPurgesMedian: equalWeightMean(withRuns.map((d) => d.dispelsPurgesMedian)),
      externalGroupUtilityMedian: equalWeightMean(
        withRuns.map((d) => d.externalGroupUtilityMedian),
      ),
      classSpecificMedian: equalWeightMean(withRuns.map((d) => d.classSpecificMedian)),
    },
    coverage: {
      expectedDungeonCount: expectedDungeonSlugs.length,
      dungeonsWithRuns: withRuns.length,
      dungeonsMissingRuns: missing,
      sampleSizeByDungeon,
    },
    reliabilityAssessment: {
      reliableEnoughForStandaloneV1: [
        "successful_interrupts_count",
        "interrupt_source_player_vs_pet_attribution",
        "catalog_matched_hard_cc_casts",
        "catalog_matched_soft_cc_casts",
        "successful_dispels_and_purges_counts",
        "external_group_utility_raw_uses_with_classification",
      ],
      diagnosticOnly: [
        "interrupt_opportunity_candidates",
        "interrupt_availability_during_hostile_casts",
        "cc_usefulness_classification",
        "dispel_purge_opportunity_detection",
        "confirmed_useful_externals_without_pressure_context",
        "battle_rez_result_when_revive_aura_absent",
      ],
      evidenceNotes: [
        "WCL Interrupts dataset deterministically counts successful interrupts with pet attribution.",
        "Hostile cast interruptibility is inconsistently exposed; opportunity metrics stay diagnostic.",
        "CC usefulness cannot be confirmed without reliable interruptible cast windows.",
        "Dispel/purge opportunities lack purgeable/harmful certainty flags — evidence-only.",
        "No Utility score is calculated; equal-weight dungeon medians keep sample sizes separate.",
      ],
    },
    note:
      "Equal-weight averages across dungeons with ≥1 run. Sample sizes are separate. No Utility score.",
  };
}

export function emptyUtilityEventDatasets(
  note: string,
): Record<UtilityEventDataType, UtilityRawEventDataset> {
  const types: UtilityEventDataType[] = [
    "Interrupts",
    "Casts",
    "Buffs",
    "Debuffs",
    "Dispels",
    "DamageDone",
    "Deaths",
    "CombatantInfo",
  ];
  return Object.fromEntries(
    types.map((t) => [
      t,
      {
        dataType: t,
        state: "MISSING" as const,
        pageCount: 0,
        truncated: false,
        filterSourceId: null,
        events: [],
        pages: [],
        graphqlErrors: [],
        note,
      } satisfies UtilityRawEventDataset,
    ]),
  ) as unknown as Record<UtilityEventDataType, UtilityRawEventDataset>;
}

export type { AbilityRule };
